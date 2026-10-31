-- Lot 0 — schéma du cahier des charges (section 8).
--
-- Le produit : un patient trouve un médicament sans se déplacer, grâce à des
-- demandes de disponibilité envoyées aux pharmacies proches. Aucune connexion
-- au stock. Ce schéma remplace l'espace « gestion de stock » des migrations
-- précédentes, archivé dans la branche archive/espace-officine-stock.

-- ---------------------------------------------------------------------------
-- Retrait de l'espace stock
-- ---------------------------------------------------------------------------

drop view if exists public.disponibilites cascade;
drop view if exists public.a_reapprovisionner cascade;
drop view if exists public.mon_stock cascade;
drop function if exists public.importer_stock(jsonb, text, boolean, text) cascade;
drop function if exists public.confirmer_stock(uuid[]) cascade;
drop function if exists public.mon_officine() cascade;
drop function if exists public.statut_fraicheur(timestamptz) cascade;
drop function if exists public.stocks_confirmation() cascade;
drop table if exists public.imports_stock cascade;
drop table if exists public.stocks cascade;
drop table if exists public.produits cascade;
drop table if exists public.pharmaciens cascade;
drop table if exists public.officines cascade;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- PostGIS sert aux calculs de distance (lot 3). Il est présent sur Supabase ;
-- sur un Postgres de test qui ne l'a pas, le schéma reste utilisable.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'postgis') then
    create extension if not exists postgis with schema extensions;
  end if;
end
$$;

-- Recherche insensible aux accents et à la casse (« paracetamol » = « Paracétamol »).
create or replace function public.normaliser(texte text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(texte, '')))
$$;

-- ---------------------------------------------------------------------------
-- Pharmacies, horaires, gardes
-- ---------------------------------------------------------------------------

create table public.pharmacies (
  id                  uuid primary key default gen_random_uuid(),
  nom                 text not null check (length(btrim(nom)) > 1),
  adresse             text,
  commune             text not null check (commune in ('libreville', 'akanda', 'owendo')),
  quartier            text,
  latitude            double precision check (latitude between -5 and 5),
  longitude           double precision check (longitude between 5 and 15),
  telephone           text,
  numero_autorisation text,
  titulaire           text,
  statut              text not null default 'en_attente'
                        check (statut in ('en_attente', 'active', 'suspendue')),
  accepte_cnamgs      boolean not null default false,
  mutuelles           text[] not null default '{}',
  services            text[] not null default '{}',
  cree_le             timestamptz not null default now(),
  modifie_le          timestamptz not null default now()
);
create index pharmacies_commune_statut_idx on public.pharmacies (commune, statut);
create index pharmacies_nom_trgm_idx on public.pharmacies
  using gin (public.normaliser(nom) extensions.gin_trgm_ops);

do $$
begin
  if exists (select 1 from pg_extension where extname = 'postgis') then
    execute $sql$
      alter table public.pharmacies add column position extensions.geography(Point, 4326)
        generated always as (
          case when latitude is not null and longitude is not null
            then extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
          end
        ) stored;
      create index pharmacies_position_idx on public.pharmacies using gist (position);
    $sql$;
  end if;
end
$$;

-- Plusieurs plages possibles par jour (ex. 8 h-12 h 30 puis 15 h-20 h).
-- jour : 1 = lundi … 7 = dimanche. Une fermeture après minuit s'écrit 24:00.
create table public.horaires (
  id           uuid primary key default gen_random_uuid(),
  pharmacie_id uuid not null references public.pharmacies (id) on delete cascade,
  jour         smallint not null check (jour between 1 and 7),
  ouverture    time not null,
  fermeture    time not null,
  check (fermeture > ouverture or fermeture = '00:00')
);
create index horaires_pharmacie_idx on public.horaires (pharmacie_id, jour);

