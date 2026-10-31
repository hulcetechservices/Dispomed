import { supabase, messageErreur } from '../supabase.js';
import { analyserCsv, versLignesImport } from '../csv.js';
import { html, brut, formaterNombre, depuis } from '../format.js';
import { notifier, mettreAJourCompteur } from '../ui.js';

const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const TAILLE_MAX = 10 * 1024 * 1024;

let courant = null; // { fichier, lignes, rapport }

export async function afficher(main) {
  courant = null;
  main.innerHTML = html`
    <h2>Importer le stock</h2>
    <p class="discret">Utilisez l'export de votre logiciel de gestion, ou notre modèle.
      Colonnes reconnues : code produit, nom, quantité, prix (facultatif).
      Les intitulés courants sont acceptés (« Code CIP », « Désignation », « Qté »…).</p>
    <ol class="etapes">
      <li class="etape">
        <h3>Choisir le fichier</h3>
        <div class="depot" id="depot">
          <p>Glissez votre fichier ici, ou</p>
          <label class="bouton secondaire">Choisir un fichier
            <input type="file" id="fichier" accept=".csv,.txt,.xlsx,.xls,text/csv" hidden>
          </label>
          <p class="discret">CSV ou Excel, 10 Mo maximum.
            <a href="modele-stock.csv" download>Télécharger le modèle CSV</a></p>
        </div>
        <fieldset class="modes">
          <legend>Que faire des produits absents du fichier ?</legend>
          <label><input type="radio" name="mode" value="mise_a_jour" checked>
            <span><b>Les laisser tels quels</b><span class="discret">Pour un fichier partiel : seuls les produits du fichier changent.</span></span></label>
          <label><input type="radio" name="mode" value="remplacement">
            <span><b>Les passer à zéro</b><span class="discret">Pour l'export complet de votre logiciel : ce qui n'y figure pas est considéré comme épuisé.</span></span></label>
        </fieldset>
      </li>
      <li class="etape" id="etape-apercu" aria-disabled="true">
        <h3>Vérifier l'aperçu</h3>
        <div id="apercu"><p class="discret">L'aperçu apparaît ici une fois le fichier choisi. Rien n'est enregistré à cette étape.</p></div>
      </li>
      <li class="etape" id="etape-valider" aria-disabled="true">
        <h3>Importer</h3>
        <div class="barre">
          <button type="button" id="valider" disabled>Importer</button>
          <button type="button" class="secondaire" id="annuler" hidden>Choisir un autre fichier</button>
        </div>
        <div id="resultat"></div>
      </li>
    </ol>
    <section>
      <h3>Derniers imports</h3>
      <div id="historique"><p class="discret">Chargement…</p></div>
    </section>`;

  const input = main.querySelector('#fichier');
  const depot = main.querySelector('#depot');
  input.addEventListener('change', () => input.files[0] && lireFichier(main, input.files[0]));
  depot.addEventListener('dragover', (e) => { e.preventDefault(); depot.classList.add('survol'); });
  depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
  depot.addEventListener('drop', (e) => {
    e.preventDefault();
    depot.classList.remove('survol');
    const f = e.dataTransfer.files[0];
    if (f) lireFichier(main, f);
  });
  main.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => courant && simuler(main)));
  main.querySelector('#valider').addEventListener('click', () => importer(main));
  main.querySelector('#annuler').addEventListener('click', () => afficher(main));

  chargerHistorique(main);
}

const mode = (main) => main.querySelector('input[name="mode"]:checked').value;

async function lireTableau(fichier) {
  const nom = fichier.name.toLowerCase();
  if (nom.endsWith('.xlsx') || nom.endsWith('.xls')) {
    const XLSX = await import(SHEETJS);
    const classeur = XLSX.read(await fichier.arrayBuffer(), { type: 'array' });
    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    return XLSX.utils.sheet_to_json(feuille, { header: 1, raw: false, defval: '' });
  }
  let texte = await fichier.text();
  // Exports Windows en Latin-1 : caractères illisibles → on relit en windows-1252.
  if (texte.includes('�')) {
    texte = new TextDecoder('windows-1252').decode(await fichier.arrayBuffer());
  }
  return analyserCsv(texte);
}

