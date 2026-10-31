// Parcours patient (lot 2) dans Chrome, avec le faux client Supabase et un
// réseau lent simulé. Préalable : node build.mjs --faux --min
// Usage : node tests/e2e/patient.mjs [dossier-captures]
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ICI, '../../dist');
const SORTIE = path.resolve(process.argv[2] ?? path.join(ICI, 'captures'));
await mkdir(SORTIE, { recursive: true });
const BASE = 'https://dispomed.test'; // HTTPS : la géolocalisation l'exige
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

// Réseau 3G prudent : 300 ms de latence, 50 Ko/s. Requêtes Supabase : 800 ms.
const LATENCE = 300;
const DEBIT = 50 * 1024;
const DELAI_SUPABASE = 800;

const h = (heures) => (instant) => new Date(instant.getTime() + heures * 3600e3).toISOString();
function donneesEssai(maintenant) {
  const tous = (id) => [1, 2, 3, 4, 5, 6, 7].map((jour) => ({ pharmacie_id: id, jour, ouverture: '00:00:00', fermeture: '00:00:00' }));
  const semaine = (id) => [1, 2, 3, 4, 5, 6].flatMap((jour) => [
    { pharmacie_id: id, jour, ouverture: '08:00:00', fermeture: '12:30:00' },
    { pharmacie_id: id, jour, ouverture: '15:00:00', fermeture: '20:00:00' }]);
  return {
    pharmacies: [
      { id: 'a0000000-0000-4000-8000-000000000001', nom: 'Pharmacie du Bord de Mer', commune: 'libreville', quartier: 'Glass', adresse: 'Boulevard Triomphal', latitude: 0.3924, longitude: 9.4536, telephone: '+241 01 72 00 01', accepte_cnamgs: true, mutuelles: ['Ascoma'], services: ['vaccination'], statut: 'active' },
      { id: 'a0000000-0000-4000-8000-000000000002', nom: 'Pharmacie Angondjé', commune: 'akanda', quartier: 'Angondjé', latitude: 0.5312, longitude: 9.3301, telephone: '+241 01 72 00 02', accepte_cnamgs: false, mutuelles: [], services: [], statut: 'active' },
      { id: 'a0000000-0000-4000-8000-000000000003', nom: 'Pharmacie du Port', commune: 'owendo', quartier: 'Port', latitude: null, longitude: null, telephone: null, accepte_cnamgs: true, mutuelles: [], services: [], statut: 'active' },
      { id: 'a0000000-0000-4000-8000-000000000004', nom: 'Grande Pharmacie de Louis', commune: 'libreville', quartier: 'Louis', latitude: 0.4170, longitude: 9.4400, telephone: '+241 01 72 00 04', accepte_cnamgs: false, mutuelles: [], services: [], statut: 'active' },
    ],
    horaires: [...semaine('a0000000-0000-4000-8000-000000000001'), ...tous('a0000000-0000-4000-8000-000000000002'), ...semaine('a0000000-0000-4000-8000-000000000004')],
    gardes: [
      { pharmacie_id: 'a0000000-0000-4000-8000-000000000001', debut: h(-3)(maintenant), fin: h(9)(maintenant) },
      { pharmacie_id: 'a0000000-0000-4000-8000-000000000004', debut: h(-3)(maintenant), fin: h(9)(maintenant) },
      { pharmacie_id: 'a0000000-0000-4000-8000-000000000001', debut: h(48)(maintenant), fin: h(60)(maintenant) },
    ],
  };
}

const navigateur = await playwright.chromium.launch();
const erreursJs = [];
let echecs = 0;
const verifier = (cond, msg) => { console.log(`${cond ? 'ok ' : 'ÉCHEC'}  ${msg}`); if (!cond) echecs++; };
const capture = (page, nom) => page.screenshot({ path: path.join(SORTIE, nom), fullPage: true });