create table public.gardes (
  id           uuid primary key default gen_random_uuid(),
  pharmacie_id uuid not null references public.pharmacies (id) on delete cascade,
  debut        timestamptz not null,
  fin          timestamptz not null,
  source       text not null default 'admin' check (source in ('admin', 'pharmacie')),
  validee      boolean not null default false,
  cree_par     uuid references auth.users (id) on delete set null,
  cree_le      timestamptz not null default now(),
  check (fin > debut),
  check (fin - debut <= interval '7 days')
);
create index gardes_periode_idx on public.gardes (debut, fin);
create index gardes_pharmacie_idx on public.gardes (pharmacie_id, debut);
alter table public.gardes add constraint gardes_sans_doublon unique (pharmacie_id, debut, fin);

-- ---------------------------------------------------------------------------
-- Utilisateurs (profils liés à Supabase Auth)
-- ---------------------------------------------------------------------------

create table public.utilisateurs (
  id           uuid primary key references auth.users (id) on delete cascade,
  telephone    text,
  email        text,
  nom          text,
  role         text not null default 'patient'
                 check (role in ('patient', 'titulaire', 'employe', 'admin')),
  pharmacie_id uuid references public.pharmacies (id) on delete set null,
  cree_le      timestamptz not null default now(),
  check ((role in ('titulaire', 'employe')) = (pharmacie_id is not null))
);
create index utilisateurs_pharmacie_idx on public.utilisateurs (pharmacie_id);

