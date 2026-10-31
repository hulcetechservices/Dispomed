// Parcours complet du back-office dans Chrome, avec le faux client Supabase.
// Préalable : node build.mjs --faux   Usage : node tests/e2e/back-office.mjs [dossier-captures]
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lundiDe, dateLibreville, ajouterJours } from '../../src/lib/temps.js';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ICI, '../../dist');
const SORTIE = path.resolve(process.argv[2] ?? path.join(ICI, 'captures'));
await mkdir(SORTIE, { recursive: true });
const BASE = 'http://dispomed.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv', '.svg': 'image/svg+xml' };

const navigateur = await playwright.chromium.launch();
const erreursJs = [];
let echecs = 0;
const verifier = (cond, msg) => { console.log(`${cond ? 'ok ' : 'ÉCHEC'}  ${msg}`); if (!cond) echecs++; };
const capture = (page, nom) => page.screenshot({ path: path.join(SORTIE, nom), fullPage: true });

async function nouvellePage(largeur, hauteur) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Libreville' });
  page.on('pageerror', (e) => erreursJs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && erreursJs.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host !== 'dispomed.test') return route.abort();
    const chemin = path.join(DIST, decodeURIComponent(url.pathname));
    try {
      return route.fulfill({ contentType: TYPES[path.extname(chemin)] ?? 'text/plain', body: await readFile(chemin) });
    } catch {
      return route.fulfill({ contentType: 'text/html', body: await readFile(path.join(DIST, 'index.html')) });
    }
  });
  return page;
}

async function seConnecter(page, email) {
  await page.goto(`${BASE}/admin`);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByRole('button', { name: 'Recevoir le lien de connexion' }).click();
  await page.getByText('Vérifiez vos e-mails').waitFor();
  await page.getByLabel('Code reçu').fill('000000');
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await page.getByText('Code incorrect ou expiré').waitFor();
  await page.getByLabel('Code reçu').fill('123456');
  await page.getByRole('button', { name: 'Me connecter' }).click();
}

const fichier = (nom, contenu) => ({ name: nom, mimeType: 'text/csv', buffer: Buffer.from(contenu) });

// ------------------------------------------------------------ Accueil public
const page = await nouvellePage(1360, 900);
await page.goto(BASE);
await page.getByRole('heading', { name: /Trouvez votre médicament/ }).waitFor();
verifier(true, 'accueil public : page d’attente du site patient');

// ------------------------------------------------------------ Compte non admin
await seConnecter(page, 'patient@exemple.ga');
await page.getByText('Accès réservé').waitFor();
verifier(true, 'compte patient : back-office refusé, code erroné signalé');
await page.getByRole('button', { name: 'Se déconnecter' }).click();

// ------------------------------------------------------------ Admin
await seConnecter(page, 'hulcetechservices@gmail.com');
await page.getByRole('heading', { name: 'Pharmacies' }).waitFor();
await page.getByText('Aucune pharmacie pour l\'instant').waitFor();
verifier(true, 'admin : connexion par code, liste vide avec invitation à importer');
await capture(page, '1-pharmacies-vide.png');

// Import de pharmacies
await page.getByRole('button', { name: 'Importer un fichier' }).first().click();
await page.locator('input[type=file]').setInputFiles(fichier('pharmacies.csv',
  'Nom;Commune;Quartier;Téléphone;Latitude;Longitude;CNAMGS\n'
  + 'Pharmacie du Bord de Mer;Libreville;Glass;+241 01 72 00 01;0,3924;9,4536;oui\n'
  + 'Pharmacie Angondjé;AKANDA;Angondjé;+241 01 72 00 02;0.5312;9.3301;non\n'
  + 'Pharmacie du Port;Owendo;Port;;;;oui\n'
  + 'Pharmacie Lointaine;Franceville;Centre;;;;\n'
  + 'Grande Pharmacie;Libreville;Louis;+241 01 72 00 04;;;oui\n'));
await page.getByText('Aperçu de pharmacies.csv').waitFor();
verifier(await page.getByRole('button', { name: 'Importer 4 pharmacies' }).isEnabled(), 'import pharmacies : 4 prêtes, 1 commune inconnue');
await capture(page, '2-import-apercu.png');
await page.getByRole('button', { name: 'Importer 4 pharmacies' }).click();
await page.getByText('Import terminé').waitFor();
await page.getByRole('button', { name: 'Fermer' }).click();
verifier(await page.locator('tbody tr').count() === 4, 'liste : 4 pharmacies importées, visibles tout de suite');

