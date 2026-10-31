-- Tests d'isolation entre officines (spec §3) et de l'import (spec §4).
-- Chaque vérification lève une exception en cas d'échec.
\set ON_ERROR_STOP on

-- Jeu de données : deux officines, un pharmacien vérifié dans chacune,
-- un pharmacien non vérifié dans la première.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test');

insert into public.officines (id, nom) values
  ('10000000-0000-0000-0000-00000000000a', 'Pharmacie A'),
  ('10000000-0000-0000-0000-00000000000b', 'Pharmacie B');

insert into public.pharmaciens (user_id, officine_id, nom, numero_ordre, verifie) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Dr A', 'ORD-A', true),
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Dr B', 'ORD-B', true),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'Dr C', 'ORD-C', false);

insert into public.produits (id, code, nom) values
  ('20000000-0000-0000-0000-000000000001', 'PARA500', 'Paracétamol 500 mg'),
  ('20000000-0000-0000-0000-000000000002', 'AMOX500', 'Amoxicilline 500 mg');

insert into public.stocks (officine_id, produit_id, quantite, seuil_alerte) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 40, 10),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000001', 3, 10),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 12, 5);

create or replace function pg_temp.verifier(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not condition then raise exception 'ÉCHEC : %', message; end if;
  raise notice 'ok  %', message;
end $$;
grant execute on function pg_temp.verifier(boolean, text) to anon, authenticated;

-- ------------------------------------------------------------------ Pharmacien A
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select pg_temp.verifier(public.mon_officine() = '10000000-0000-0000-0000-00000000000a',
  'A est rattaché à la Pharmacie A');
select pg_temp.verifier((select count(*) from public.officines) = 1,
  'A ne voit qu''une officine');
select pg_temp.verifier((select count(*) from public.stocks) = 1,
  'A ne voit que son stock');
select pg_temp.verifier((select count(*) from public.mon_stock) = 1,
  'mon_stock limité à A');
select pg_temp.verifier((select count(*) from public.pharmaciens) = 1,
  'A ne voit que sa fiche pharmacien');

-- Modifier le stock de B : 0 ligne touchée, sans erreur (RLS filtre).
update public.stocks set quantite = 999
where officine_id = '10000000-0000-0000-0000-00000000000b';

-- Insérer dans B : refusé.
do $$ begin
  insert into public.stocks (officine_id, produit_id, quantite)
  values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 1);
  raise exception 'ÉCHEC : A a pu écrire dans le stock de B';
exception when insufficient_privilege then
  raise notice 'ok  A ne peut pas insérer dans le stock de B';
end $$;

-- Déplacer sa ligne vers B : refusé (colonne officine_id non modifiable).
do $$ begin
  update public.stocks set officine_id = '10000000-0000-0000-0000-00000000000b';
  raise exception 'ÉCHEC : A a pu déplacer une ligne vers B';
exception when insufficient_privilege then
  raise notice 'ok  A ne peut pas déplacer une ligne vers B';
end $$;

-- Antidater/postdater la confirmation : refusé.
do $$ begin
  update public.stocks set confirme_le = now() + interval '10 days';
  raise exception 'ÉCHEC : A a pu écrire confirme_le';
exception when insufficient_privilege then
  raise notice 'ok  confirme_le non modifiable par le client';
end $$;

-- Se rattacher à B ou se déclarer vérifié : refusé.
do $$ begin
  update public.pharmaciens set officine_id = '10000000-0000-0000-0000-00000000000b';
  raise exception 'ÉCHEC : A a pu modifier sa fiche pharmacien';
exception when insufficient_privilege then
  raise notice 'ok  fiche pharmacien non modifiable';
end $$;

-- Renommer son officine : refusé ; changer ses paiements : autorisé.
do $$ begin
  update public.officines set nom = 'Autre';
  raise exception 'ÉCHEC : A a pu renommer l''officine';
exception when insufficient_privilege then
  raise notice 'ok  nom de l''officine non modifiable';
end $$;
update public.officines set moyens_paiement = array['especes', 'airtel_money'];
select pg_temp.verifier(
  (select moyens_paiement from public.officines) = array['especes', 'airtel_money'],
  'A peut modifier ses moyens de paiement');

-- Confirmer un produit de B via la fonction : 0 ligne.
select pg_temp.verifier(
  public.confirmer_stock(array['20000000-0000-0000-0000-000000000002'::uuid]) = 0,
  'confirmer_stock ignore les produits de B');

