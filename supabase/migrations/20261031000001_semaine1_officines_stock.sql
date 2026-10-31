-- Dispomed — Semaine 1 : officines, comptes pharmaciens, produits, stock, import.
--
-- Règle centrale (spec §3) : un pharmacien ne lit et n'écrit QUE les données
-- de son officine. Elle est appliquée ici, dans la base, par RLS et par des
-- fonctions qui déduisent l'officine de l'utilisateur connecté. L'officine
-- n'est jamais prise dans la requête du client.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.officines (
  id               uuid primary key default gen_random_uuid(),
  nom              text not null,
  adresse          text,
  quartier         text,
  ville            text not null default 'Libreville',
  telephone        text,
  latitude         double precision,
  longitude        double precision,
  -- Monnaie et moyens de paiement affichés au public (spec §1).
  monnaies         text[] not null default array['XAF'],
  moyens_paiement  text[] not null default array['especes'],
  horaires         text,
  de_garde         boolean not null default false,
  active           boolean not null default true,
  cree_le          timestamptz not null default now()
);

-- Un compte pharmacien est rattaché à une seule officine. La ligne est créée
-- par l'équipe Dispomed après vérification manuelle du numéro d'Ordre.
create table public.pharmaciens (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  officine_id  uuid not null references public.officines (id) on delete restrict,
  nom          text not null,
  numero_ordre text not null,
  role         text not null default 'titulaire' check (role in ('titulaire', 'adjoint')),
  verifie      boolean not null default false,
  cree_le      timestamptz not null default now()
);
create index pharmaciens_officine_idx on public.pharmaciens (officine_id);

-- Référentiel commun des produits, relié aux fichiers par le code produit.
create table public.produits (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique check (length(btrim(code)) > 0),
  nom      text not null,
  cree_le  timestamptz not null default now()
);

create table public.stocks (
  officine_id   uuid not null references public.officines (id) on delete cascade,
  produit_id    uuid not null references public.produits (id) on delete restrict,
  quantite      integer not null default 0 check (quantite >= 0),
  prix          numeric(12, 2) check (prix is null or prix >= 0),
  seuil_alerte  integer not null default 5 check (seuil_alerte >= 0),
  -- Date à laquelle la quantité a été confirmée (import ou saisie).
  confirme_le   timestamptz not null default now(),
  primary key (officine_id, produit_id)
);
create index stocks_produit_idx on public.stocks (produit_id);

create table public.imports_stock (
  id           uuid primary key default gen_random_uuid(),
  officine_id  uuid not null references public.officines (id) on delete cascade,
  cree_par     uuid references auth.users (id) on delete set null,
  fichier      text,
  mode         text not null check (mode in ('mise_a_jour', 'remplacement')),
  nb_lignes    integer not null,
  nb_importees integer not null,
  nb_erreurs   integer not null,
  cree_le      timestamptz not null default now()
);
create index imports_stock_officine_idx on public.imports_stock (officine_id, cree_le desc);

-- ---------------------------------------------------------------------------
-- Officine de l'utilisateur connecté
-- ---------------------------------------------------------------------------

-- Renvoie l'officine du pharmacien connecté, ou NULL s'il n'a pas de compte
-- pharmacien vérifié. Toutes les règles d'accès s'appuient sur cette fonction.
create or replace function public.mon_officine()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.officine_id
  from public.pharmaciens p
  join public.officines o on o.id = p.officine_id
  where p.user_id = auth.uid()
    and p.verifie
    and o.active
$$;

revoke all on function public.mon_officine() from public;
grant execute on function public.mon_officine() to authenticated;

-- ---------------------------------------------------------------------------
-- Fraîcheur du stock (spec §4)
--   < 12 h  : 'recent'      -> « confirmé il y a X »
--   12-48 h : 'non_recent'  -> badge « stock non récent »
--   > 48 h  : 'a_confirmer' -> non réservable
-- ---------------------------------------------------------------------------

