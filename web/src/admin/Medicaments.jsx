import { useEffect, useState } from 'react';
import { supabase, rpc, messageErreur } from '../lib/supabase.js';
import { normaliser } from '../lib/fichiers.js';
import { pluriel } from '../lib/temps.js';
import { Panneau, useNotifier } from './ui.jsx';
import Import from './Import.jsx';

const PAR_PAGE = 50;
const CHAMPS_IMPORT = {
  nom_commercial: { alias: ['nom commercial', 'nom', 'medicament', 'produit', 'designation', 'specialite'], obligatoire: true, libelle: 'nom commercial' },
  molecule: { alias: ['molecule', 'dci', 'principe actif', 'substance'], libelle: 'molécule' },
  dosage: { alias: ['dosage', 'dose', 'concentration'], libelle: 'dosage' },
  forme: { alias: ['forme', 'presentation', 'forme galenique'], libelle: 'forme' },
  synonymes: { alias: ['synonymes', 'autres noms', 'alias'], libelle: 'synonymes' },
};
const VIDE = { nom_commercial: '', molecule: '', dosage: '', forme: '', synonymes: [], actif: true };

export default function Medicaments() {
  const notifier = useNotifier();
  const [texte, setTexte] = useState('');
  const [page, setPage] = useState(0);
  const [resultat, setResultat] = useState({ chargement: true, lignes: [], total: 0 });
  const [fiche, setFiche] = useState(null);
  const [selection, setSelection] = useState([]);
  const [fusion, setFusion] = useState(false);
  const [importOuvert, setImportOuvert] = useState(false);
  const [version, setVersion] = useState(0);
  const recharger = () => setVersion((v) => v + 1);

  useEffect(() => {
    let annule = false;
    const minuterie = setTimeout(async () => {
      let q = supabase.from('medicaments')
        .select('id, nom_commercial, molecule, dosage, forme, synonymes, actif', { count: 'exact' })
        .order('nom_commercial').order('dosage')
        .range(page * PAR_PAGE, page * PAR_PAGE + PAR_PAGE - 1);
      const t = normaliser(texte);
      if (t) q = q.ilike('recherche', `%${t.replace(/[%_]/g, '')}%`);
      const { data, count, error } = await q;
      if (annule) return;
      if (error) setResultat({ chargement: false, lignes: [], total: 0, erreur: messageErreur(error) });
      else setResultat({ chargement: false, lignes: data, total: count ?? data.length });
    }, 250);
    return () => { annule = true; clearTimeout(minuterie); };
  }, [texte, page, version]);

  const basculer = (m) => setSelection((s) => (s.some((x) => x.id === m.id) ? s.filter((x) => x.id !== m.id) : [...s, m].slice(-2)));
  const pages = Math.max(1, Math.ceil(resultat.total / PAR_PAGE));

  return (
    <>
      <div className="ligne">
        <h2>Médicaments</h2>
        <div className="ligne pousse">
          <button type="button" className="secondaire" onClick={() => setImportOuvert(true)}>Importer un fichier</button>
          <button type="button" onClick={() => setFiche(VIDE)}>Ajouter un médicament</button>
        </div>
      </div>
      <p className="discret">Base de référence de la recherche patient. Les synonymes (noms de marque, abréviations) sont trouvés comme le nom principal.</p>

      <div className="ligne">
        <input type="search" placeholder="Nom, molécule, dosage ou synonyme" aria-label="Rechercher un médicament"
          value={texte} onChange={(e) => { setTexte(e.target.value); setPage(0); }} style={{ flex: '1 1 18rem' }} />
        {selection.length === 2
          ? <button type="button" className="secondaire" onClick={() => setFusion(true)}>Fusionner les 2 sélectionnés</button>
          : <span className="discret">Cochez deux médicaments pour fusionner un doublon.</span>}
      </div>

      {resultat.erreur && <p className="erreur">{resultat.erreur}</p>}
      <div className="tableau-boite">
        <table className="tableau">
          <thead>
            <tr><th><span className="visuellement-cache">Sélection</span></th><th>Nom commercial</th><th>Molécule</th><th>Dosage</th><th>Forme</th><th>Synonymes</th><th><span className="visuellement-cache">Actions</span></th></tr>
          </thead>
          <tbody>
            {resultat.lignes.map((m) => (
              <tr key={m.id} style={m.actif ? undefined : { opacity: 0.55 }}>
                <td><input type="checkbox" aria-label={`Sélectionner ${m.nom_commercial} ${m.dosage ?? ''}`}
                  checked={selection.some((x) => x.id === m.id)} onChange={() => basculer(m)} /></td>
                <td className="nom">{m.nom_commercial}{!m.actif && <span className="sous"> (masqué)</span>}</td>
                <td>{m.molecule}</td>
                <td>{m.dosage}</td>
                <td>{m.forme}</td>
                <td className="sous">{m.synonymes.join(', ')}</td>
                <td className="actions"><button type="button" className="discret-btn" onClick={() => setFiche(m)}>Modifier</button></td>
              </tr>
            ))}
            {!resultat.chargement && resultat.lignes.length === 0 && (
              <tr><td colSpan={7} className="discret">{texte ? 'Aucun médicament ne correspond. Ajoutez-le s’il manque.' : 'La base est vide : importez une liste pour commencer.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ligne">
        <span className="discret">{pluriel(resultat.total, 'médicament')}</span>
        {pages > 1 && (
          <span className="ligne pousse">
            <button type="button" className="secondaire petit" disabled={page === 0} onClick={() => setPage(page - 1)}>Précédents</button>
            <span>Page {page + 1} sur {pages}</span>
            <button type="button" className="secondaire petit" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Suivants</button>
          </span>
        )}
      </div>

      {fiche && <FicheMedicament medicament={fiche} onFermer={() => setFiche(null)}
        onEnregistre={(nom) => { notifier(`${nom} enregistré.`); setFiche(null); recharger(); }} />}

      {fusion && selection.length === 2 && (
        <Fusion paire={selection} onFermer={() => setFusion(false)}
          onFusionne={(nom) => { notifier(`Doublon fusionné dans ${nom}.`); setFusion(false); setSelection([]); recharger(); }} />
      )}

      {importOuvert && (
        <Panneau titre="Importer des médicaments" onFermer={() => setImportOuvert(false)}>
          <p>Colonnes : nom commercial (obligatoire), molécule, dosage, forme, synonymes séparés par « ; ». Un médicament déjà présent (même nom, dosage et forme) est complété, pas dupliqué.</p>
          <Import champs={CHAMPS_IMPORT} modele="/modeles/medicaments.csv" fonction="importer_medicaments" libelleObjet="médicaments"
            Bilan={({ rapport, final }) => (
              <div className="bilan">
                <div><strong>{rapport.nouveaux}</strong><span>{final ? 'ajoutés' : 'nouveaux'}</span></div>
                <div><strong>{rapport.completes}</strong><span>{final ? 'complétés' : 'déjà présents'}</span></div>
                <div className={rapport.nb_erreurs ? 'ko' : ''}><strong>{rapport.nb_erreurs}</strong><span>en erreur</span></div>
              </div>
            )}
            onImporte={(r) => { notifier(`${pluriel(r.nb_valides, 'médicament')} importé${r.nb_valides > 1 ? 's' : ''}.`); recharger(); }} />
        </Panneau>
      )}
    </>
  );
}

const libelleMedicament = (m) => [m.nom_commercial, m.dosage, m.forme].filter(Boolean).join(' ');

function FicheMedicament({ medicament, onFermer, onEnregistre }) {
  const [f, setF] = useState({ ...medicament, synonymesTexte: (medicament.synonymes ?? []).join(', ') });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const maj = (c) => (e) => setF({ ...f, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const enregistrer = async (e) => {
    e.preventDefault();
    if (f.nom_commercial.trim().length < 2) { setErreur('Le nom commercial est obligatoire.'); return; }
    setErreur(''); setEnvoi(true);
    const ligne = {
      nom_commercial: f.nom_commercial.trim(),
      molecule: f.molecule?.trim() || null,
      dosage: f.dosage?.trim() || null,
      forme: f.forme?.trim() || null,
      synonymes: f.synonymesTexte.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      actif: f.actif,
    };
    const requete = medicament.id
      ? supabase.from('medicaments').update(ligne).eq('id', medicament.id)
      : supabase.from('medicaments').insert(ligne);
    const { error } = await requete;
    setEnvoi(false);
    if (error) setErreur(error.code === '23505' ? 'Ce médicament existe déjà (même nom, dosage et forme).' : messageErreur(error));
    else onEnregistre(ligne.nom_commercial);
  };

  return (
    <Panneau titre={medicament.id ? libelleMedicament(medicament) : 'Ajouter un médicament'} onFermer={onFermer}
      pied={<button type="submit" form="fiche-medicament" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>}>
      <form id="fiche-medicament" className="section" onSubmit={enregistrer} noValidate>
        <div className="grille-champs">
          <label className="champ">Nom commercial *<input value={f.nom_commercial} onChange={maj('nom_commercial')} /></label>
          <label className="champ">Molécule (DCI)<input value={f.molecule ?? ''} onChange={maj('molecule')} /></label>
          <label className="champ">Dosage<input value={f.dosage ?? ''} onChange={maj('dosage')} placeholder="500 mg" /></label>
          <label className="champ">Forme<input value={f.forme ?? ''} onChange={maj('forme')} placeholder="comprimé, sirop…" /></label>
        </div>
        <label className="champ">Synonymes<span className="aide">Noms de marque ou abréviations, séparés par des virgules</span>
          <input value={f.synonymesTexte} onChange={maj('synonymesTexte')} />
        </label>
        <label className="case"><input type="checkbox" checked={f.actif} onChange={maj('actif')} /> Proposé dans la recherche patient</label>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </form>
    </Panneau>
  );
}

function Fusion({ paire, onFermer, onFusionne }) {
  const [garde, setGarde] = useState(paire[0].id);
  const [erreur, setErreur] = useState('');
  const conserve = paire.find((m) => m.id === garde);
  const doublon = paire.find((m) => m.id !== garde);

  const fusionner = async () => {
    try {
      await rpc('fusionner_medicaments', { doublon: doublon.id, garde: conserve.id });
      onFusionne(libelleMedicament(conserve));
    } catch (e) { setErreur(e.message); }
  };

  return (
    <Panneau titre="Fusionner un doublon" onFermer={onFermer}
      pied={<button type="button" onClick={fusionner}>Fusionner dans {libelleMedicament(conserve)}</button>}>
      <div className="section">
        <h3>Quelle fiche garder ?</h3>
        {paire.map((m) => (
          <label key={m.id} className="case">
            <input type="radio" name="garde" checked={garde === m.id} onChange={() => setGarde(m.id)} />
            {libelleMedicament(m)}{m.molecule ? ` (${m.molecule})` : ''}
          </label>
        ))}
        <p>« {libelleMedicament(doublon)} » sera supprimé. Son nom devient un synonyme de la fiche gardée, et ses demandes passées y sont rattachées. L'opération est inscrite au journal.</p>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </div>
    </Panneau>
  );
}