-- Import : simulation, sans écriture.
select pg_temp.verifier(
  (public.importer_stock('[
     {"ligne":2,"code":"PARA500","quantite":"25","prix":"1 500"},
     {"ligne":3,"code":"IBU400","nom":"Ibuprofène 400 mg","quantite":"8"},
     {"ligne":4,"code":"","quantite":"3"},
     {"ligne":5,"code":"XYZ","quantite":"4"},
     {"ligne":6,"code":"PARA500","quantite":"1"},
     {"ligne":7,"code":"AMOX500","quantite":"-2"}
   ]'::jsonb, 'mise_a_jour', true) ->> 'nb_valides')::int = 2,
  'simulation : 2 lignes valides sur 6');
select pg_temp.verifier(
  (select quantite from public.stocks where produit_id = '20000000-0000-0000-0000-000000000001') = 40,
  'simulation : aucune écriture');

-- Import réel en remplacement.
select public.importer_stock('[
  {"ligne":2,"code":"IBU400","nom":"Ibuprofène 400 mg","quantite":"8","prix":"2500,50"}
]'::jsonb, 'remplacement', false, 'export.csv');

select pg_temp.verifier(
  (select quantite from public.mon_stock where code = 'IBU400') = 8,
  'import : IBU400 ajouté avec 8');
select pg_temp.verifier(
  (select prix from public.mon_stock where code = 'IBU400') = 2500.50,
  'import : prix avec virgule accepté');
select pg_temp.verifier(
  (select quantite from public.mon_stock where code = 'PARA500') = 0,
  'remplacement : PARA500 absent du fichier passé à 0');
select pg_temp.verifier(
  (select count(*) from public.imports_stock) = 1,
  'import historisé');
select pg_temp.verifier(
  (select count(*) from public.a_reapprovisionner) = 1,
  'PARA500 à 0 apparaît dans le réapprovisionnement');

-- ------------------------------------------------------------------ Pharmacien B
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.verifier(
  (select quantite from public.stocks where produit_id = '20000000-0000-0000-0000-000000000001') = 3,
  'le stock de B n''a pas été touché par A');
select pg_temp.verifier(
  (select count(*) from public.stocks) = 2, 'B voit ses 2 lignes');
select pg_temp.verifier(
  (select count(*) from public.imports_stock) = 0, 'B ne voit pas les imports de A');

-- ------------------------------------------------------------------ Non vérifié
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.verifier(public.mon_officine() is null, 'C non vérifié : aucune officine');
select pg_temp.verifier((select count(*) from public.stocks) = 0, 'C ne voit aucun stock');
do $$ begin
  perform public.importer_stock('[]'::jsonb, 'mise_a_jour', false);
  raise exception 'ÉCHEC : C a pu importer';
exception when insufficient_privilege then
  raise notice 'ok  C ne peut pas importer';
end $$;

-- ------------------------------------------------------------------ Public
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  perform 1 from public.stocks;
  raise exception 'ÉCHEC : le public lit la table stocks';
exception when insufficient_privilege then
  raise notice 'ok  le public ne lit pas les tables';
end $$;
do $$ begin
  perform 1 from public.pharmaciens;
  raise exception 'ÉCHEC : le public lit les pharmaciens';
exception when insufficient_privilege then
  raise notice 'ok  le public ne lit pas les pharmaciens';
end $$;
select pg_temp.verifier(
  (select count(*) from public.disponibilites) = 3,
  'vue publique : 3 produits en stock (> 0)');
select pg_temp.verifier(
  not exists (
    select 1 from information_schema.columns
    where table_name = 'disponibilites'
      and column_name in ('quantite', 'seuil_alerte', 'numero_ordre', 'user_id')),
  'vue publique : ni quantité, ni seuil, ni donnée de compte');
do $$ begin
  perform public.importer_stock('[]'::jsonb);
  raise exception 'ÉCHEC : le public peut appeler importer_stock';
exception when insufficient_privilege then
  raise notice 'ok  le public ne peut pas importer';
end $$;

do $$ begin
  perform 1 from public.mon_stock;
  raise exception 'ÉCHEC : le public lit mon_stock';
exception when insufficient_privilege then
  raise notice 'ok  le public ne lit pas mon_stock';
end $$;

reset role;
\echo 'TOUS LES TESTS SONT PASSÉS'