create or replace function public.statut_fraicheur(confirme_le timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when confirme_le >= now() - interval '12 hours' then 'recent'
    when confirme_le >= now() - interval '48 hours' then 'non_recent'
    else 'a_confirmer'
  end
$$;

-- Toute modification de la quantité vaut confirmation à la date du jour.
create or replace function public.stocks_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.quantite is distinct from old.quantite then
    new.confirme_le := now();
  end if;
  return new;
end
$$;

create trigger stocks_confirmation
before insert or update on public.stocks
for each row execute function public.stocks_confirmation();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.officines     enable row level security;
alter table public.pharmaciens   enable row level security;
alter table public.produits      enable row level security;
alter table public.stocks        enable row level security;
alter table public.imports_stock enable row level security;

-- Le public n'accède à rien directement : seulement à la vue publique plus bas.
revoke all on public.officines, public.pharmaciens, public.produits,
              public.stocks, public.imports_stock from anon, authenticated;

-- Officines : le pharmacien voit la sienne et ne modifie que les champs
-- d'affichage (pas le nom, ni l'activation, ni la position).
grant select on public.officines to authenticated;
grant update (telephone, horaires, monnaies, moyens_paiement, de_garde)
  on public.officines to authenticated;

create policy officines_lecture on public.officines
  for select to authenticated
  using (id = public.mon_officine());

create policy officines_modification on public.officines
  for update to authenticated
  using (id = public.mon_officine())
  with check (id = public.mon_officine());

-- Pharmaciens : chacun lit sa propre fiche, sans pouvoir la modifier.
grant select on public.pharmaciens to authenticated;

create policy pharmaciens_lecture on public.pharmaciens
  for select to authenticated
  using (user_id = auth.uid());

-- Produits : référentiel lisible par les pharmaciens. Les ajouts passent par
-- l'import (fonction ci-dessous).
grant select on public.produits to authenticated;

create policy produits_lecture on public.produits
  for select to authenticated
  using (public.mon_officine() is not null);

-- Stocks : lecture et écriture limitées à l'officine du pharmacien.
-- confirme_le n'est jamais écrit par le client : il est posé par le trigger
-- ou par confirmer_stock(), toujours à l'heure du serveur.
grant select, delete on public.stocks to authenticated;
grant insert (officine_id, produit_id, quantite, prix, seuil_alerte) on public.stocks to authenticated;
grant update (quantite, prix, seuil_alerte) on public.stocks to authenticated;

create policy stocks_lecture on public.stocks
  for select to authenticated
  using (officine_id = public.mon_officine());

create policy stocks_ajout on public.stocks
  for insert to authenticated
  with check (officine_id = public.mon_officine());

create policy stocks_modification on public.stocks
  for update to authenticated
  using (officine_id = public.mon_officine())
  with check (officine_id = public.mon_officine());

create policy stocks_suppression on public.stocks
  for delete to authenticated
  using (officine_id = public.mon_officine());

-- Historique des imports : lecture seule, par officine.
grant select on public.imports_stock to authenticated;

create policy imports_lecture on public.imports_stock
  for select to authenticated
  using (officine_id = public.mon_officine());

