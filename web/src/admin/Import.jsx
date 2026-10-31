import { useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { analyserCsv, versObjets } from '../lib/fichiers.js';

const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const TAILLE_MAX = 10 * 1024 * 1024;

/** Lit un CSV ou la première feuille d'un Excel en tableau de cellules. */
export async function lireTableau(fichier) {
  const nom = fichier.name.toLowerCase();
  if (nom.endsWith('.xlsx') || nom.endsWith('.xls')) {
    const XLSX = await import(/* @vite-ignore */ SHEETJS);
    const classeur = XLSX.read(await fichier.arrayBuffer(), { type: 'array', cellDates: true });
    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    return XLSX.utils.sheet_to_json(feuille, { header: 1, raw: true, defval: '' });
  }
  let texte = await fichier.text();
  if (texte.includes('�')) {
    texte = new TextDecoder('windows-1252').decode(await fichier.arrayBuffer());
  }
  return analyserCsv(texte);
}

/**
 * Import en trois temps : fichier → aperçu (simulation côté base) → import.
 *   champs      colonnes attendues, voir lib/fichiers.js
 *   preparer    objets lus → { lignes, erreurs } (erreurs détectées dans le navigateur)
 *   fonction    nom de la fonction Supabase, appelée avec { lignes, simulation, ...options }
 *   Bilan       composant qui affiche le rapport de la base
 */
export default function Import({ champs, modele, preparer = (l) => ({ lignes: l, erreurs: [] }),
  fonction, options = {}, Bilan, libelleObjet = 'lignes', onImporte, children }) {
  const [etat, setEtat] = useState({ etape: 'fichier' });
  const [survol, setSurvol] = useState(false);

  const lire = async (fichier) => {
    if (!fichier) return;
    if (fichier.size > TAILLE_MAX) { setEtat({ etape: 'fichier', erreur: 'Fichier trop lourd (10 Mo maximum).' }); return; }
    setEtat({ etape: 'lecture', fichier: fichier.name });
    try {
      const tableau = await lireTableau(fichier);
      const { lignes, manquantes, entetes } = versObjets(tableau, champs);
      if (manquantes.length) {
        setEtat({
          etape: 'fichier',
          erreur: `Colonne introuvable : ${manquantes.join(', ')}. Colonnes lues : ${entetes.filter(Boolean).join(', ') || 'aucune'}. Partez du modèle.`,
        });
        return;
      }
      if (!lignes.length) { setEtat({ etape: 'fichier', erreur: 'Le fichier ne contient aucune ligne.' }); return; }
      const prep = preparer(lignes);
      const rapport = await rpc(fonction, { lignes: prep.lignes, simulation: true, ...options });
      setEtat({ etape: 'apercu', fichier: fichier.name, prep, rapport });
    } catch (e) {
      setEtat({ etape: 'fichier', erreur: e.message || `Impossible de lire ${fichier.name}.` });
    }
  };

  const importer = async () => {
    setEtat((e) => ({ ...e, etape: 'import' }));
    try {
      const rapport = await rpc(fonction, { lignes: etat.prep.lignes, simulation: false, ...options });
      setEtat((e) => ({ ...e, etape: 'fini', rapport }));
      onImporte?.(rapport);
    } catch (e) {
      setEtat((x) => ({ ...x, etape: 'apercu', erreur: e.message }));
    }
  };

  const erreursNav = etat.prep?.erreurs ?? [];
  const erreurs = [...erreursNav, ...(etat.rapport?.erreurs ?? [])].sort((a, b) => a.ligne - b.ligne);
  const nbValides = etat.rapport?.nb_valides ?? 0;

  if (etat.etape === 'fini') {
    return (
      <div className="section">
        <h3>Import terminé</h3>
        <Bilan rapport={etat.rapport} final />
        {erreurs.length > 0 && <p className="discret">{erreurs.length} ligne(s) en erreur ont été ignorées.</p>}
        <div><button type="button" className="secondaire" onClick={() => setEtat({ etape: 'fichier' })}>Importer un autre fichier</button></div>
      </div>
    );
  }

  return (
    <div className="pile">
      <div className={`depot${survol ? ' survol' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => { e.preventDefault(); setSurvol(false); lire(e.dataTransfer.files[0]); }}>
        <p>Glissez un fichier CSV ou Excel ici, ou</p>
        <label className="bouton secondaire">Choisir un fichier
          <input type="file" accept=".csv,.txt,.xlsx,.xls" className="visuellement-cache"
            onChange={(e) => { lire(e.target.files[0]); e.target.value = ''; }} />
        </label>
        {modele && <p className="discret"><a href={modele} download>Télécharger le modèle</a> : une ligne par élément, la première ligne contient les noms de colonnes.</p>}
      </div>
      {children}
      {etat.etape === 'lecture' && <p className="discret">Lecture de {etat.fichier}…</p>}
      {etat.erreur && <p className="erreur" role="alert">{etat.erreur}</p>}

      {(etat.etape === 'apercu' || etat.etape === 'import') && (
        <div className="section">
          <h3>Aperçu de {etat.fichier}</h3>
          <p className="discret">Rien n'est enregistré tant que vous n'avez pas cliqué sur Importer.</p>
          <Bilan rapport={etat.rapport} />
          {erreurs.length > 0 && (
            <details open={erreurs.length <= 10}>
              <summary>{erreurs.length} ligne(s) en erreur, qui seront ignorées</summary>
              <ul className="liste-erreurs">
                {erreurs.map((e, i) => (
                  <li key={i}>Ligne {e.ligne}{e.nom || e.pharmacie ? ` (${e.nom || e.pharmacie})` : ''} : {e.motifs.join(', ')}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="ligne">
            <button type="button" disabled={!nbValides || etat.etape === 'import'} onClick={importer}>
              {etat.etape === 'import' ? 'Import en cours…' : `Importer ${nbValides} ${nbValides > 1 ? libelleObjet : libelleObjet.replace(/s$/, '')}`}
            </button>
            <button type="button" className="secondaire" onClick={() => setEtat({ etape: 'fichier' })}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}
