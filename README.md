# Plateforme Pharmacies Gabon

Un patient du Grand Libreville trouve un médicament **sans faire le tour des pharmacies** :
il envoie une demande de disponibilité aux pharmacies proches, qui répondent Oui, Non ou
Alternative, et il voit les réponses en direct. La plateforme affiche aussi les pharmacies
de garde et celles qui acceptent la CNAMGS. Aucune connexion au stock des pharmacies
n'est nécessaire.

Référence : *Cahier des charges — Plateforme Pharmacies Gabon* (31 octobre 2026).

En ligne : **https://dispomed-tan.vercel.app** (site patient) et `/admin` (back-office).

## Avancement par lot

| Lot | Contenu | État |
| --- | --- | --- |
| 0 | Schéma Supabase (section 8), règles d'accès, déploiement | Fait |
| 1 | Back-office : pharmacies, horaires, gardes, base médicaments (ADM-01 à 03) | Fait |
| 2 | Site patient : carte, fiches, gardes, filtre CNAMGS, PWA | Fait |
| 3 | Demande de disponibilité, réponses en direct, clôture à 15 min | À faire |
| 4 | WhatsApp : notifications pharmacie, bot patient | À faire |
| 5 | Tableau de bord pharmacie : OTP, employés, statistiques | À faire |
| 6 | Abonnements Mobile Money, réservations | À faire |

L'ancien prototype « gestion de stock » est archivé dans la branche
`archive/espace-officine-stock` (l'import de stock est prévu en version 2).

## Site patient (lot 2)

- **Pharmacies de garde en ce moment** par défaut, ou toutes les pharmacies, avec l'état
  calculé à l'heure de Libreville : « De garde jusqu'à 8 h », « Ouverte jusqu'à 20 h »,
  « Fermée, ouvre demain à 8 h ». Une pharmacie de garde est ouverte pendant toute sa garde,
  même hors horaires (RG-07).
- **Position** : GPS, ou quartier choisi dans une liste (sans GPS). Tri : ouvertes d'abord,
  puis les plus proches.
- **Filtre CNAMGS**, sur la liste et sur les gardes.
- **Fiche pharmacie** : appel et itinéraire en un clic, adresse et carte, horaires de la
  semaine, gardes à venir, assurances et services.
- **Carte** OpenStreetMap (gardes en bleu nuit, ouvertes en vert).
- **Nuit** (20 h–7 h) : affichage sombre, moins éblouissant.
- **Hors ligne** : dernière liste gardée sur le téléphone, affichée avec sa date ; site
  installable (PWA). Page patient : environ 340 Ko, le back-office est chargé à part.
- Testé en 3G simulée : la garde la plus proche s'affiche en 7 secondes (critère : 30 s).

## Back-office (lot 1)

- **Connexion sans mot de passe** : lien (et code) envoyé par e-mail. Seuls les e-mails de
  la table `admins_autorises` reçoivent le rôle admin ; tout autre compte voit « Accès réservé ».
- **Pharmacies** : liste filtrable, fiche complète (position sur carte OpenStreetMap,
  horaires à plusieurs plages, CNAMGS, mutuelles, services), validation, suspension,
  réactivation, import Excel/CSV avec aperçu.
- **Gardes** : semaine par commune, ajout en deux clics (préréglages nuit 20 h → 8 h, 24 h),
  import du calendrier Excel/CSV. Noms de pharmacie abrégés reconnus s'ils sont sans
  ambiguïté ; heures à l'heure de Libreville.
- **Médicaments** : recherche (accents ignorés, synonymes), ajout, modification,
  fusion des doublons, import.
- **Journal** : validations, suspensions, imports, fusions, suppressions.

Modèles d'import : `web/public/modeles/` (pharmacies, gardes, médicaments).

## Sécurité des données

Règles appliquées dans la base (RLS), testées par `supabase/tests/acces.sql` (54 contrôles) :

- le public voit les fiches des pharmacies **actives** (sans numéro d'autorisation ni
  titulaire), leurs horaires, les gardes **validées** et la base médicaments ;
- une pharmacie ne voit que les sollicitations qui la visent, jamais les demandes des
  patients ni les autres pharmacies ;
- toutes les fonctions d'administration vérifient le rôle admin côté serveur ;
- personne ne peut modifier son propre rôle ; les actions sensibles sont journalisées.

## Structure

```
supabase/
  migrations/   schéma, règles d'accès, fonctions, données de départ
  tests/        tests SQL sur un Postgres local jetable (bash supabase/tests/run.sh)
web/            application React (site patient, back-office), compilée par esbuild
  src/admin/    back-office
  src/lib/      Supabase, lecture des fichiers, dates à l'heure de Libreville
  tests/        tests unitaires et parcours complet dans Chrome
```

## Déploiement

- **Base** : projet Supabase « dispomed » (Paris). Les migrations de `supabase/migrations`
  y sont appliquées dans l'ordre.
- **Site** : projet Vercel « dispomed », relié au dépôt GitHub. Chaque push sur `main`
  compile `web/` (`npm run build`) et publie `web/dist`. En-têtes de sécurité dans
  `web/vercel.json`.
- **Supabase Auth** : *Site URL* = `https://dispomed-tan.vercel.app`, et
  `https://dispomed-tan.vercel.app/**` dans les *Redirect URLs*, pour que le lien de
  connexion ramène au back-office.

## Ajouter un administrateur

```sql
insert into public.admins_autorises (email) values ('prenom.nom@exemple.ga');
```

La personne se connecte ensuite sur `/admin` avec cette adresse.

## Tests

```bash
bash supabase/tests/run.sh          # règles d'accès et fonctions (Postgres 15+)
cd web && npm test                  # lecture des fichiers, dates et heures
npm run e2e                         # back-office et site patient dans Chrome (faux Supabase, 3G simulée)
```

## Questions ouvertes (cahier des charges, section 13)

Nom commercial et domaine, source de la base médicaments (une base de départ de
40 références courantes est chargée), fournisseur SMS pour l'OTP par téléphone,
agrégateur Mobile Money, numéro WhatsApp Business, zone pilote.