-- Comptes administrateurs HULCE TECH : un e-mail listé ici reçoit le rôle admin
-- à sa première connexion. Personne d'autre ne peut devenir admin.
create table public.admins_autorises (
  email   text primary key check (email = lower(email)),
  ajoute_le timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Médicaments (base de référence)
-- ---------------------------------------------------------------------------

-- Concaténation pour la recherche. Déclarée immuable : sur du texte, le
-- résultat ne dépend que des arguments (array_to_string ne l'est pas d'office).
create or replace function public.texte_recherche(
  nom text, molecule text, dosage text, forme text, synonymes text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.normaliser(
    coalesce(nom, '') || ' ' || coalesce(molecule, '') || ' ' || coalesce(dosage, '') || ' ' ||
    coalesce(forme, '') || ' ' || coalesce(pg_catalog.array_to_string(synonymes, ' '), ''))
$$;

create table public.medicaments (
  id             uuid primary key default gen_random_uuid(),
  nom_commercial text not null check (length(btrim(nom_commercial)) > 1),
  molecule       text,
  dosage         text,
  forme          text,
  synonymes      text[] not null default '{}',
  actif          boolean not null default true,
  -- Texte de recherche : nom, molécule, dosage et synonymes, sans accents.
  recherche      text generated always as (
    public.texte_recherche(nom_commercial, molecule, dosage, forme, synonymes)
  ) stored,
  cree_le        timestamptz not null default now()
);
create index medicaments_recherche_trgm_idx on public.medicaments
  using gin (recherche extensions.gin_trgm_ops);
create unique index medicaments_unicite_idx on public.medicaments
  (public.normaliser(nom_commercial), public.normaliser(coalesce(dosage, '')), public.normaliser(coalesce(forme, '')));

-- ---------------------------------------------------------------------------
-- Demandes de disponibilité (lot 3) — tables créées dès le lot 0
-- ---------------------------------------------------------------------------

create table public.demandes (
  id             uuid primary key default gen_random_uuid(),
  medicament_id  uuid references public.medicaments (id) on delete set null,
  texte_libre    text,
  patient_id     uuid references auth.users (id) on delete set null,
  telephone      text,
  latitude       double precision,
  longitude      double precision,
  rayon_km       numeric(4, 1) not null default 3,
  filtre_cnamgs  boolean not null default false,
  canal          text not null default 'web' check (canal in ('web', 'whatsapp')),
  statut         text not null default 'ouverte' check (statut in ('ouverte', 'cloturee')),
  cree_le        timestamptz not null default now(),
  expire_le      timestamptz not null default now() + interval '15 minutes',
  check (medicament_id is not null or texte_libre is not null)
);
create index demandes_cree_le_idx on public.demandes (cree_le desc);
create index demandes_medicament_idx on public.demandes (medicament_id);
create index demandes_patient_idx on public.demandes (patient_id);

create table public.sollicitations (
  id            uuid primary key default gen_random_uuid(),
  demande_id    uuid not null references public.demandes (id) on delete cascade,
  pharmacie_id  uuid not null references public.pharmacies (id) on delete cascade,
  reponse       text check (reponse in ('oui', 'non', 'alternative', 'sans_reponse')),
  alternative   text,
  prix          numeric(12, 0) check (prix is null or prix >= 0),
  envoye_le     timestamptz not null default now(),
  repondu_le    timestamptz,
  unique (demande_id, pharmacie_id)
);
create index sollicitations_pharmacie_idx on public.sollicitations (pharmacie_id, envoye_le desc);

create table public.reservations (
  id                uuid primary key default gen_random_uuid(),
  sollicitation_id  uuid not null unique references public.sollicitations (id) on delete cascade,
  code_retrait      text not null check (code_retrait ~ '^\d{6}$'),
  statut            text not null default 'en_attente'
                      check (statut in ('en_attente', 'confirmee', 'retiree', 'annulee', 'expiree')),
  cree_le           timestamptz not null default now(),
  expire_le         timestamptz not null default now() + interval '30 minutes'
);

-- ---------------------------------------------------------------------------
-- Abonnements et paiements (lot 6)
-- ---------------------------------------------------------------------------

create table public.abonnements (
  id           uuid primary key default gen_random_uuid(),
  pharmacie_id uuid not null references public.pharmacies (id) on delete cascade,
  offre        text not null,
  debut        date not null,
  fin          date not null,
  statut       text not null default 'actif' check (statut in ('actif', 'impaye', 'termine')),
  check (fin >= debut)
);
create index abonnements_pharmacie_idx on public.abonnements (pharmacie_id, fin desc);

create table public.paiements (
  id            uuid primary key default gen_random_uuid(),
  abonnement_id uuid not null references public.abonnements (id) on delete cascade,
  montant       integer not null check (montant > 0),
  operateur     text not null check (operateur in ('airtel_money', 'moov_money')),
  reference     text,
  statut        text not null default 'en_attente' check (statut in ('en_attente', 'reussi', 'echoue')),
  cree_le       timestamptz not null default now()
);
create index paiements_abonnement_idx on public.paiements (abonnement_id);

-- ---------------------------------------------------------------------------
-- Journal des actions sensibles (ADM-07)
-- ---------------------------------------------------------------------------

create table public.journal (
  id      bigint generated always as identity primary key,
  auteur  uuid references auth.users (id) on delete set null,
  action  text not null,
  cible   text not null,
  details jsonb,
  date    timestamptz not null default now()
);
create index journal_date_idx on public.journal (date desc);

-- ---------------------------------------------------------------------------
-- Rôles
-- ---------------------------------------------------------------------------

create or replace function public.est_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.utilisateurs where id = auth.uid() and role = 'admin'
  )
$$;

-- Pharmacie de l'utilisateur connecté (titulaire ou employé), si elle est active.
create or replace function public.ma_pharmacie()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.pharmacie_id
  from public.utilisateurs u
  join public.pharmacies p on p.id = u.pharmacie_id
  where u.id = auth.uid()
    and u.role in ('titulaire', 'employe')
    and p.statut = 'active'
$$;

revoke all on function public.est_admin() from public, anon;
revoke all on function public.ma_pharmacie() from public, anon;
grant execute on function public.est_admin() to authenticated;
grant execute on function public.ma_pharmacie() to authenticated;

-- Profil créé à l'inscription ; rôle admin si l'e-mail est autorisé.
create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.utilisateurs (id, email, telephone, role)
  values (
    new.id,
    lower(new.email),
    new.phone,
    case when exists (select 1 from public.admins_autorises a where a.email = lower(new.email))
      then 'admin' else 'patient' end
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger creer_profil
after insert on auth.users
for each row execute function public.creer_profil();

-- ---------------------------------------------------------------------------
-- Horodatage et journal
-- ---------------------------------------------------------------------------

create or replace function public.pharmacies_modifiee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.modifie_le := now();
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    insert into public.journal (auteur, action, cible, details)
    values (auth.uid(), 'statut_pharmacie', new.id::text,
            jsonb_build_object('nom', new.nom, 'avant', old.statut, 'apres', new.statut));
  end if;
  return new;
end
$$;

create trigger pharmacies_modifiee
before insert or update on public.pharmacies
for each row execute function public.pharmacies_modifiee();

create or replace function public.journaliser_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.journal (auteur, action, cible, details)
  values (auth.uid(), 'suppression_' || tg_table_name, old.id::text, to_jsonb(old));
  return old;
end
$$;

create trigger pharmacies_suppression after delete on public.pharmacies
for each row execute function public.journaliser_suppression();
create trigger medicaments_suppression after delete on public.medicaments
for each row execute function public.journaliser_suppression();

-- ---------------------------------------------------------------------------
-- Règles d'accès (RLS)
-- ---------------------------------------------------------------------------

alter table public.pharmacies       enable row level security;
alter table public.horaires         enable row level security;
alter table public.gardes           enable row level security;
alter table public.utilisateurs     enable row level security;
alter table public.admins_autorises enable row level security;
alter table public.medicaments      enable row level security;
alter table public.demandes         enable row level security;
alter table public.sollicitations   enable row level security;
alter table public.reservations     enable row level security;
alter table public.abonnements      enable row level security;
alter table public.paiements        enable row level security;
alter table public.journal          enable row level security;

revoke all on public.pharmacies, public.horaires, public.gardes, public.utilisateurs,
  public.admins_autorises, public.medicaments, public.demandes, public.sollicitations,
  public.reservations, public.abonnements, public.paiements, public.journal
  from anon, authenticated;

-- Pharmacies : le public voit la fiche des pharmacies actives, sans le numéro
-- d'autorisation ni le titulaire. L'admin voit et gère tout. Une pharmacie voit
-- sa propre fiche (lot 5 : modification par le titulaire).
grant select (id, nom, adresse, commune, quartier, latitude, longitude, telephone,
              accepte_cnamgs, mutuelles, services, statut)
  on public.pharmacies to anon;
grant select, insert, update, delete on public.pharmacies to authenticated;

create policy pharmacies_public on public.pharmacies
  for select to anon using (statut = 'active');
create policy pharmacies_lecture on public.pharmacies
  for select to authenticated
  using (statut = 'active' or (select public.est_admin()) or id = (select public.ma_pharmacie()));
create policy pharmacies_admin_ajout on public.pharmacies
  for insert to authenticated with check ((select public.est_admin()));
create policy pharmacies_admin_modif on public.pharmacies
  for update to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));