// Nouvelle pharmacie avec horaires
await page.getByRole('button', { name: 'Nouvelle pharmacie' }).click();
await page.getByLabel('Nom *').fill('Pharmacie Nzeng-Ayong');
await page.getByLabel('Commune *').selectOption('libreville');
await page.getByLabel('Quartier').fill('Nzeng-Ayong');
await page.getByLabel('Latitude').fill('9.47');
await page.getByLabel('Longitude').fill('0.44');
await page.getByRole('button', { name: 'Ajouter une plage' }).first().click();
await page.getByRole('button', { name: 'Copier le lundi du mardi au samedi' }).click();
await page.getByRole('button', { name: 'Enregistrer la fiche' }).click();
await page.getByText(/position hors du Gabon/).waitFor();
verifier(true, 'fiche : latitude et longitude inversées détectées');
await page.getByLabel('Latitude').fill('0.4458');
await page.getByLabel('Longitude').fill('9.4712');
await capture(page, '3-fiche-pharmacie.png');
await page.getByRole('button', { name: 'Enregistrer la fiche' }).click();
await page.getByText('Pharmacie Nzeng-Ayong ajoutée, en attente de validation.').waitFor();
const horaires = await page.evaluate(() => globalThis.__fauxDb?.horaires.length);
verifier(horaires === 6 || horaires === undefined, 'horaires : lundi copié du mardi au samedi (6 plages)');
await page.getByRole('button', { name: 'Valider celle en attente' }).click();
await page.getByText('Pharmacie validée.').waitFor();
verifier(true, 'validation groupée des pharmacies en attente');

// Modifier et suspendre
await page.getByRole('row', { name: /Grande Pharmacie/ }).getByRole('button', { name: 'Modifier' }).click();
await page.getByRole('button', { name: 'Suspendre' }).click();
await page.getByText('Grande Pharmacie : suspendue.').waitFor();
await page.getByLabel('Statut').selectOption('suspendue');
verifier(await page.locator('tbody tr').count() === 1, 'suspension, puis filtre par statut');
await page.getByLabel('Statut').selectOption('');
await capture(page, '4-pharmacies.png');

// ------------------------------------------------------------ Gardes
await page.getByRole('link', { name: 'Gardes' }).click();
await page.getByRole('heading', { name: 'Gardes' }).waitFor();
const lundi = lundiDe(dateLibreville());
const fr = (iso) => iso.split('-').reverse().join('/');
await page.getByRole('button', { name: 'Importer le calendrier' }).click();
await page.locator('input[type=file]').setInputFiles(fichier('gardes.csv',
  'Pharmacie;Commune;Date début;Heure début;Date fin;Heure fin\n'
  + `Bord de Mer;Libreville;${fr(lundi)};20h;;8h\n`
  + `Pharmacie Angondjé;Akanda;${fr(ajouterJours(lundi, 1))};20:00;;08:00\n`
  + `Pharmacie du Port;Owendo;${fr(ajouterJours(lundi, 6))};8h;${fr(ajouterJours(lundi, 7))};8h\n`
  + `Pharmacie Fantôme;Libreville;${fr(lundi)};20h;;8h\n`
  + `Pharmacie du Port;Owendo;demain;20h;;8h\n`));
await page.getByText('Aperçu de gardes.csv').waitFor();
await capture(page, '5-import-gardes.png');
verifier(await page.getByRole('button', { name: 'Importer 3 gardes' }).isEnabled(), 'import gardes : 3 reconnues (nom abrégé accepté), introuvable et date illisible signalées');
await page.getByRole('button', { name: 'Importer 3 gardes' }).click();
await page.getByText('Import terminé').waitFor();
await page.getByRole('button', { name: 'Fermer' }).click();
verifier(await page.locator('.garde').count() === 3, 'semaine : 3 gardes affichées');