async function nouvellePage({ largeur = 390, hauteur = 844, maintenant, position = { latitude: 0.3930, longitude: 9.4545 } }) {
  const contexte = await navigateur.newContext({
    viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Libreville',
    geolocation: position, permissions: ['geolocation'], serviceWorkers: 'block',
  });
  const page = await contexte.newPage();
  await page.clock.setFixedTime(maintenant);
  const donnees = donneesEssai(maintenant);
  await page.addInitScript(([d, delai]) => { window.__fauxDonnees = d; window.__fauxDelai = delai; }, [donnees, DELAI_SUPABASE]);
  page.on('pageerror', (e) => erreursJs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && erreursJs.push(m.text()));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host !== 'dispomed.test') return route.abort(); // cartes et CDN : coupés
    const chemin = path.join(DIST, decodeURIComponent(url.pathname));
    let corps; let type;
    try { corps = await readFile(chemin); type = TYPES[path.extname(chemin)] ?? 'text/plain'; }
    catch { corps = await readFile(path.join(DIST, 'index.html')); type = 'text/html'; }
    await new Promise((ok) => setTimeout(ok, LATENCE + (corps.length / DEBIT) * 1000));
    return route.fulfill({ contentType: type, body: corps });
  });
  return page;
}

const premiereCarte = (page) => page.locator('.carte-pharmacie').first();

