-- Tests du lot 0 (règles d'accès) et du lot 1 (fonctions du back-office).
-- Chaque vérification lève une exception en cas d'échec.
\set ON_ERROR_STOP on

create or replace function pg_temp.verifier(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition, false) then raise exception 'ÉCHEC : %', message; end if;
  raise notice 'ok  %', message;
end $$;
grant execute on function pg_temp.verifier(boolean, text) to anon, authenticated;

-- Refus attendu : on capture l'erreur de droits.
create or replace function pg_temp.refuse(requete text, message text)
returns void language plpgsql as $$
begin
  execute requete;
  raise exception 'ÉCHEC : % (accepté alors qu''il devait être refusé)', message;
exception when insufficient_privilege then
  raise notice 'ok  %', message;
end $$;
grant execute on function pg_temp.refuse(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- Comptes
-- admin : e-mail autorisé, profil créé par trigger avec le rôle admin.
-- patient : n'importe quel autre compte.
-- titulaire A : pharmacie A (active) ; titulaire S : pharmacie S (suspendue).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ad', 'HulceTechServices@gmail.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'patient@exemple.ga'),
  ('00000000-0000-0000-0000-0000000000a2', 'titulaire.a@exemple.ga'),
  ('00000000-0000-0000-0000-0000000000a3', 'titulaire.s@exemple.ga');

select pg_temp.verifier((select role from public.utilisateurs where id = '00000000-0000-0000-0000-0000000000ad') = 'admin',
  'e-mail autorisé : rôle admin à la création du compte (casse ignorée)');
select pg_temp.verifier((select role from public.utilisateurs where id = '00000000-0000-0000-0000-0000000000a1') = 'patient',
  'autre e-mail : rôle patient');

-- ---------------------------------------------------------------- Admin : lot 1
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ad';

select pg_temp.verifier(public.est_admin(), 'est_admin() vrai pour l''admin');

select public.enregistrer_pharmacie('{"nom":"Pharmacie A","commune":"akanda","quartier":"Angondjé",
  "latitude":0.53,"longitude":9.33,"numero_autorisation":"AUT-1","titulaire":"Dr A","accepte_cnamgs":true}'::jsonb);
select public.enregistrer_pharmacie('{"nom":"Pharmacie S","commune":"libreville","numero_autorisation":"AUT-2"}'::jsonb);
select pg_temp.verifier((select count(*) from public.pharmacies_admin()) = 2, 'admin : 2 pharmacies créées');
select pg_temp.verifier((select statut from public.pharmacies_admin() where nom = 'Pharmacie A') = 'en_attente',
  'nouvelle pharmacie en attente de validation');

select public.changer_statut_pharmacie((select id from public.pharmacies_admin() where nom = 'Pharmacie A'), 'active');
select public.changer_statut_pharmacie((select id from public.pharmacies_admin() where nom = 'Pharmacie S'), 'suspendue');
select pg_temp.verifier((select count(*) from public.journal where action = 'statut_pharmacie') = 2,
  'validation et suspension journalisées');

select pg_temp.verifier(public.definir_horaires((select id from public.pharmacies_admin() where nom = 'Pharmacie A'),
  '[{"jour":1,"ouverture":"08:00","fermeture":"12:30"},{"jour":1,"ouverture":"15:00","fermeture":"20:00"},
    {"jour":6,"ouverture":"08:00","fermeture":"00:00"}]'::jsonb) = 3,
  'horaires : 3 plages, dont une fermeture à minuit');

-- Import de pharmacies : aperçu puis import.
select pg_temp.verifier((public.importer_pharmacies('[
  {"ligne":2,"nom":"Pharmacie Bord de Mer","commune":"Libreville","quartier":"Glass","latitude":"0,40","longitude":"9,44","cnamgs":"oui"},
  {"ligne":3,"nom":"Pharmacie A","commune":"AKANDA","telephone":"+241 01 00 00 01"},
  {"ligne":4,"nom":"Pharmacie Inconnue","commune":"Franceville"},
  {"ligne":5,"nom":"Pharmacie Inversée","commune":"owendo","latitude":"9.4","longitude":"0.3"},
  {"ligne":6,"nom":"pharmacie bord de mer","commune":"libreville"}
]'::jsonb, true) ->> 'nb_valides')::int = 2, 'import pharmacies : 2 valides sur 5 (commune, position inversée, doublon)');
select pg_temp.verifier((select count(*) from public.pharmacies_admin()) = 2, 'aperçu : rien n''est écrit');
select public.importer_pharmacies('[
  {"ligne":2,"nom":"Pharmacie Bord de Mer","commune":"Libreville","quartier":"Glass","latitude":"0,40","longitude":"9,44","cnamgs":"oui"},
  {"ligne":3,"nom":"Pharmacie A","commune":"AKANDA","telephone":"+241 01 00 00 01"}
]'::jsonb, false);
select pg_temp.verifier((select count(*) from public.pharmacies_admin()) = 3, 'import : 1 créée, 1 mise à jour');
select pg_temp.verifier((select telephone from public.pharmacies_admin() where nom = 'Pharmacie A') = '+241 01 00 00 01'
  and (select accepte_cnamgs from public.pharmacies_admin() where nom = 'Pharmacie Bord de Mer'),
  'import : téléphone complété, CNAMGS lu depuis « oui »');

-- Gardes : import de la semaine.
select pg_temp.verifier((public.importer_gardes('[
  {"ligne":2,"pharmacie":"pharmacie a","commune":"Akanda","debut":"2026-11-02T20:00","fin":"2026-11-03T08:00"},
  {"ligne":3,"pharmacie":"Bord de Mer","debut":"2026-11-03T20:00","fin":"2026-11-04T08:00"},
  {"ligne":4,"pharmacie":"Pharmacie Fantôme","debut":"2026-11-03T20:00","fin":"2026-11-04T08:00"},
  {"ligne":5,"pharmacie":"Pharmacie A","debut":"2026-11-05T08:00","fin":"2026-11-05T07:00"},
  {"ligne":6,"pharmacie":"Pharmacie","debut":"2026-11-05T08:00","fin":"2026-11-05T20:00"}
]'::jsonb, true) ->> 'nb_valides')::int = 2, 'import gardes : 2 valides (nom approché reconnu ; introuvable, dates inversées, ambigu refusés)');
select public.importer_gardes('[
  {"ligne":2,"pharmacie":"pharmacie a","commune":"Akanda","debut":"2026-11-02T20:00","fin":"2026-11-03T08:00"},
  {"ligne":3,"pharmacie":"Bord de Mer","debut":"2026-11-03T20:00","fin":"2026-11-04T08:00"}
]'::jsonb, false);
select pg_temp.verifier((select count(*) from public.gardes where validee) = 2, 'gardes importées et validées');
select pg_temp.verifier((select debut from public.gardes g join public.pharmacies p on p.id = g.pharmacie_id where p.nom = 'Pharmacie A')
  = '2026-11-02 19:00:00+00', 'heure de garde lue à l''heure de Libreville (20 h = 19 h UTC)');
select pg_temp.verifier((public.importer_gardes('[
  {"ligne":2,"pharmacie":"pharmacie a","commune":"Akanda","debut":"2026-11-02T20:00","fin":"2026-11-03T08:00"}]'::jsonb, true)
  ->> 'deja_presentes')::int = 1, 'réimport : garde signalée comme déjà présente');
select public.ajouter_garde((select id from public.pharmacies_admin() where nom = 'Pharmacie S'),
  '2026-11-04 19:00+00', '2026-11-05 07:00+00');

-- Médicaments : import, recherche, fusion.
select pg_temp.verifier((public.importer_medicaments('[
  {"ligne":2,"nom_commercial":"Doliprane","molecule":"paracétamol","dosage":"500 mg","forme":"comprimé","synonymes":"Para 500; Paracetamol 500"},
  {"ligne":3,"nom_commercial":"Paracétamol","molecule":"paracétamol","dosage":"500 mg","forme":"comprimé"},
  {"ligne":4,"nom_commercial":"","dosage":"1 g"},
  {"ligne":5,"nom_commercial":"DOLIPRANE","dosage":"500 MG","forme":"Comprimé"}
]'::jsonb, false) ->> 'nb_valides')::int = 2, 'import médicaments : vide et doublon refusés');
select pg_temp.verifier((select count(*) from public.chercher_medicaments('parac')) >= 2,
  'recherche « parac » sans accent : suggestions dès 3 lettres');
select pg_temp.verifier((select count(*) from public.chercher_medicaments('pa')) = 0, 'moins de 3 lettres : aucune suggestion');
select public.fusionner_medicaments(
  (select id from public.medicaments where nom_commercial = 'Doliprane'),
  (select id from public.medicaments where nom_commercial = 'Paracétamol' and dosage = '500 mg'));
select pg_temp.verifier(
  (select 'Doliprane' = any (synonymes) and 'Para 500' = any (synonymes)
   from public.medicaments where nom_commercial = 'Paracétamol' and dosage = '500 mg'),
  'fusion : nom et synonymes du doublon conservés comme synonymes');
select pg_temp.verifier(
  exists (select 1 from public.chercher_medicaments('dolipr') where nom_commercial = 'Paracétamol' and dosage = '500 mg')
  and not exists (select 1 from public.medicaments where nom_commercial = 'Doliprane'),
  'après fusion, « dolipr » trouve le médicament gardé et le doublon a disparu');
select pg_temp.verifier((select count(*) from public.journal where action = 'fusion_medicaments') = 1, 'fusion journalisée');

-- ---------------------------------------------------------------- Patient connecté
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.verifier(not public.est_admin(), 'patient : pas admin');
select pg_temp.verifier((select count(*) from public.pharmacies) = 2, 'patient : voit les 2 pharmacies actives, pas la suspendue');
select pg_temp.verifier((select count(*) from public.pharmacies_admin()) = 0, 'patient : pharmacies_admin() vide');
select pg_temp.refuse('select numero_autorisation from public.pharmacies', 'patient : numéro d''autorisation illisible');
select pg_temp.refuse('select public.enregistrer_pharmacie(''{"nom":"X","commune":"akanda"}''::jsonb)', 'patient : création de pharmacie refusée');
select pg_temp.refuse('select public.changer_statut_pharmacie((select id from public.pharmacies limit 1), ''suspendue'')', 'patient : suspension refusée');
select pg_temp.refuse('select public.importer_gardes(''[]''::jsonb, false)', 'patient : import de gardes refusé');
select pg_temp.refuse('select public.fusionner_medicaments(gen_random_uuid(), gen_random_uuid())', 'patient : fusion refusée');
update public.pharmacies set nom = 'Piratée';
select pg_temp.verifier((select count(*) from public.pharmacies where nom = 'Piratée') = 0, 'patient : modification directe sans effet');
select pg_temp.refuse('update public.utilisateurs set role = ''admin'' where id = auth.uid()', 'patient : ne peut pas se donner le rôle admin');
select pg_temp.verifier((select count(*) from public.utilisateurs) = 1, 'patient : ne voit que son profil');
select pg_temp.verifier((select count(*) from public.journal) = 0, 'patient : journal invisible');
select pg_temp.verifier((select count(*) from public.gardes) = 2, 'patient : voit les gardes validées des pharmacies actives seulement');

-- ---------------------------------------------------------------- Titulaire (lot 5 : rattachement fait par l'admin)
reset role;
update public.utilisateurs set role = 'titulaire', pharmacie_id = (select id from public.pharmacies where nom = 'Pharmacie A')
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.utilisateurs set role = 'titulaire', pharmacie_id = (select id from public.pharmacies where nom = 'Pharmacie S')
  where id = '00000000-0000-0000-0000-0000000000a3';
insert into public.demandes (id, texte_libre) values ('30000000-0000-0000-0000-000000000001', 'test');
insert into public.sollicitations (demande_id, pharmacie_id)
select '30000000-0000-0000-0000-000000000001', id from public.pharmacies where nom in ('Pharmacie A', 'Pharmacie Bord de Mer');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.verifier(public.ma_pharmacie() = (select id from public.pharmacies where nom = 'Pharmacie A'), 'titulaire A : rattaché à A');
select pg_temp.verifier((select count(*) from public.sollicitations) = 1, 'titulaire A : ne voit que les sollicitations de A');
select pg_temp.verifier((select count(*) from public.demandes) = 0, 'titulaire A : ne lit pas les demandes des patients');
select pg_temp.refuse('select public.definir_horaires((select id from public.pharmacies where nom = ''Pharmacie A''), ''[]''::jsonb)',
  'titulaire : horaires gérés par l''admin au lot 1');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
select pg_temp.verifier(public.ma_pharmacie() is null, 'titulaire d''une pharmacie suspendue : aucun accès');
select pg_temp.verifier((select count(*) from public.sollicitations) = 0, 'pharmacie suspendue : aucune sollicitation visible');

-- ---------------------------------------------------------------- Public (anon)
reset request.jwt.claim.sub;
set role anon;
select pg_temp.verifier((select count(*) from public.pharmacies) = 2, 'public : 2 pharmacies actives visibles');
select pg_temp.refuse('select titulaire from public.pharmacies', 'public : nom du titulaire illisible');
select pg_temp.verifier((select count(*) from public.horaires) = 3, 'public : horaires des pharmacies actives');
select pg_temp.verifier((select count(*) from public.gardes) = 2, 'public : gardes validées visibles');
select pg_temp.refuse('select validee from public.gardes', 'public : colonnes internes des gardes illisibles');
select pg_temp.verifier((select count(*) from public.medicaments) > 30, 'public : base médicaments consultable');
select pg_temp.verifier((select count(*) from public.chercher_medicaments('amox')) >= 3, 'public : suggestions « amox »');
select pg_temp.refuse('select 1 from public.utilisateurs', 'public : utilisateurs illisibles');
select pg_temp.refuse('select 1 from public.demandes', 'public : demandes illisibles');
select pg_temp.refuse('select 1 from public.sollicitations', 'public : sollicitations illisibles');
select pg_temp.refuse('select 1 from public.journal', 'public : journal illisible');
select pg_temp.refuse('select public.est_admin()', 'public : est_admin() non exécutable');
select pg_temp.refuse('select public.importer_pharmacies(''[]''::jsonb, false)', 'public : import refusé');
select pg_temp.refuse('select * from public.pharmacies_admin()', 'public : pharmacies_admin() refusée');

reset role;
\echo 'TOUS LES TESTS SONT PASSÉS'