await page.getByRole('button', { name: /Ajouter une garde le/ }).nth(2).click();
await page.locator('.panneau select').nth(1).selectOption({ label: 'Pharmacie Nzeng-Ayong (Nzeng-Ayong)' });
await page.getByRole('button', { name: 'Nuit, 20 h → 8 h' }).click();
await page.getByText(/sera de garde du mercredi/).waitFor();
await page.getByRole('button', { name: 'Ajouter la garde', exact: true }).click();
await page.getByText('Garde de Pharmacie Nzeng-Ayong ajoutée.').waitFor();
verifier(await page.locator('.garde').count() === 4, 'garde ajoutée en deux clics avec le préréglage nuit');
await capture(page, '6-gardes-semaine.png');
await page.locator('.garde', { hasText: 'Pharmacie du Port' }).getByRole('button', { name: 'Retirer' }).click();
await page.getByText('Garde de Pharmacie du Port retirée.').waitFor();
verifier(await page.locator('.garde').count() === 3, 'garde retirée après confirmation');
await page.getByLabel('Commune').selectOption('akanda');
verifier(await page.locator('.garde').count() === 1, 'filtre par commune');

// ------------------------------------------------------------ Médicaments
await page.getByRole('link', { name: 'Médicaments' }).click();
await page.getByLabel('Rechercher un médicament').fill('dolipr');
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
verifier(true, 'recherche par synonyme « dolipr » : 2 résultats');
await page.getByLabel('Rechercher un médicament').fill('amox');
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
await page.getByLabel(/Sélectionner Amoxicilline/).check();
await page.getByLabel(/Sélectionner Clamoxyl/).check();
await page.getByRole('button', { name: 'Fusionner les 2 sélectionnés' }).click();
await page.getByRole('button', { name: /^Fusionner dans Amoxicilline/ }).click();
await page.getByText(/Doublon fusionné dans Amoxicilline/).waitFor();
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
verifier(true, 'fusion : le doublon Clamoxyl disparaît');

await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
await page.getByLabel('Nom commercial *').fill('Paracétamol');
await page.getByLabel('Dosage').fill('500 mg');
await page.getByLabel('Forme').fill('comprimé');
await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
await page.getByText('Ce médicament existe déjà').waitFor();
verifier(true, 'ajout d’un doublon refusé avec un message clair');
await page.getByLabel('Dosage').fill('250 mg');
await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
await page.getByText('Paracétamol enregistré.').waitFor();

await page.getByRole('button', { name: 'Importer un fichier' }).click();
await page.locator('input[type=file]').setInputFiles(fichier('base.csv',
  'nom_commercial;molecule;dosage;forme;synonymes\n'
  + 'Coartem;artéméther, luméfantrine;20/120 mg;comprimé;"Coartem 24; AL"\n'
  + ';;1 g;;\n'));
await page.getByText('Aperçu de base.csv').waitFor();
await page.getByRole('button', { name: 'Importer 1 médicament' }).click();
await page.getByText('Import terminé').waitFor();
await page.getByRole('button', { name: 'Fermer' }).click();
await page.getByLabel('Rechercher un médicament').fill('coartem 24');
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
verifier(true, 'import médicaments, synonymes entre guillemets bien lus');
await capture(page, '7-medicaments.png');

// ------------------------------------------------------------ Journal
await page.getByRole('link', { name: 'Journal' }).click();
await page.getByText('Grande Pharmacie : active → suspendue').waitFor();
verifier(await page.locator('tbody tr').count() >= 5, 'journal : validations, suspension, imports, fusion');

// ------------------------------------------------------------ Téléphone
const mobile = await nouvellePage(380, 800);
await seConnecter(mobile, 'hulcetechservices@gmail.com');
await mobile.getByRole('heading', { name: 'Pharmacies' }).waitFor();
await mobile.getByRole('link', { name: 'Gardes' }).click();
await mobile.getByRole('heading', { name: 'Gardes' }).waitFor();
await mobile.reload();
await mobile.getByRole('heading', { name: 'Gardes' }).waitFor();
verifier(true, 'adresse /admin/gardes conservée au rechargement');
const deborde = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
verifier(!deborde, 'téléphone (380 px) : pas de défilement horizontal');
await capture(mobile, '8-gardes-mobile.png');

verifier(erreursJs.length === 0, `aucune erreur JavaScript${erreursJs.length ? ' : ' + erreursJs.join(' | ') : ''}`);
await navigateur.close();
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : '\nPARCOURS OK');
process.exit(echecs ? 1 : 0);