// ------------------------------------------------------------ Lundi 10 h 30, en 3G
const LUNDI_10H30 = new Date('2026-11-02T09:30:00Z');
const page = await nouvellePage({ maintenant: LUNDI_10H30 });
const debut = Date.now();
await page.goto(BASE);
await page.getByRole('heading', { name: '2 pharmacies de garde en ce moment' }).waitFor();
const tempsAffichage = (Date.now() - debut) / 1000;
await page.getByRole('button', { name: 'Me localiser' }).click();
await page.getByRole('heading', { name: '2 pharmacies de garde près de vous en ce moment' }).waitFor();
const tempsGarde = (Date.now() - debut) / 1000;
verifier(tempsGarde < 30, `3G simulée : gardes affichées en ${tempsAffichage.toFixed(1)} s, la plus proche en ${tempsGarde.toFixed(1)} s (critère : 30 s)`);
verifier((await premiereCarte(page).locator('.titre-pharmacie').textContent()) === 'Pharmacie du Bord de Mer', 'la garde la plus proche est en tête');
verifier(/De garde jusqu'à/.test(await premiereCarte(page).locator('.etat').textContent()), 'état « De garde jusqu’à … » affiché');
verifier(/m$|km$/.test(await premiereCarte(page).locator('.distance').textContent()), 'distance affichée');
verifier((await premiereCarte(page).getByRole('link', { name: 'Appeler' }).getAttribute('href')) === 'tel:+24101720001', 'bouton Appeler : ouvre le composeur');
await capture(page, '1-gardes-jour.png');

await page.getByLabel('Accepte la CNAMGS').check();
verifier(await page.locator('.carte-pharmacie').count() === 1, 'filtre CNAMGS sur les gardes : 1 pharmacie');
await page.getByLabel('Accepte la CNAMGS').uncheck();

await page.getByRole('button', { name: 'Toutes' }).click();
verifier(await page.locator('.carte-pharmacie').count() === 4, 'toutes les pharmacies : 4');
verifier(await page.locator('.carte-pharmacie', { hasText: 'Angondjé' }).locator('.etat').textContent() === 'Ouverte 24 h/24', 'pharmacie 24 h/24 ouverte');
verifier(await page.locator('.carte-pharmacie', { hasText: 'Port' }).locator('.etat').textContent() === 'Horaires non renseignés', 'horaires manquants signalés honnêtement');

await page.getByLabel('Ou choisissez votre quartier').selectOption({ label: 'Angondjé' });
verifier((await premiereCarte(page).locator('.titre-pharmacie').textContent()) === 'Pharmacie Angondjé', 'sans GPS : quartier choisi, pharmacie du quartier en tête');

await page.getByRole('button', { name: 'Carte' }).click();
await page.getByText("La carte n'a pas pu se charger").waitFor();
verifier(true, 'carte indisponible (réseau coupé) : message clair, la liste reste accessible');
await page.getByRole('button', { name: 'Liste' }).click();

// Fiche
await page.getByRole('link', { name: 'Pharmacie du Bord de Mer' }).click();
await page.getByRole('heading', { name: 'Pharmacie du Bord de Mer' }).waitFor();
verifier(page.url().endsWith('/pharmacie/a0000000-0000-4000-8000-000000000001'), 'fiche : adresse propre à la pharmacie');
verifier((await page.getByRole('link', { name: 'Itinéraire' }).getAttribute('href')).includes('destination=0.3924,9.4536'), 'itinéraire en un clic vers la position exacte');
verifier(await page.getByText('Accepte la CNAMGS').count() === 1, 'fiche : CNAMGS indiqué');
verifier(/Lundi/.test(await page.locator('tr.aujourdhui').textContent()), 'fiche : horaires du jour mis en évidence');
verifier(await page.locator('.liste-simple li').count() === 2, 'fiche : gardes à venir');
await capture(page, '2-fiche.png');
await page.reload();
await page.getByRole('heading', { name: 'Pharmacie du Bord de Mer' }).waitFor();
verifier(true, 'fiche rechargée directement depuis son adresse');
await page.getByRole('button', { name: 'Retour à la liste' }).click();
await page.locator('.carte-pharmacie').first().waitFor();

// Hors ligne : Supabase injoignable, la dernière liste reste affichée
await page.evaluate(() => { window.__fauxHorsLigne = true; });
await page.addInitScript(() => { window.__fauxHorsLigne = true; });
await page.reload();
await page.getByText(/Hors ligne : informations du/).waitFor();
verifier(await page.locator('.carte-pharmacie').count() > 0, 'hors ligne : dernières informations affichées, avec leur date');
await capture(page, '3-hors-ligne.png');

// ------------------------------------------------------------ Lundi 22 h 30 : nuit
const LUNDI_22H30 = new Date('2026-11-02T21:30:00Z');
const nuit = await nouvellePage({ maintenant: LUNDI_22H30 });
await nuit.goto(BASE);
await nuit.getByRole('heading', { name: /de garde/ }).waitFor();
verifier(await nuit.evaluate(() => document.documentElement.dataset.moment) === 'nuit', 'après 20 h : affichage de nuit');
await nuit.getByRole('button', { name: 'Toutes' }).click();
const etatBordDeMer = await nuit.locator('.carte-pharmacie', { hasText: 'Bord de Mer' }).locator('.etat').textContent();
verifier(/De garde/.test(etatBordDeMer), 'la nuit, la pharmacie de garde est ouverte malgré ses horaires (RG-07)');
verifier(await nuit.locator('.carte-pharmacie').first().locator('.etat').textContent() !== 'Horaires non renseignés', 'la nuit : pharmacies ouvertes en tête');
const deborde = await nuit.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
verifier(!deborde, 'téléphone (390 px) : pas de défilement horizontal');
await nuit.getByRole('button', { name: 'De garde' }).click();
await capture(nuit, '4-nuit.png');

// Petit écran (360 px, minimum du cahier des charges)
const petit = await nouvellePage({ largeur: 360, hauteur: 740, maintenant: LUNDI_10H30 });
await petit.goto(BASE);
await petit.locator('.carte-pharmacie').first().waitFor();
verifier(!(await petit.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'écran de 360 px : pas de défilement horizontal');

// Le back-office reste servi à part
await petit.goto(`${BASE}/admin`);
await petit.getByRole('button', { name: 'Recevoir le lien de connexion' }).waitFor();
verifier(true, 'back-office chargé à la demande sur /admin');

verifier(erreursJs.length === 0, `aucune erreur JavaScript${erreursJs.length ? ' : ' + erreursJs.join(' | ') : ''}`);
await navigateur.close();
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : '\nPARCOURS OK');
process.exit(echecs ? 1 : 0);