async function lireFichier(main, fichier) {
  const zone = main.querySelector('#apercu');
  main.querySelector('#resultat').innerHTML = '';
  if (fichier.size > TAILLE_MAX) {
    zone.innerHTML = '<p class="erreur">Fichier trop lourd (10 Mo maximum).</p>';
    return;
  }
  zone.innerHTML = html`<p class="discret">Lecture de ${fichier.name}…</p>`;
  main.querySelector('#etape-apercu').setAttribute('aria-disabled', 'false');

  let tableau;
  try {
    tableau = await lireTableau(fichier);
  } catch {
    zone.innerHTML = html`<p class="erreur">Impossible de lire ${fichier.name}. Enregistrez-le en CSV depuis votre logiciel puis réessayez.</p>`;
    return;
  }

  const { lignes, manquantes, entetes } = versLignesImport(tableau);
  if (manquantes.length) {
    const noms = { code: 'code produit', quantite: 'quantité' };
    zone.innerHTML = html`
      <p class="erreur">Colonne introuvable : ${manquantes.map((m) => noms[m]).join(' et ')}.</p>
      <p>Colonnes lues dans le fichier : ${entetes.filter(Boolean).join(', ') || 'aucune'}.
        Renommez la colonne concernée (par exemple « code » ou « quantite ») ou partez du modèle CSV.</p>`;
    return;
  }
  if (lignes.length === 0) {
    zone.innerHTML = '<p class="erreur">Le fichier ne contient aucune ligne de produit.</p>';
    return;
  }
  if (lignes.length > 10000) {
    zone.innerHTML = '<p class="erreur">Fichier trop long : 10 000 produits maximum par import.</p>';
    return;
  }
  courant = { fichier: fichier.name, lignes, rapport: null };
  await simuler(main);
}

async function simuler(main) {
  const zone = main.querySelector('#apercu');
  zone.innerHTML = '<p class="discret">Vérification des lignes…</p>';
  const { data: rapport, error } = await supabase.rpc('importer_stock', {
    lignes: courant.lignes, mode: mode(main), simulation: true, fichier: courant.fichier,
  });
  if (error) { zone.innerHTML = html`<p class="erreur">${messageErreur(error)}</p>`; return; }
  courant.rapport = rapport;

  const enErreur = new Set(rapport.erreurs.map((e) => e.ligne));
  const exemples = courant.lignes.filter((l) => !enErreur.has(l.ligne)).slice(0, 8);

  zone.innerHTML = html`
    <p><b>${courant.fichier}</b></p>
    <div class="bilan">
      <div><strong>${formaterNombre(rapport.nb_valides)}</strong><span>lignes prêtes</span></div>
      <div class="${rapport.nb_erreurs ? 'ko' : ''}"><strong>${formaterNombre(rapport.nb_erreurs)}</strong><span>lignes en erreur, ignorées</span></div>
      <div><strong>${formaterNombre(rapport.nouveaux_produits)}</strong><span>nouveaux produits</span></div>
      ${rapport.mode === 'remplacement'
        ? brut(html`<div class="${rapport.mis_a_zero ? 'ko' : ''}"><strong>${formaterNombre(rapport.mis_a_zero)}</strong><span>produits absents passés à zéro</span></div>`)
        : ''}
    </div>
    ${rapport.erreurs.length ? brut(html`
      <details ${rapport.erreurs.length <= 10 ? brut('open') : ''}>
        <summary>Voir les ${formaterNombre(rapport.erreurs.length)} lignes en erreur</summary>
        <ul class="liste-erreurs">
          ${rapport.erreurs.map((e) => brut(html`<li>Ligne ${e.ligne}${e.code ? ` (${e.code})` : ''} : ${e.motifs.join(', ')}</li>`))}
        </ul>
      </details>`) : ''}
    ${exemples.length ? brut(html`
      <div class="defile">
        <table class="apercu">
          <caption class="discret" style="text-align:left">Premières lignes valides</caption>
          <thead><tr><th>Ligne</th><th>Code</th><th>Nom</th><th class="num">Quantité</th><th class="num">Prix</th></tr></thead>
          <tbody>${exemples.map((l) => brut(html`<tr><td>${l.ligne}</td><td>${l.code}</td><td>${l.nom || '—'}</td><td class="num">${l.quantite}</td><td class="num">${l.prix || '—'}</td></tr>`))}</tbody>
        </table>
      </div>`) : ''}`;

  const etape = main.querySelector('#etape-valider');
  const bouton = main.querySelector('#valider');
  etape.setAttribute('aria-disabled', String(rapport.nb_valides === 0));
  bouton.disabled = rapport.nb_valides === 0;
  bouton.textContent = `Importer ${formaterNombre(rapport.nb_valides)} produit${rapport.nb_valides > 1 ? 's' : ''}`;
  main.querySelector('#annuler').hidden = false;
}

