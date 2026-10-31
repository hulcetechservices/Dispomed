// Parcours pharmacien dans Chrome, avec le faux client Supabase.
// Usage : node tests/e2e/parcours.mjs [dossier-captures]
// Nécessite Playwright (npm i -g playwright) et un Chromium.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const ICI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(ICI, '../..');
const SORTIE = path.resolve(process.argv[2] ?? path.join(ICI, 'captures'));
await mkdir(SORTIE, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv' };
const BASE = 'http://dispomed.test/';

const navigateur = await playwright.chromium.launch({
  executablePath: process.env.CHROME ?? undefined,
});
const erreurs = [];
let echecs = 0;
const verifier = (cond, msg) => { console.log(`${cond ? 'ok ' : 'ÉCHEC'}  ${msg}`); if (!cond) echecs++; };

async function nouvellePage(largeur, hauteur) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
  page.on('pageerror', (e) => erreurs.push(e.message));
  // Les polices et CDN sont coupés pendant le test : leurs échecs de chargement sont attendus.
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && erreurs.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.href.includes('@supabase/supabase-js')) {
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(ICI, 'faux-supabase.mjs')) });
    }
    if (url.host === 'dispomed.test') {
      if (url.pathname === '/config.js') {
        return route.fulfill({ contentType: 'text/javascript', body: "export const SUPABASE_URL='https://demo.supabase.co'; export const SUPABASE_ANON_KEY='demo';" });
      }
      const fichier = path.join(APP, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      try {
        return route.fulfill({ contentType: TYPES[path.extname(fichier)] ?? 'application/octet-stream', body: await readFile(fichier) });
      } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort(); // polices, CDN : hors ligne pendant le test
  });
  return page;
}

// ------------------------------------------------------------ Bureau
const page = await nouvellePage(1280, 900);
await page.goto(BASE);
await page.getByLabel('Adresse e-mail').fill('dr@pharmacie.ga');
await page.getByLabel('Mot de passe').fill('faux');
await page.getByRole('button', { name: 'Se connecter' }).click();
await page.getByText('Adresse e-mail ou mot de passe incorrect.').waitFor();
verifier(true, 'mauvais mot de passe : message clair');
await page.screenshot({ path: path.join(SORTIE, '1-connexion.png') });

await page.getByLabel('Mot de passe').fill('motdepasse-test');
await page.getByRole('button', { name: 'Se connecter' }).click();
await page.getByRole('heading', { name: 'Stock' }).waitFor();
verifier(await page.locator('h1').textContent() === "Pharmacie de l'Estuaire", 'connecté : arrive sur son officine');
verifier(await page.locator('#lignes tr').count() === 6, '6 produits affichés');
verifier(await page.locator('[data-compteur="commander"]').textContent() === '2', 'pastille : 2 produits à commander');
await page.screenshot({ path: path.join(SORTIE, '2-stock.png'), fullPage: true });

// Modifier une quantité
const ligneAmox = page.locator('tr', { hasText: 'AMOX500' });
await ligneAmox.locator('input.quantite').fill('25');
await ligneAmox.locator('input.quantite').press('Enter');
await page.getByText('Amoxicilline 500 mg, boîte de 12 : 25 en stock, confirmé.').waitFor();
verifier(await page.locator('tr', { hasText: 'AMOX500' }).getAttribute('class') === 'recent', 'quantité modifiée : ligne confirmée et hors alerte');
verifier(await page.locator('[data-compteur="commander"]').textContent() === '1', 'pastille mise à jour : 1');

// Filtre et confirmation groupée
await page.getByRole('button', { name: 'À revoir' }).click();
verifier(await page.locator('#lignes tr').count() === 2, 'filtre « À revoir » : 2 produits');
await page.getByRole('button', { name: 'Confirmer les quantités affichées' }).click();
await page.getByText('2 quantités confirmées.').waitFor();
verifier(await page.locator('#lignes tr', { hasText: 'Aucun produit' }).count() === 1, 'après confirmation, plus rien à revoir');

