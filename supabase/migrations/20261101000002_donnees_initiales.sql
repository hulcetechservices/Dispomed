-- Données de départ.
--
-- 1. Administrateur HULCE TECH : cet e-mail reçoit le rôle admin à sa première
--    connexion au back-office.
-- 2. Base médicaments de démarrage : médicaments courants en officine, pour
--    tester la recherche et les demandes. À compléter ou remplacer par la source
--    retenue (question ouverte du cahier des charges, section 13), via l'import
--    du back-office. Un import ultérieur complète ces fiches sans les dupliquer.

insert into public.admins_autorises (email) values ('hulcetechservices@gmail.com')
on conflict do nothing;

-- Si le compte existe déjà dans Supabase Auth, lui donner le rôle maintenant.
insert into public.utilisateurs (id, email, role)
select u.id, lower(u.email), 'admin'
from auth.users u
join public.admins_autorises a on a.email = lower(u.email)
on conflict (id) do update set role = 'admin';

insert into public.medicaments (nom_commercial, molecule, dosage, forme, synonymes) values
  ('Paracétamol', 'paracétamol', '500 mg', 'comprimé', '{Doliprane,Efferalgan,Dafalgan}'),
  ('Paracétamol', 'paracétamol', '1 g', 'comprimé', '{Doliprane,Efferalgan,Dafalgan}'),
  ('Paracétamol', 'paracétamol', '2,4 %', 'sirop', '{Doliprane enfant,Efferalgan pédiatrique}'),
  ('Ibuprofène', 'ibuprofène', '400 mg', 'comprimé', '{Advil,Nurofen,Brufen}'),
  ('Ibuprofène', 'ibuprofène', '100 mg/5 ml', 'suspension buvable', '{Advil enfant,Nurofen enfant}'),
  ('Amoxicilline', 'amoxicilline', '500 mg', 'gélule', '{Clamoxyl}'),
  ('Amoxicilline', 'amoxicilline', '250 mg/5 ml', 'poudre pour suspension buvable', '{Clamoxyl}'),
  ('Amoxicilline + acide clavulanique', 'amoxicilline, acide clavulanique', '1 g/125 mg', 'comprimé', '{Augmentin}'),
  ('Artéméther + luméfantrine', 'artéméther, luméfantrine', '20 mg/120 mg', 'comprimé', '{Coartem,Coartem 24}'),
  ('Artésunate + amodiaquine', 'artésunate, amodiaquine', '100 mg/270 mg', 'comprimé', '{ASAQ,Coarsucam}'),
  ('Quinine', 'quinine', '300 mg', 'comprimé', '{Quinimax}'),
  ('Métronidazole', 'métronidazole', '250 mg', 'comprimé', '{Flagyl}'),
  ('Métronidazole', 'métronidazole', '500 mg', 'comprimé', '{Flagyl}'),
  ('Ciprofloxacine', 'ciprofloxacine', '500 mg', 'comprimé', '{Ciflox}'),
  ('Cotrimoxazole', 'sulfaméthoxazole, triméthoprime', '800 mg/160 mg', 'comprimé', '{Bactrim forte}'),
  ('Azithromycine', 'azithromycine', '250 mg', 'comprimé', '{Zithromax}'),
  ('Sels de réhydratation orale', 'sels de réhydratation orale', null, 'sachet', '{SRO}'),
  ('Zinc', 'sulfate de zinc', '20 mg', 'comprimé dispersible', '{}'),
  ('Oméprazole', 'oméprazole', '20 mg', 'gélule', '{Mopral}'),
  ('Metformine', 'metformine', '500 mg', 'comprimé', '{Glucophage}'),
  ('Metformine', 'metformine', '850 mg', 'comprimé', '{Glucophage}'),
  ('Amlodipine', 'amlodipine', '5 mg', 'comprimé', '{Amlor}'),
  ('Amlodipine', 'amlodipine', '10 mg', 'comprimé', '{Amlor}'),
  ('Hydrochlorothiazide', 'hydrochlorothiazide', '25 mg', 'comprimé', '{Esidrex}'),
  ('Captopril', 'captopril', '25 mg', 'comprimé', '{Lopril}'),
  ('Salbutamol', 'salbutamol', '100 µg/dose', 'aérosol', '{Ventoline}'),
  ('Prednisolone', 'prednisolone', '20 mg', 'comprimé', '{Solupred}'),
  ('Cétirizine', 'cétirizine', '10 mg', 'comprimé', '{Zyrtec}'),
  ('Loratadine', 'loratadine', '10 mg', 'comprimé', '{Clarityne}'),
  ('Albendazole', 'albendazole', '400 mg', 'comprimé', '{Zentel}'),
  ('Mébendazole', 'mébendazole', '100 mg', 'comprimé', '{Vermox}'),
  ('Fer + acide folique', 'sulfate ferreux, acide folique', null, 'comprimé', '{}'),
  ('Acide folique', 'acide folique', '5 mg', 'comprimé', '{Speciafoldine}'),
  ('Diclofénac', 'diclofénac', '50 mg', 'comprimé', '{Voltarène}'),
  ('Butylscopolamine', 'butylscopolamine', '10 mg', 'comprimé', '{Buscopan}'),
  ('Lopéramide', 'lopéramide', '2 mg', 'gélule', '{Imodium}'),
  ('Fluconazole', 'fluconazole', '150 mg', 'gélule', '{Triflucan}'),
  ('Clotrimazole', 'clotrimazole', '1 %', 'crème', '{}'),
  ('Insuline humaine', 'insuline humaine', '100 UI/ml', 'solution injectable', '{Actrapid,Insulatard}'),
  ('Glibenclamide', 'glibenclamide', '5 mg', 'comprimé', '{Daonil}')
on conflict do nothing;
