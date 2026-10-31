// Compilation de l'application : un seul fichier JS et un CSS, empreinte dans
// le nom pour le cache. Usage : node build.mjs [--faux] [--surveiller]
//   --faux : remplace Supabase par le faux client en mémoire (tests navigateur).
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ICI, 'dist');
const faux = process.argv.includes('--faux');

await rm(DIST, { recursive: true, force: true });
await mkdir(path.join(DIST, 'assets'), { recursive: true });
await cp(path.join(ICI, 'public'), DIST, { recursive: true });

const resultat = await esbuild.build({
  entryPoints: [path.join(ICI, 'src/main.jsx')],
  bundle: true,
  minify: !faux,
  sourcemap: faux ? 'inline' : false,
  format: 'esm',
  target: 'es2020', // Chrome et Safari récents, Android 8+ (cahier des charges §10)
  jsx: 'automatic',
  write: false,
  outdir: path.join(DIST, 'assets'),
  entryNames: 'app',
  loader: { '.css': 'css' },
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': faux ? '"development"' : '"production"' },
  // Dépendances installées localement hors du projet (environnement sans registre npm).
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [],
  alias: faux ? { '@supabase/supabase-js': path.join(ICI, 'tests/e2e/faux-supabase.mjs') } : {},
  logLevel: 'warning',
});

const fichiers = {};
for (const sortie of resultat.outputFiles) {
  const ext = path.extname(sortie.path);
  const empreinte = createHash('sha1').update(sortie.contents).digest('hex').slice(0, 10);
  const nom = `app.${empreinte}${ext}`;
  fichiers[ext] = `/assets/${nom}`;
  await writeFile(path.join(DIST, 'assets', nom), sortie.contents);
}

const gabarit = await readFile(path.join(ICI, 'src/index.html'), 'utf8');
await writeFile(
  path.join(DIST, 'index.html'),
  gabarit.replace('%CSS%', fichiers['.css'] ?? '').replace('%JS%', fichiers['.js']),
);

const taille = resultat.outputFiles.reduce((t, f) => t + f.contents.length, 0);
console.log(`dist/ prêt${faux ? ' (faux Supabase)' : ''} : ${(taille / 1024).toFixed(0)} Ko de JS et CSS`);