create policy pharmacies_admin_suppr on public.pharmacies
  for delete to authenticated using ((select public.est_admin()));

-- Les colonnes sensibles restent lisibles par les comptes connectés via la
-- politique ci-dessus uniquement pour l'admin et la pharmacie elle-même :
-- un patient connecté passe par la vue publique.
revoke select on public.pharmacies from authenticated;
grant select (id, nom, adresse, commune, quartier, latitude, longitude, telephone,
              accepte_cnamgs, mutuelles, services, statut)
  on public.pharmacies to authenticated;
-- L'admin lit tout grâce aux fonctions d'administration (security definer) et à
-- la vue pharmacies_admin ci-dessous.

-- Horaires : publics pour les pharmacies actives, gérés par l'admin.
grant select on public.horaires to anon, authenticated;
grant insert, update, delete on public.horaires to authenticated;
create policy horaires_public on public.horaires
  for select to anon
  using (exists (select 1 from public.pharmacies p where p.id = pharmacie_id and p.statut = 'active'));
create policy horaires_lecture on public.horaires
  for select to authenticated
  using (exists (select 1 from public.pharmacies p where p.id = pharmacie_id and p.statut = 'active')
         or (select public.est_admin()));
create policy horaires_admin on public.horaires
  for all to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));

-- Gardes : le public voit les gardes validées des pharmacies actives.
grant select (id, pharmacie_id, debut, fin) on public.gardes to anon;
grant select, insert, update, delete on public.gardes to authenticated;
create policy gardes_public on public.gardes
  for select to anon
  using (validee and exists (select 1 from public.pharmacies p where p.id = pharmacie_id and p.statut = 'active'));
