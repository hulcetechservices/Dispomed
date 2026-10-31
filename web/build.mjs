// Compilation : code découpé (site patient, back-office, code commun), noms à
// empreinte pour le cache, service worker avec la liste des fichiers à garder
// hors ligne. Usage : node build.mjs [--faux]
//   --faux : remplace Supabase par le faux client en mémoire (tests navigateur).
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ICI, 'dist');
const faux = process.argv.includes('--faux');
const min = !faux || process.argv.includes('--min'); // --min : version de test minifiée (mesure du poids)

await rm(DIST, { recursive: true, force: true });
await mkdir(path.join(DIST, 'assets'), { recursive: true });
await cp(path.join(ICI, 'public'), DIST, { recursive: true });

const resultat = await esbuild.build({
  entryPoints: [path.join(ICI, 'src/main.jsx')],
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: min,
  sourcemap: min ? false : 'inline',
  target: 'es2020', // Chrome et Safari récents, Android 8+ (cahier des charges §10)
  jsx: 'automatic',
  outdir: path.join(DIST, 'assets'),
  entryNames: 'app-[hash]',
  chunkNames: 'morceau-[hash]',
  metafile: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': min ? '"production"' : '"development"' },
  alias: faux ? { '@supabase/supabase-js': path.join(ICI, 'tests/e2e/faux-supabase.mjs') } : {},
  logLevel: 'warning',
});

const sorties = resultat.metafile.outputs;
const relatif = (f) => `/${path.relative(DIST, path.resolve(ICI, f)).split(path.sep).join('/')}`;
const [fichierEntree, entree] = Object.entries(sorties).find(([, o]) => o.entryPoint);
const js = relatif(fichierEntree);
const css = entree.cssBundle ? relatif(entree.cssBundle) : null;

const gabarit = await readFile(path.join(ICI, 'src/index.html'), 'utf8');
await writeFile(path.join(DIST, 'index.html'), gabarit.replace('%CSS%', css ?? '').replace('%JS%', js));

// Service worker : version = empreinte de tous les fichiers produits.
const fichiers = Object.keys(sorties).map(relatif);
const version = createHash('sha1').update(fichiers.sort().join('|')).digest('hex').slice(0, 10);
const sw = (await readFile(path.join(ICI, 'src/sw.js'), 'utf8'))
  .replace("'%VERSION%'", JSON.stringify(version))
  .replace("'%FICHIERS%'", JSON.stringify(['/', '/manifest.webmanifest', '/icones/icone-192.png', ...fichiers]));
await writeFile(path.join(DIST, 'sw.js'), sw);

// Poids de la page patient : entrée + morceaux importés au démarrage du site patient.
const poids = async (f) => (await readFile(path.resolve(ICI, f))).length;
const gz = async (f) => gzipSync(await readFile(path.resolve(ICI, f))).length;
const patient = Object.entries(sorties).find(([, o]) => o.inputs && Object.keys(o.inputs).some((i) => i.endsWith('src/patient/App.jsx')));
const pagePatient = [fichierEntree, entree.cssBundle, ...entree.imports.filter((i) => i.kind === 'import-statement').map((i) => i.path), patient?.[0],
  ...(patient?.[1].imports ?? []).filter((i) => i.kind === 'import-statement').map((i) => i.path)].filter(Boolean);
const uniques = [...new Set(pagePatient)];
let brut = 0; let compresse = 0;
for (const f of uniques) { brut += await poids(f); compresse += await gz(f); }
console.log(`dist/ prêt${faux ? ' (faux Supabase)' : ''} : page patient ${(brut / 1024).toFixed(0)} Ko (${(compresse / 1024).toFixed(0)} Ko compressés), ${fichiers.length} fichiers, version ${version}`);
