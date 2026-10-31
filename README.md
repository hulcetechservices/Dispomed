# Dispomed

Trouver le bon médicament dans la bonne pharmacie, avant de se déplacer.
Ce dépôt contient la **semaine 1** de la spécification v0.1 : l'espace officine.

| Fait | Pas encore |
| --- | --- |
| Comptes pharmaciens rattachés à une officine, vérifiés à la main | Comptes patients, vérification des pièces (semaine 2) |
| Stock, seuils d'alerte, liste « à commander » | Réservations, non-retraits, pénalités (semaines 2-3) |
| Import CSV / Excel avec aperçu et lignes en erreur | Dépôt automatique, connexion au logiciel (après le pilote) |
| Règle de fraîcheur 12 h / 48 h | Connexion par code SMS |
| Monnaies et moyens de paiement de l'officine | Application patient |
| Vue publique `disponibilites` limitée aux champs prévus | |

## Ce qui protège les données

La règle « un pharmacien ne voit et ne modifie que son officine » est appliquée **dans la base**,
pas dans l'interface (spec §3 et §9) :

- Row Level Security sur chaque table. L'officine est déduite du compte connecté
  (`mon_officine()`), jamais lue dans la requête du client.
- Droits par colonne : un pharmacien ne peut ni changer d'officine, ni se déclarer vérifié,
  ni renommer son officine, ni écrire lui-même la date de confirmation du stock.
- Le public (clé anon) ne lit aucune table. Il ne voit que la vue `disponibilites` :
  officine, produit, prix, monnaies, paiements, fraîcheur. Ni quantité exacte, ni seuil,
  ni donnée de compte.
- Un compte non vérifié ne voit rien et ne peut rien importer.

`supabase/tests/isolation.sql` vérifie ces règles (30 contrôles).

## Structure

```
supabase/
  migrations/   schéma, RLS, fonctions importer_stock() et confirmer_stock()
  tests/        tests d'isolation sur un Postgres local jetable
app/            espace officine, HTML + modules JS, sans étape de build
  config.js     URL Supabase et clé publishable à renseigner
  src/csv.js    lecture des fichiers de stock (testée)
  src/vues/     stock, importer, à commander, mon officine
  tests/        tests unitaires + parcours complet dans Chrome
```

L'application n'a pas d'étape de build : supabase-js et SheetJS (Excel) sont chargés depuis
un CDN. On peut la servir telle quelle (Vercel, Netlify, n'importe quel hébergement statique).

## Mise en route

### 1. Base de données

Créez un projet Supabase (région la plus proche : `eu-west`), puis appliquez la migration :

```bash
supabase link --project-ref VOTRE_REF
supabase db push
```

ou collez `supabase/migrations/20261031000001_semaine1_officines_stock.sql` dans l'éditeur SQL.

### 2. Application

`app/config.js` pointe vers le projet Supabase « dispomed » (région Paris), avec la clé
publique anon. Jamais la clé `service_role`.

Déploiement : projet Vercel « dispomed », dossier racine `app`, sans commande de build.
`app/vercel.json` ajoute les en-têtes de sécurité (scripts limités au site, au CDN et à Supabase).

Dans Supabase > Authentication > URL Configuration, ajoutez l'adresse du site
(pour le lien « mot de passe oublié »).

Pour tester en local :

```bash
cd app && npx serve .
```

### 3. Créer un compte pharmacien (équipe Dispomed)

1. Vérifiez le numéro d'inscription à l'Ordre.
2. Supabase > Authentication > Users > *Add user* : e-mail et mot de passe provisoire.
3. Dans l'éditeur SQL :

```sql
-- Une fois par officine
insert into public.officines (nom, adresse, quartier, telephone, monnaies, moyens_paiement)
values ('Pharmacie …', 'Adresse', 'Quartier', '+241 …', array['XAF'], array['especes','airtel_money'])
returning id;

-- Rattacher le compte, déjà vérifié
insert into public.pharmaciens (user_id, officine_id, nom, numero_ordre, verifie)
select id, 'ID_OFFICINE', 'Dr …', 'N° ORDRE', true
from auth.users where email = 'pharmacien@exemple.ga';
```

Le pharmacien se connecte, change son mot de passe via « mot de passe oublié »,
puis importe son stock.

## Import du stock

Colonnes reconnues (accents et casse indifférents) :

| Champ | Intitulés acceptés | Obligatoire |
| --- | --- | --- |
| Code produit | code, code produit, CIP, EAN, référence… | oui |
| Nom | nom, désignation, libellé, produit… | pour un produit nouveau |
| Quantité | quantité, qté, stock… | oui |
| Prix | prix, prix de vente, PV, PPV… | non |

Séparateur `;`, `,` ou tabulation, détecté automatiquement. Encodage UTF-8 ou Windows-1252.
Deux modes : mettre à jour les seuls produits du fichier, ou remplacer (les absents passent à 0,
pour l'export complet du logiciel). L'aperçu est calculé par la base sans rien écrire.

Un modèle est fourni : `app/modele-stock.csv`.

## Tests

```bash
bash supabase/tests/run.sh            # isolation entre officines (Postgres 15+ local)
cd app && npm test                    # lecture CSV, formats
node tests/e2e/parcours.mjs           # parcours complet dans Chrome (Playwright)
```

Le parcours navigateur remplace Supabase par un faux client en mémoire
(`app/tests/e2e/faux-supabase.mjs`) : il teste l'interface, pas les règles d'accès,
qui sont testées par `isolation.sql`.

## Points ouverts

- **Codes produits** (spec §4) : le référentiel `produits` se remplit avec les codes des fichiers.
  Tant qu'aucun code commun n'est fixé avec les éditeurs, deux officines peuvent nommer
  différemment le même médicament. À trancher avant d'ouvrir la recherche patient.
- **Connexion par SMS** : prévue par la spec, elle demande un fournisseur SMS branché à Supabase Auth.
- **Juridique** (spec §7) : rien dans ce lot ne stocke de pièce d'identité ni de donnée de santé.
