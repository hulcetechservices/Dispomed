-- Imitation minimale de l'environnement Supabase, pour tester les migrations
-- sur un Postgres nu. NE PAS appliquer sur un projet Supabase.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);

-- Comme Supabase : l'utilisateur vient du JWT (ici, d'un paramètre de session).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase accorde par défaut tous les droits sur public à anon/authenticated ;
-- on reproduit ce comportement pour vérifier que la migration les retire bien.
alter default privileges in schema public grant all on tables to anon, authenticated;