-- « Je confirme ces quantités » sans les changer : remet confirme_le à now()
-- pour des produits de SON officine uniquement. Renvoie le nombre confirmé.
create or replace function public.confirmer_stock(produits uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officine uuid := public.mon_officine();
  v_nb integer;
begin
  if v_officine is null then
    raise exception 'Compte pharmacien non vérifié ou officine inactive'
      using errcode = '42501';
  end if;
  update public.stocks
  set confirme_le = now()
  where officine_id = v_officine
    and produit_id = any (produits);
  get diagnostics v_nb = row_count;
  return v_nb;
end
$$;

revoke all on function public.confirmer_stock(uuid[]) from public;
grant execute on function public.confirmer_stock(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Vues pour l'espace officine (RLS de l'appelant appliquée)
-- ---------------------------------------------------------------------------

create view public.mon_stock
with (security_invoker = true) as
select
  s.produit_id,
  p.code,
  p.nom,
  s.quantite,
  s.prix,
  s.seuil_alerte,
  s.quantite <= s.seuil_alerte            as en_alerte,
  s.confirme_le,
  public.statut_fraicheur(s.confirme_le) as fraicheur
from public.stocks s
join public.produits p on p.id = s.produit_id;

grant select on public.mon_stock to authenticated;

-- Liste de réapprovisionnement : produits au seuil ou en dessous.
create view public.a_reapprovisionner
with (security_invoker = true) as
select produit_id, code, nom, quantite, seuil_alerte,
       greatest(seuil_alerte * 2 - quantite, 0) as quantite_suggeree
from public.mon_stock
where en_alerte;

grant select on public.a_reapprovisionner to authenticated;

-- ---------------------------------------------------------------------------
-- Vue publique (spec §9) : seulement les champs prévus. Pas de quantité
-- exacte, pas de prix d'achat, pas de données de compte.
-- Elle s'exécute avec les droits de son propriétaire, d'où le filtrage strict.
-- ---------------------------------------------------------------------------

create view public.disponibilites as
select
  o.id                as officine_id,
  o.nom               as officine,
  o.adresse,
  o.quartier,
  o.ville,
  o.telephone,
  o.latitude,
  o.longitude,
  o.monnaies,
  o.moyens_paiement,
  o.horaires,
  o.de_garde,
  p.code              as produit_code,
  p.nom               as produit,
  s.prix,
  s.confirme_le,
  public.statut_fraicheur(s.confirme_le)                         as fraicheur,
  public.statut_fraicheur(s.confirme_le) <> 'a_confirmer'        as reservable
from public.stocks s
join public.officines o on o.id = s.officine_id
join public.produits  p on p.id = s.produit_id
where o.active
  and s.quantite > 0;

grant select on public.disponibilites to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Import CSV / Excel (spec §4, niveau 1)
--
-- lignes : tableau JSON [{ "ligne": 2, "code": "...", "nom": "...",
--                          "quantite": "12", "prix": "1500" }, ...]
-- mode   : 'mise_a_jour'  -> seuls les produits du fichier changent
--          'remplacement' -> les produits absents du fichier passent à 0
-- simulation = true : valide et renvoie le rapport sans rien écrire (aperçu).
--
-- L'officine est celle du pharmacien connecté, jamais un paramètre.
-- ---------------------------------------------------------------------------

create or replace function public.importer_stock(
  lignes     jsonb,
  mode       text    default 'mise_a_jour',
  simulation boolean default true,
  fichier    text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officine  uuid := public.mon_officine();
  v_erreurs   jsonb := '[]'::jsonb;
  v_valides   jsonb := '[]'::jsonb;
  v_nouveaux  integer := 0;
  v_mises_a_zero integer := 0;
  v_vus       text[] := array[]::text[];
  l           jsonb;
  v_ligne     integer;
  v_code      text;
  v_nom       text;
  v_qte_txt   text;
  v_prix_txt  text;
  v_qte       integer;
  v_prix      numeric;
  v_motifs    text[];
  v_produit   uuid;
begin
  if v_officine is null then
    raise exception 'Compte pharmacien non vérifié ou officine inactive'
      using errcode = '42501';
  end if;

  if mode not in ('mise_a_jour', 'remplacement') then
    raise exception 'Mode inconnu : %', mode using errcode = '22023';
  end if;

  if jsonb_typeof(lignes) <> 'array' then
    raise exception 'Le paramètre lignes doit être un tableau' using errcode = '22023';
  end if;

  if jsonb_array_length(lignes) > 10000 then
    raise exception 'Fichier trop long (10 000 lignes maximum)' using errcode = '22023';
  end if;

  -- 1. Validation ligne par ligne
  for l in select * from jsonb_array_elements(lignes)
  loop
    v_motifs   := array[]::text[];
    v_ligne    := coalesce((l ->> 'ligne')::integer, 0);
    v_code     := nullif(btrim(coalesce(l ->> 'code', '')), '');
    v_nom      := nullif(btrim(coalesce(l ->> 'nom', '')), '');
    v_qte_txt  := replace(btrim(coalesce(l ->> 'quantite', '')), ' ', '');
    v_prix_txt := replace(replace(btrim(coalesce(l ->> 'prix', '')), ' ', ''), ',', '.');
    v_qte      := null;
    v_prix     := null;

    if v_code is null then
      v_motifs := v_motifs || 'code produit manquant'::text;
    elsif v_code = any (v_vus) then
      v_motifs := v_motifs || 'code en double dans le fichier'::text;
    end if;

    if v_qte_txt = '' then
      v_motifs := v_motifs || 'quantité manquante'::text;
    elsif v_qte_txt !~ '^\d{1,9}$' then
      v_motifs := v_motifs || 'quantité invalide (entier positif attendu)'::text;
    else
      v_qte := v_qte_txt::integer;
    end if;

    if v_prix_txt <> '' then
      if v_prix_txt !~ '^\d{1,10}(\.\d{1,2})?$' then
        v_motifs := v_motifs || 'prix invalide'::text;
      else
        v_prix := v_prix_txt::numeric;
      end if;
    end if;

    if v_code is not null
       and v_nom is null
       and not exists (select 1 from public.produits where code = v_code) then
      v_motifs := v_motifs || 'produit inconnu : le nom est obligatoire'::text;
    end if;

    if cardinality(v_motifs) > 0 then
      v_erreurs := v_erreurs || jsonb_build_object(
        'ligne', v_ligne, 'code', v_code, 'motifs', to_jsonb(v_motifs));
    else
      v_vus := v_vus || v_code::text;
      v_valides := v_valides || jsonb_build_object(
        'code', v_code, 'nom', v_nom, 'quantite', v_qte, 'prix', v_prix);
      if not exists (select 1 from public.produits where code = v_code) then
        v_nouveaux := v_nouveaux + 1;
      end if;
    end if;
  end loop;

  if mode = 'remplacement' then
    select count(*) into v_mises_a_zero
    from public.stocks s
    join public.produits p on p.id = s.produit_id
    where s.officine_id = v_officine
      and s.quantite > 0
      and not (p.code = any (v_vus));
  end if;

  -- 2. Écriture, seulement si ce n'est pas une simulation
  if not simulation then
    for l in select * from jsonb_array_elements(v_valides)
    loop
      insert into public.produits (code, nom)
      values (l ->> 'code', l ->> 'nom')
      on conflict (code) do nothing;

      select id into v_produit from public.produits where code = l ->> 'code';

      insert into public.stocks (officine_id, produit_id, quantite, prix)
      values (v_officine, v_produit, (l ->> 'quantite')::integer, (l ->> 'prix')::numeric)
      on conflict (officine_id, produit_id) do update
        set quantite    = excluded.quantite,
            prix        = coalesce(excluded.prix, public.stocks.prix),
            -- Un import vaut confirmation, même si la quantité est identique.
            confirme_le = now();
    end loop;

    if mode = 'remplacement' then
      update public.stocks s
      set quantite = 0
      from public.produits p
      where p.id = s.produit_id
        and s.officine_id = v_officine
        and s.quantite > 0
        and not (p.code = any (v_vus));
    end if;

    insert into public.imports_stock
      (officine_id, cree_par, fichier, mode, nb_lignes, nb_importees, nb_erreurs)
    values
      (v_officine, auth.uid(), left(fichier, 255), mode,
       jsonb_array_length(lignes), jsonb_array_length(v_valides),
       jsonb_array_length(v_erreurs));
  end if;

  return jsonb_build_object(
    'simulation',       simulation,
    'mode',             mode,
    'nb_lignes',        jsonb_array_length(lignes),
    'nb_valides',       jsonb_array_length(v_valides),
    'nb_erreurs',       jsonb_array_length(v_erreurs),
    'nouveaux_produits', v_nouveaux,
    'mis_a_zero',       v_mises_a_zero,
    'erreurs',          v_erreurs
  );
end
$$;

revoke all on function public.importer_stock(jsonb, text, boolean, text) from public;
grant execute on function public.importer_stock(jsonb, text, boolean, text) to authenticated;