async function importer(main) {
  if (!courant?.rapport) return;
  const m = mode(main);
  if (m === 'remplacement' && courant.rapport.mis_a_zero > 0) {
    const ok = window.confirm(`${courant.rapport.mis_a_zero} produit(s) absents du fichier vont passer à zéro. Continuer ?`);
    if (!ok) return;
  }
  const bouton = main.querySelector('#valider');
  bouton.disabled = true;
  bouton.textContent = 'Import en cours…';

  const { data: rapport, error } = await supabase.rpc('importer_stock', {
    lignes: courant.lignes, mode: m, simulation: false, fichier: courant.fichier,
  });
  const resultat = main.querySelector('#resultat');
  if (error) {
    bouton.disabled = false;
    bouton.textContent = 'Réessayer l\'import';
    resultat.innerHTML = html`<p class="erreur">${messageErreur(error)}</p>`;
    return;
  }
  bouton.textContent = 'Importé';
  resultat.innerHTML = html`
    <p><b>Stock importé : ${rapport.nb_valides > 1 ? `${formaterNombre(rapport.nb_valides)} produits mis à jour et confirmés` : '1 produit mis à jour et confirmé'}.</b>
      ${rapport.nb_erreurs ? `${formaterNombre(rapport.nb_erreurs)} lignes en erreur ont été ignorées.` : ''}</p>
    <a class="bouton secondaire" href="#stock">Voir le stock</a>`;
  notifier('Stock importé.');
  courant = null;
  chargerHistorique(main);
  supabase.from('a_reapprovisionner').select('produit_id', { count: 'exact', head: true })
    .then(({ count }) => mettreAJourCompteur(count ?? 0));
}

async function chargerHistorique(main) {
  const zone = main.querySelector('#historique');
  const { data, error } = await supabase.from('imports_stock')
    .select('fichier, mode, nb_lignes, nb_importees, nb_erreurs, cree_le')
    .order('cree_le', { ascending: false })
    .limit(5);
  if (error) { zone.innerHTML = html`<p class="erreur">${messageErreur(error)}</p>`; return; }
  if (!data.length) { zone.innerHTML = '<p class="discret">Aucun import pour l\'instant.</p>'; return; }
  zone.innerHTML = html`
    <div class="defile"><table class="apercu">
      <thead><tr><th>Quand</th><th>Fichier</th><th>Absents</th><th class="num">Importés</th><th class="num">Erreurs</th></tr></thead>
      <tbody>${data.map((i) => brut(html`<tr>
        <td>${depuis(i.cree_le)}</td><td>${i.fichier || '—'}</td>
        <td>${i.mode === 'remplacement' ? 'passés à zéro' : 'inchangés'}</td>
        <td class="num">${formaterNombre(i.nb_importees)}</td><td class="num">${formaterNombre(i.nb_erreurs)}</td>
      </tr>`))}</tbody>
    </table></div>`;
}