// Import
await page.getByRole('link', { name: 'Importer', exact: true }).click();
await page.getByRole('heading', { name: 'Importer le stock' }).waitFor();
const csv = 'Code CIP;Désignation;Qté;Prix de vente\nPARA500;Paracétamol 500 mg;35;1500\nNOUV1;Amlodipine 5 mg;12;2100\n;Sans code;4;\nAMOX500;Amox;-3;\nNOUV2;;5;\n';
await page.locator('#fichier').setInputFiles({ name: 'export-logiciel.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.getByText('lignes prêtes').waitFor();
verifier(await page.locator('#valider').textContent() === 'Importer 2 produits', 'aperçu : 2 lignes prêtes, 3 en erreur');
await page.locator('input[value="remplacement"]').check();
await page.getByText('produits absents passés à zéro').waitFor();
await page.screenshot({ path: path.join(SORTIE, '3-import-apercu.png'), fullPage: true });
await page.locator('input[value="mise_a_jour"]').check();
await page.getByRole('button', { name: 'Importer 2 produits' }).waitFor();
await page.getByRole('button', { name: 'Importer 2 produits' }).click();
await page.getByText('Stock importé : 2 produits mis à jour et confirmés.').waitFor();
verifier(await page.locator('#historique tbody tr').count() === 1, 'import historisé');

// Fichier sans colonne quantité
await page.getByRole('button', { name: 'Choisir un autre fichier' }).click();
await page.locator('#fichier').setInputFiles({ name: 'mauvais.csv', mimeType: 'text/csv', buffer: Buffer.from('ref,libelle\nA,B\n') });
await page.getByText('Colonne introuvable : quantité.').waitFor();
verifier(true, 'colonne manquante : message et colonnes lues');

// À commander
await page.getByRole('link', { name: /À commander/ }).click();
await page.getByRole('heading', { name: 'À commander' }).waitFor();
verifier(await page.locator('table.tableau tbody tr').count() === 1, 'à commander : SRO seul');
await page.screenshot({ path: path.join(SORTIE, '4-commander.png'), fullPage: true });

// Mon officine
await page.getByRole('link', { name: 'Mon officine' }).click();
await page.getByLabel('Moov Money').check();
await page.getByLabel('Horaires').fill('Lun.-sam. 8 h-21 h');
await page.getByRole('button', { name: 'Enregistrer les informations' }).click();
await page.getByText('Informations enregistrées.').waitFor();
verifier(true, 'officine : paiements et horaires enregistrés');
await page.screenshot({ path: path.join(SORTIE, '5-officine.png'), fullPage: true });

// Injection HTML dans un nom de produit importé : doit rester du texte
await page.getByRole('link', { name: 'Importer', exact: true }).click();
await page.locator('#fichier').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('code;nom;quantite\nXSS1;<img src=x onerror="window.pirate=1">;3\n') });
await page.getByRole('button', { name: 'Importer 1 produit' }).click();
await page.getByText('Stock importé : 1 produit mis à jour et confirmé.').waitFor();
await page.getByRole('link', { name: 'Stock', exact: true }).click();
await page.getByText('<img src=x onerror="window.pirate=1">').waitFor();
verifier(await page.evaluate(() => window.pirate === undefined), 'nom de produit piégé affiché comme texte, non exécuté');

// ------------------------------------------------------------ Téléphone
const mobile = await nouvellePage(390, 844);
await mobile.goto(BASE);
await mobile.getByLabel('Adresse e-mail').fill('dr@pharmacie.ga');
await mobile.getByLabel('Mot de passe').fill('motdepasse-test');
await mobile.getByRole('button', { name: 'Se connecter' }).click();
await mobile.getByRole('heading', { name: 'Stock' }).waitFor();
const deborde = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
verifier(!deborde, 'téléphone : pas de défilement horizontal');
await mobile.screenshot({ path: path.join(SORTIE, '6-stock-mobile.png'), fullPage: true });

verifier(erreurs.length === 0, `aucune erreur JavaScript${erreurs.length ? ' : ' + erreurs.join(' | ') : ''}`);
await navigateur.close();
await writeFile(path.join(SORTIE, 'resultat.txt'), echecs ? `${echecs} échec(s)` : 'ok');
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : '\nPARCOURS OK');
process.exit(echecs ? 1 : 0);
