-- Lot 1 — back-office administrateur (ADM-01 à ADM-03).
-- Toutes les fonctions vérifient est_admin() elles-mêmes : un compte non admin
-- reçoit une erreur, même s'il appelle l'API directement.

create or replace function public.exiger_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.est_admin() then
    raise exception 'Réservé aux administrateurs' using errcode = '42501';
  end if;
end
$$;
revoke all on function public.exiger_admin() from public, anon;
grant execute on function public.exiger_admin() to authenticated;

-- Commune écrite librement (« Libreville », « AKANDA ») → valeur normalisée.
create or replace function public.commune_normalisee(texte text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case public.normaliser(btrim(coalesce(texte, '')))
    when 'libreville' then 'libreville'
    when 'lbv' then 'libreville'
    when 'akanda' then 'akanda'
    when 'owendo' then 'owendo'
  end
$$;

-- ---------------------------------------------------------------------------
-- ADM-01 : enregistrer une pharmacie (création ou modification)
-- ---------------------------------------------------------------------------

create or replace function public.enregistrer_pharmacie(fiche jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(fiche ->> 'id', '')::uuid;
begin
  perform public.exiger_admin();
  if v_id is null then
    insert into public.pharmacies
      (nom, adresse, commune, quartier, latitude, longitude, telephone,
       numero_autorisation, titulaire, accepte_cnamgs, mutuelles, services, statut)
    values (
      btrim(fiche ->> 'nom'), nullif(btrim(fiche ->> 'adresse'), ''), fiche ->> 'commune',
      nullif(btrim(fiche ->> 'quartier'), ''),
      (fiche ->> 'latitude')::double precision, (fiche ->> 'longitude')::double precision,
      nullif(btrim(fiche ->> 'telephone'), ''), nullif(btrim(fiche ->> 'numero_autorisation'), ''),
      nullif(btrim(fiche ->> 'titulaire'), ''), coalesce((fiche ->> 'accepte_cnamgs')::boolean, false),
      coalesce(array(select jsonb_array_elements_text(fiche -> 'mutuelles')), '{}'),
      coalesce(array(select jsonb_array_elements_text(fiche -> 'services')), '{}'),
      coalesce(fiche ->> 'statut', 'en_attente'))
    returning id into v_id;
  else
    update public.pharmacies set
      nom = btrim(fiche ->> 'nom'),
      adresse = nullif(btrim(fiche ->> 'adresse'), ''),
      commune = fiche ->> 'commune',
      quartier = nullif(btrim(fiche ->> 'quartier'), ''),
      latitude = (fiche ->> 'latitude')::double precision,
      longitude = (fiche ->> 'longitude')::double precision,
      telephone = nullif(btrim(fiche ->> 'telephone'), ''),
      numero_autorisation = nullif(btrim(fiche ->> 'numero_autorisation'), ''),
      titulaire = nullif(btrim(fiche ->> 'titulaire'), ''),
      accepte_cnamgs = coalesce((fiche ->> 'accepte_cnamgs')::boolean, false),
      mutuelles = coalesce(array(select jsonb_array_elements_text(fiche -> 'mutuelles')), '{}'),
      services = coalesce(array(select jsonb_array_elements_text(fiche -> 'services')), '{}')
    where id = v_id;
    if not found then
      raise exception 'Pharmacie introuvable' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end
$$;

-- Validation, suspension, réactivation. Le changement est journalisé par trigger.
create or replace function public.changer_statut_pharmacie(pharmacie uuid, nouveau text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exiger_admin();
  if nouveau not in ('en_attente', 'active', 'suspendue') then
    raise exception 'Statut inconnu : %', nouveau using errcode = '22023';
  end if;
  update public.pharmacies set statut = nouveau where id = pharmacie;
  if not found then
    raise exception 'Pharmacie introuvable' using errcode = 'P0002';
  end if;
end
$$;

-- Horaires : remplace toutes les plages d'une pharmacie en une fois.
-- plages : [{ "jour": 1, "ouverture": "08:00", "fermeture": "20:00" }, ...]
create or replace function public.definir_horaires(pharmacie uuid, plages jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform public.exiger_admin();
  delete from public.horaires where pharmacie_id = pharmacie;
  insert into public.horaires (pharmacie_id, jour, ouverture, fermeture)
  select pharmacie, (p ->> 'jour')::smallint, (p ->> 'ouverture')::time, (p ->> 'fermeture')::time
  from jsonb_array_elements(plages) p;
  get diagnostics n = row_count;
  return n;
end
$$;

-- ---------------------------------------------------------------------------
-- Import de pharmacies (20 pharmacies saisies en quelques minutes)
-- lignes : [{ "ligne": 2, "nom", "commune", "quartier", "adresse", "telephone",
--             "latitude", "longitude", "numero_autorisation", "titulaire", "cnamgs" }]
-- Une pharmacie déjà présente (même nom, même commune) est mise à jour.
-- activer : les pharmacies créées sont visibles tout de suite (saisie par l'admin,
-- donc déjà vérifiée) ; sinon elles restent en attente de validation.
-- ---------------------------------------------------------------------------

create or replace function public.importer_pharmacies(lignes jsonb, simulation boolean default true, activer boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  v_erreurs jsonb := '[]';
  v_valides jsonb := '[]';
  v_motifs text[];
  v_commune text;
  v_lat double precision;
  v_lng double precision;
  v_cnamgs boolean;
  v_vus text[] := '{}';
  v_cle text;
  v_nouvelles integer := 0;
  v_existe uuid;
begin
  perform public.exiger_admin();
  if jsonb_typeof(lignes) <> 'array' or jsonb_array_length(lignes) > 2000 then
    raise exception 'Fichier invalide ou trop long (2 000 lignes maximum)' using errcode = '22023';
  end if;

  for l in select * from jsonb_array_elements(lignes) loop
    v_motifs := '{}';
    v_commune := public.commune_normalisee(l ->> 'commune');
    v_lat := null; v_lng := null; v_cnamgs := false;

    if length(btrim(coalesce(l ->> 'nom', ''))) < 2 then
      v_motifs := v_motifs || 'nom manquant'::text;
    end if;
    if v_commune is null then
      v_motifs := v_motifs || 'commune inconnue (Libreville, Akanda ou Owendo)'::text;
    end if;

    begin
      v_lat := nullif(replace(btrim(coalesce(l ->> 'latitude', '')), ',', '.'), '')::double precision;
      v_lng := nullif(replace(btrim(coalesce(l ->> 'longitude', '')), ',', '.'), '')::double precision;
      if (v_lat is null) <> (v_lng is null) then
        v_motifs := v_motifs || 'latitude et longitude vont ensemble'::text;
      elsif v_lat is not null and not (v_lat between -5 and 5 and v_lng between 5 and 15) then
        v_motifs := v_motifs || 'position hors du Gabon (latitude/longitude inversées ?)'::text;
      end if;
    exception when others then
      v_motifs := v_motifs || 'latitude ou longitude illisible'::text;
    end;

    v_cnamgs := public.normaliser(btrim(coalesce(l ->> 'cnamgs', ''))) in ('oui', 'o', 'x', '1', 'true', 'vrai');

    v_cle := public.normaliser(btrim(coalesce(l ->> 'nom', ''))) || '|' || coalesce(v_commune, '');
    if v_cle = any (v_vus) then
      v_motifs := v_motifs || 'pharmacie en double dans le fichier'::text;
    end if;

    if cardinality(v_motifs) > 0 then
      v_erreurs := v_erreurs || jsonb_build_object('ligne', l -> 'ligne', 'nom', l ->> 'nom', 'motifs', to_jsonb(v_motifs));
      continue;
    end if;

    v_vus := v_vus || v_cle;
    select id into v_existe from public.pharmacies
      where public.normaliser(nom) = public.normaliser(btrim(l ->> 'nom')) and commune = v_commune;
    if v_existe is null then v_nouvelles := v_nouvelles + 1; end if;
    v_valides := v_valides || jsonb_build_object(
      'id', v_existe, 'nom', btrim(l ->> 'nom'), 'commune', v_commune,
      'quartier', l ->> 'quartier', 'adresse', l ->> 'adresse', 'telephone', l ->> 'telephone',
      'latitude', v_lat, 'longitude', v_lng, 'numero_autorisation', l ->> 'numero_autorisation',
      'titulaire', l ->> 'titulaire', 'accepte_cnamgs', v_cnamgs);
  end loop;

  if not simulation then
    for l in select * from jsonb_array_elements(v_valides) loop
      if l ->> 'id' is null then
        insert into public.pharmacies (nom, commune, quartier, adresse, telephone, latitude, longitude,
                                       numero_autorisation, titulaire, accepte_cnamgs, statut)
        values (l ->> 'nom', l ->> 'commune', nullif(btrim(l ->> 'quartier'), ''), nullif(btrim(l ->> 'adresse'), ''),
                nullif(btrim(l ->> 'telephone'), ''), (l ->> 'latitude')::double precision, (l ->> 'longitude')::double precision,
                nullif(btrim(l ->> 'numero_autorisation'), ''), nullif(btrim(l ->> 'titulaire'), ''),
                (l ->> 'accepte_cnamgs')::boolean,
                case when activer then 'active' else 'en_attente' end);
      else
        update public.pharmacies set
          quartier = coalesce(nullif(btrim(l ->> 'quartier'), ''), quartier),
          adresse = coalesce(nullif(btrim(l ->> 'adresse'), ''), adresse),
          telephone = coalesce(nullif(btrim(l ->> 'telephone'), ''), telephone),
          latitude = coalesce((l ->> 'latitude')::double precision, latitude),
          longitude = coalesce((l ->> 'longitude')::double precision, longitude),
          numero_autorisation = coalesce(nullif(btrim(l ->> 'numero_autorisation'), ''), numero_autorisation),
          titulaire = coalesce(nullif(btrim(l ->> 'titulaire'), ''), titulaire),
          accepte_cnamgs = (l ->> 'accepte_cnamgs')::boolean
        where id = (l ->> 'id')::uuid;
      end if;
    end loop;
    insert into public.journal (auteur, action, cible, details)
    values (auth.uid(), 'import_pharmacies', 'pharmacies',
            jsonb_build_object('lignes', jsonb_array_length(lignes), 'importees', jsonb_array_length(v_valides)));
  end if;

  return jsonb_build_object(
    'simulation', simulation, 'nb_lignes', jsonb_array_length(lignes),
    'nb_valides', jsonb_array_length(v_valides), 'nb_erreurs', jsonb_array_length(v_erreurs),
    'nouvelles', v_nouvelles, 'mises_a_jour', jsonb_array_length(v_valides) - v_nouvelles,
    'erreurs', v_erreurs);
end
$$;

-- ---------------------------------------------------------------------------
-- ADM-02 : gardes. Saisie unitaire et import Excel de la semaine.
-- lignes : [{ "ligne": 2, "pharmacie": "Pharmacie X", "commune": "Akanda",
--             "debut": "2026-11-02T20:00", "fin": "2026-11-03T08:00" }]
-- Heures exprimées à l'heure de Libreville (UTC+1).
-- ---------------------------------------------------------------------------

create or replace function public.ajouter_garde(pharmacie uuid, debut_garde timestamptz, fin_garde timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.exiger_admin();
  insert into public.gardes (pharmacie_id, debut, fin, source, validee, cree_par)
  values (pharmacie, debut_garde, fin_garde, 'admin', true, auth.uid())
  on conflict on constraint gardes_sans_doublon do update set validee = true
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.importer_gardes(lignes jsonb, simulation boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  v_erreurs jsonb := '[]';
  v_valides jsonb := '[]';
  v_motifs text[];
  v_commune text;
  v_pharmacie uuid;
  v_candidats integer;
  v_debut timestamptz;
  v_fin timestamptz;
  v_doublons integer := 0;
begin
  perform public.exiger_admin();
  if jsonb_typeof(lignes) <> 'array' or jsonb_array_length(lignes) > 2000 then
    raise exception 'Fichier invalide ou trop long (2 000 lignes maximum)' using errcode = '22023';
  end if;

  for l in select * from jsonb_array_elements(lignes) loop
    v_motifs := '{}';
    v_pharmacie := null;
    v_debut := null; v_fin := null;
    v_commune := public.commune_normalisee(l ->> 'commune');

    -- Pharmacie reconnue par son nom, sans accents ni casse, dans la commune si elle est donnée.
    select count(*), min(p.id::text)::uuid into v_candidats, v_pharmacie
    from public.pharmacies p
    where public.normaliser(p.nom) = public.normaliser(btrim(coalesce(l ->> 'pharmacie', '')))
      and (v_commune is null or p.commune = v_commune);

    if v_candidats = 0 then
      -- Second essai : nom contenu (« Pharmacie du Bord de Mer » pour « Bord de Mer »).
      select count(*), min(p.id::text)::uuid into v_candidats, v_pharmacie
      from public.pharmacies p
      where public.normaliser(p.nom) like '%' || public.normaliser(btrim(coalesce(l ->> 'pharmacie', ''))) || '%'
        and length(btrim(coalesce(l ->> 'pharmacie', ''))) >= 4
        and (v_commune is null or p.commune = v_commune);
    end if;

    if v_candidats = 0 then
      v_motifs := v_motifs || 'pharmacie introuvable'::text;
      v_pharmacie := null;
    elsif v_candidats > 1 then
      v_motifs := v_motifs || 'plusieurs pharmacies correspondent : précisez la commune ou le nom complet'::text;
      v_pharmacie := null;
    end if;

    begin
      v_debut := ((l ->> 'debut')::timestamp at time zone 'Africa/Libreville');
      v_fin := ((l ->> 'fin')::timestamp at time zone 'Africa/Libreville');
      if v_fin <= v_debut then
        v_motifs := v_motifs || 'la fin doit être après le début'::text;
      elsif v_fin - v_debut > interval '7 days' then
        v_motifs := v_motifs || 'garde de plus de 7 jours'::text;
      end if;
    exception when others then
      v_motifs := v_motifs || 'date ou heure illisible'::text;
    end;

    if cardinality(v_motifs) > 0 then
      v_erreurs := v_erreurs || jsonb_build_object('ligne', l -> 'ligne', 'pharmacie', l ->> 'pharmacie', 'motifs', to_jsonb(v_motifs));
      continue;
    end if;

    if exists (select 1 from public.gardes g where g.pharmacie_id = v_pharmacie and g.debut = v_debut and g.fin = v_fin) then
      v_doublons := v_doublons + 1;
    end if;
    v_valides := v_valides || jsonb_build_object(
      'ligne', l -> 'ligne', 'pharmacie_id', v_pharmacie,
      'pharmacie', (select nom from public.pharmacies where id = v_pharmacie),
      'debut', v_debut, 'fin', v_fin);
  end loop;

  if not simulation then
    insert into public.gardes (pharmacie_id, debut, fin, source, validee, cree_par)
    select (v ->> 'pharmacie_id')::uuid, (v ->> 'debut')::timestamptz, (v ->> 'fin')::timestamptz, 'admin', true, auth.uid()
    from jsonb_array_elements(v_valides) v
    on conflict on constraint gardes_sans_doublon do update set validee = true;
    insert into public.journal (auteur, action, cible, details)
    values (auth.uid(), 'import_gardes', 'gardes',
            jsonb_build_object('lignes', jsonb_array_length(lignes), 'importees', jsonb_array_length(v_valides)));
  end if;

  return jsonb_build_object(
    'simulation', simulation, 'nb_lignes', jsonb_array_length(lignes),
    'nb_valides', jsonb_array_length(v_valides), 'nb_erreurs', jsonb_array_length(v_erreurs),
    'deja_presentes', v_doublons, 'valides', v_valides, 'erreurs', v_erreurs);
end
$$;

-- ---------------------------------------------------------------------------
-- ADM-03 : base médicaments
-- ---------------------------------------------------------------------------

-- Fusion de doublons : les demandes du doublon passent sur le médicament gardé,
-- son nom devient un synonyme, puis il est supprimé.
create or replace function public.fusionner_medicaments(doublon uuid, garde uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.medicaments;
begin
  perform public.exiger_admin();
  if doublon = garde then
    raise exception 'Choisissez deux médicaments différents' using errcode = '22023';
  end if;
  select * into d from public.medicaments where id = doublon;
  if not found or not exists (select 1 from public.medicaments where id = garde) then
    raise exception 'Médicament introuvable' using errcode = 'P0002';
  end if;

  update public.demandes set medicament_id = garde where medicament_id = doublon;
  update public.medicaments m set synonymes = (
    select coalesce(array_agg(distinct s order by s), '{}')
    from unnest(m.synonymes || d.synonymes || d.nom_commercial ||
                case when d.molecule is not null then array[d.molecule] else '{}'::text[] end) s
    where public.normaliser(s) <> public.normaliser(m.nom_commercial)
  )
  where m.id = garde;
  insert into public.journal (auteur, action, cible, details)
  values (auth.uid(), 'fusion_medicaments', garde::text, to_jsonb(d));
  delete from public.medicaments where id = doublon;
end
$$;

-- Import de la base : [{ "ligne", "nom_commercial", "molecule", "dosage", "forme", "synonymes" }]
-- synonymes séparés par « ; » ou « | ». Un médicament déjà présent (même nom,
-- dosage et forme) est complété, pas dupliqué.
create or replace function public.importer_medicaments(lignes jsonb, simulation boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  v_erreurs jsonb := '[]';
  v_valides jsonb := '[]';
  v_nouveaux integer := 0;
  v_cle text;
  v_vus text[] := '{}';
  v_syn text[];
begin
  perform public.exiger_admin();
  if jsonb_typeof(lignes) <> 'array' or jsonb_array_length(lignes) > 20000 then
    raise exception 'Fichier invalide ou trop long (20 000 lignes maximum)' using errcode = '22023';
  end if;

  for l in select * from jsonb_array_elements(lignes) loop
    if length(btrim(coalesce(l ->> 'nom_commercial', ''))) < 2 then
      v_erreurs := v_erreurs || jsonb_build_object('ligne', l -> 'ligne', 'nom', l ->> 'nom_commercial', 'motifs', jsonb_build_array('nom commercial manquant'));
      continue;
    end if;
    v_cle := public.normaliser(btrim(l ->> 'nom_commercial')) || '|' ||
             public.normaliser(btrim(coalesce(l ->> 'dosage', ''))) || '|' ||
             public.normaliser(btrim(coalesce(l ->> 'forme', '')));
    if v_cle = any (v_vus) then
      v_erreurs := v_erreurs || jsonb_build_object('ligne', l -> 'ligne', 'nom', l ->> 'nom_commercial', 'motifs', jsonb_build_array('en double dans le fichier'));
      continue;
    end if;
    v_vus := v_vus || v_cle;
    v_syn := array(select btrim(s) from regexp_split_to_table(coalesce(l ->> 'synonymes', ''), '[;|]') s where btrim(s) <> '');
    if not exists (
      select 1 from public.medicaments m
      where public.normaliser(m.nom_commercial) = public.normaliser(btrim(l ->> 'nom_commercial'))
        and public.normaliser(coalesce(m.dosage, '')) = public.normaliser(btrim(coalesce(l ->> 'dosage', '')))
        and public.normaliser(coalesce(m.forme, '')) = public.normaliser(btrim(coalesce(l ->> 'forme', '')))
    ) then
      v_nouveaux := v_nouveaux + 1;
    end if;
    v_valides := v_valides || jsonb_build_object(
      'nom_commercial', btrim(l ->> 'nom_commercial'), 'molecule', nullif(btrim(coalesce(l ->> 'molecule', '')), ''),
      'dosage', nullif(btrim(coalesce(l ->> 'dosage', '')), ''), 'forme', nullif(btrim(coalesce(l ->> 'forme', '')), ''),
      'synonymes', to_jsonb(v_syn));
  end loop;

  if not simulation then
    insert into public.medicaments (nom_commercial, molecule, dosage, forme, synonymes)
    select v ->> 'nom_commercial', v ->> 'molecule', v ->> 'dosage', v ->> 'forme',
           array(select jsonb_array_elements_text(v -> 'synonymes'))
    from jsonb_array_elements(v_valides) v
    on conflict (public.normaliser(nom_commercial), public.normaliser(coalesce(dosage, '')), public.normaliser(coalesce(forme, '')))
    do update set
      molecule = coalesce(public.medicaments.molecule, excluded.molecule),
      synonymes = (select coalesce(array_agg(distinct s), '{}') from unnest(public.medicaments.synonymes || excluded.synonymes) s);
  end if;

  return jsonb_build_object(
    'simulation', simulation, 'nb_lignes', jsonb_array_length(lignes),
    'nb_valides', jsonb_array_length(v_valides), 'nb_erreurs', jsonb_array_length(v_erreurs),
    'nouveaux', v_nouveaux, 'completes', jsonb_array_length(v_valides) - v_nouveaux,
    'erreurs', v_erreurs);
end
$$;

-- Suggestions dès 3 lettres (PAT-01, et recherche dans le back-office).
create or replace function public.chercher_medicaments(texte text, limite integer default 10)
returns table (id uuid, nom_commercial text, molecule text, dosage text, forme text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.nom_commercial, m.molecule, m.dosage, m.forme
  from public.medicaments m
  where m.actif
    and length(btrim(texte)) >= 3
    and m.recherche like '%' || public.normaliser(btrim(texte)) || '%'
  order by
    (public.normaliser(m.nom_commercial) like public.normaliser(btrim(texte)) || '%') desc,
    m.nom_commercial, m.dosage
  limit least(greatest(limite, 1), 25)
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.enregistrer_pharmacie(jsonb)',
    'public.changer_statut_pharmacie(uuid, text)',
    'public.definir_horaires(uuid, jsonb)',
    'public.importer_pharmacies(jsonb, boolean, boolean)',
    'public.ajouter_garde(uuid, timestamptz, timestamptz)',
    'public.importer_gardes(jsonb, boolean)',
    'public.fusionner_medicaments(uuid, uuid)',
    'public.importer_medicaments(jsonb, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

revoke all on function public.chercher_medicaments(text, integer) from public;
grant execute on function public.chercher_medicaments(text, integer) to anon, authenticated;