create policy gardes_lecture on public.gardes
  for select to authenticated
  using ((select public.est_admin())
         or pharmacie_id = (select public.ma_pharmacie())
         or (validee and exists (select 1 from public.pharmacies p where p.id = pharmacie_id and p.statut = 'active')));
create policy gardes_admin on public.gardes
  for all to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));

-- Utilisateurs : chacun lit son profil ; l'admin lit tout. Personne ne change
-- son propre rôle ni sa pharmacie.
grant select on public.utilisateurs to authenticated;
grant update (nom) on public.utilisateurs to authenticated;
create policy utilisateurs_lecture on public.utilisateurs
  for select to authenticated using (id = (select auth.uid()) or (select public.est_admin()));
create policy utilisateurs_nom on public.utilisateurs
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Médicaments : base de référence publique (recherche patient), gérée par l'admin.
grant select (id, nom_commercial, molecule, dosage, forme, synonymes, actif) on public.medicaments to anon;
grant select, insert, update, delete on public.medicaments to authenticated;
create policy medicaments_public on public.medicaments
  for select to anon using (actif);
create policy medicaments_lecture on public.medicaments
  for select to authenticated using (actif or (select public.est_admin()));
create policy medicaments_admin on public.medicaments
  for all to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));

-- Demandes et sollicitations : accès par fonctions dédiées au lot 3. D'ici là,
-- lecture admin ; une pharmacie ne voit que les sollicitations qui la visent.
grant select on public.demandes, public.sollicitations, public.reservations to authenticated;
create policy demandes_admin on public.demandes
  for select to authenticated using ((select public.est_admin()) or patient_id = (select auth.uid()));
create policy sollicitations_lecture on public.sollicitations
  for select to authenticated
  using ((select public.est_admin()) or pharmacie_id = (select public.ma_pharmacie()));
create policy reservations_lecture on public.reservations
  for select to authenticated
  using ((select public.est_admin()) or exists (
    select 1 from public.sollicitations s
    where s.id = sollicitation_id and s.pharmacie_id = (select public.ma_pharmacie())));

-- Abonnements et paiements : la pharmacie voit les siens, l'admin tout.
grant select on public.abonnements, public.paiements to authenticated;
create policy abonnements_lecture on public.abonnements
  for select to authenticated
  using ((select public.est_admin()) or pharmacie_id = (select public.ma_pharmacie()));
create policy paiements_lecture on public.paiements
  for select to authenticated
  using ((select public.est_admin()) or exists (
    select 1 from public.abonnements a
    where a.id = abonnement_id and a.pharmacie_id = (select public.ma_pharmacie())));

-- Journal et liste des admins : admin seulement, en lecture.
grant select on public.journal, public.admins_autorises to authenticated;
create policy journal_admin on public.journal
  for select to authenticated using ((select public.est_admin()));
create policy admins_autorises_admin on public.admins_autorises
  for select to authenticated using ((select public.est_admin()));

-- ---------------------------------------------------------------------------
-- Vue d'administration : fiche complète des pharmacies, admin seulement
-- ---------------------------------------------------------------------------

create or replace function public.pharmacies_admin()
returns setof public.pharmacies
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.pharmacies where public.est_admin() order by nom
$$;
revoke all on function public.pharmacies_admin() from public, anon;
grant execute on function public.pharmacies_admin() to authenticated;
