import { useMemo, useState } from 'react';
import { supabase, rpc, messageErreur } from '../lib/supabase.js';
import { COMMUNES, libelleCommune } from '../lib/config.js';
import { periodeGarde } from '../lib/fichiers.js';
import {
  ajouterJours, dateLibreville, enLibreville, libelleHeure, libelleJour, lundiDe, majuscule, pluriel, versInstant,
} from '../lib/temps.js';
import { Panneau, useChargement, useNotifier } from './ui.jsx';
import Import from './Import.jsx';

const CHAMPS_IMPORT = {
  pharmacie: { alias: ['pharmacie', 'nom', 'officine', 'pharmacie de garde'], obligatoire: true, libelle: 'pharmacie' },
  commune: { alias: ['commune', 'ville', 'zone'], libelle: 'commune' },
  date_debut: { alias: ['date debut', 'date', 'du', 'debut', 'jour'], obligatoire: true, libelle: 'date de début' },
  heure_debut: { alias: ['heure debut', 'de', 'heure de debut', 'ouverture'], obligatoire: true, libelle: 'heure de début' },
  date_fin: { alias: ['date fin', 'au', 'fin'], libelle: 'date de fin' },
  heure_fin: { alias: ['heure fin', 'a', 'heure de fin', 'fermeture'], obligatoire: true, libelle: 'heure de fin' },
};

const PRESETS = [
  { id: 'nuit', libelle: 'Nuit, 20 h → 8 h', debut: '20:00', fin: '08:00' },
  { id: 'journee', libelle: '24 h, 8 h → 8 h', debut: '08:00', fin: '08:00' },
  { id: 'dimanche', libelle: 'Jour, 8 h → 20 h', debut: '08:00', fin: '20:00' },
];

/** Début et fin locaux → { debut, fin } en ISO ; fin ≤ début : lendemain. */
function periodeSaisie(jour, debut, fin) {
  const jourFin = fin <= debut ? ajouterJours(jour, 1) : jour;
  return { debut: versInstant(`${jour}T${debut}`), fin: versInstant(`${jourFin}T${fin}`) };
}

export default function Gardes() {
  const notifier = useNotifier();
  const [lundi, setLundi] = useState(() => lundiDe(dateLibreville()));
  const [commune, setCommune] = useState('');
  const [ajout, setAjout] = useState(null); // jour « AAAA-MM-JJ » ou null
  const [importOuvert, setImportOuvert] = useState(false);

  const jours = useMemo(() => Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i)), [lundi]);
  const pharmacies = useChargement(() => rpc('pharmacies_admin', {}), []);
  const gardes = useChargement(async () => {
    const { data, error } = await supabase.from('gardes')
      .select('id, pharmacie_id, debut, fin, source, validee')
      .lt('debut', versInstant(`${ajouterJours(lundi, 7)}T00:00`))
      .gt('fin', versInstant(`${lundi}T00:00`))
      .order('debut');
    if (error) throw new Error(messageErreur(error));
    return data;
  }, [lundi]);

  const parId = useMemo(() => Object.fromEntries((pharmacies.donnees ?? []).map((p) => [p.id, p])), [pharmacies.donnees]);
  const aujourdhui = dateLibreville();

  const gardesDuJour = (jour) => (gardes.donnees ?? []).filter((g) => {
    const c = enLibreville(g.debut);
    const debutLocal = `${c.annee}-${String(c.mois).padStart(2, '0')}-${String(c.jour).padStart(2, '0')}`;
    return debutLocal === jour && (!commune || parId[g.pharmacie_id]?.commune === commune);
  });

  const supprimer = async (g) => {
    const nom = parId[g.pharmacie_id]?.nom ?? 'cette pharmacie';
    if (!window.confirm(`Retirer la garde de ${nom} ?`)) return;
    const { error } = await supabase.from('gardes').delete().eq('id', g.id);
    if (error) notifier(messageErreur(error), { erreur: true });
    else { notifier(`Garde de ${nom} retirée.`); gardes.recharger(); }
  };

  const sansGarde = jours.filter((j) => gardesDuJour(j).length === 0).length;

  return (
    <>
      <div className="ligne">
        <h2>Gardes</h2>
        <div className="ligne pousse">
          <button type="button" className="secondaire" onClick={() => setImportOuvert(true)}>Importer le calendrier</button>
          <button type="button" onClick={() => setAjout(jours.includes(aujourdhui) ? aujourdhui : lundi)}>Ajouter une garde</button>
        </div>
      </div>

      <div className="ligne">
        <button type="button" className="secondaire petit" onClick={() => setLundi(ajouterJours(lundi, -7))}>Semaine précédente</button>
        <strong>Semaine du {libelleJour(lundi)} au {libelleJour(ajouterJours(lundi, 6))}</strong>
        <button type="button" className="secondaire petit" onClick={() => setLundi(ajouterJours(lundi, 7))}>Semaine suivante</button>
        {!jours.includes(aujourdhui) && <button type="button" className="discret-btn" onClick={() => setLundi(lundiDe(aujourdhui))}>Revenir à cette semaine</button>}
        <select className="pousse" aria-label="Commune" value={commune} onChange={(e) => setCommune(e.target.value)}>
          <option value="">Toutes les communes</option>
          {COMMUNES.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
        </select>
      </div>

      {gardes.erreur && <p className="erreur">{gardes.erreur}</p>}
      {gardes.donnees && (
        <p className="discret">
          {pluriel(gardes.donnees.length, 'garde')} cette semaine
          {sansGarde > 0 ? `, ${pluriel(sansGarde, 'jour')} sans garde${commune ? ` à ${libelleCommune(commune)}` : ''}.` : '.'}
        </p>
      )}

      <div className="semaine">
        {jours.map((jour) => {
          const liste = gardesDuJour(jour);
          return (
            <section key={jour} className={`jour-col${jour === aujourdhui ? ' aujourdhui' : ''}`} aria-label={libelleJour(jour)}>
              <header>
                <span>{majuscule(libelleJour(jour))}</span>
                <button type="button" className="discret-btn petit" style={jour === aujourdhui ? { color: '#fff' } : undefined}
                  aria-label={`Ajouter une garde le ${libelleJour(jour)}`} onClick={() => setAjout(jour)}>+</button>
              </header>
              <div className="liste">
                {liste.length === 0 && gardes.donnees && <span className="vide-jour">Aucune garde</span>}
                {liste.map((g) => {
                  const p = parId[g.pharmacie_id];
                  const nuit = enLibreville(g.debut).heure >= 18;
                  return (
                    <div key={g.id} className={`garde${nuit ? ' nuit' : ''}`}>
                      <span className="qui">{p?.nom ?? 'Pharmacie'}</span>
                      <span className="quand">{libelleHeure(g.debut)} → {libelleHeure(g.fin)}{p && !commune ? `, ${libelleCommune(p.commune)}` : ''}</span>
                      {!g.validee && <span className="manquant">À valider</span>}
                      <button type="button" className="discret-btn petit" onClick={() => supprimer(g)}>Retirer</button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {ajout && (
        <AjoutGarde jour={ajout} pharmacies={pharmacies.donnees ?? []} communeParDefaut={commune}
          onFermer={() => setAjout(null)}
          onAjoutee={(nom, enchainer) => { notifier(`Garde de ${nom} ajoutée.`); gardes.recharger(); if (!enchainer) setAjout(null); }} />
      )}

      {importOuvert && (
        <Panneau titre="Importer le calendrier des gardes" onFermer={() => setImportOuvert(false)}>
          <p>Une ligne par garde. Colonnes : pharmacie, commune, date de début, heure de début, date de fin (facultative), heure de fin. Sans date de fin, une garde qui finit plus tôt que son heure de début se termine le lendemain (20 h → 8 h).</p>
          <p className="discret">Le nom de la pharmacie peut être abrégé (« Bord de Mer ») s'il n'y a pas d'ambiguïté. Heures à l'heure de Libreville.</p>
          <Import champs={CHAMPS_IMPORT} modele="/modeles/gardes.csv" fonction="importer_gardes" libelleObjet="gardes"
            preparer={preparerGardes} Bilan={BilanGardes}
            onImporte={(r) => { notifier(`${pluriel(r.nb_valides, 'garde')} importée${r.nb_valides > 1 ? 's' : ''}.`); gardes.recharger(); }} />
        </Panneau>
      )}
    </>
  );
}

/** Lignes du fichier → périodes ; les dates illisibles sont signalées tout de suite. */
export function preparerGardes(objets) {
  const lignes = [];
  const erreurs = [];
  for (const o of objets) {
    const periode = periodeGarde(o);
    if (!periode) {
      erreurs.push({ ligne: o.ligne, pharmacie: o.pharmacie, motifs: ['date ou heure illisible (ex. 02/11/2026 et 20h)'] });
      continue;
    }
    lignes.push({ ligne: o.ligne, pharmacie: String(o.pharmacie), commune: String(o.commune ?? ''), ...periode });
  }
  return { lignes, erreurs };
}

function BilanGardes({ rapport, final }) {
  return (
    <div className="pile">
      <div className="bilan">
        <div><strong>{rapport.nb_valides}</strong><span>{final ? 'importées' : 'gardes reconnues'}</span></div>
        {!final && <div><strong>{rapport.deja_presentes}</strong><span>déjà enregistrées</span></div>}
        <div className={rapport.nb_erreurs ? 'ko' : ''}><strong>{rapport.nb_erreurs}</strong><span>en erreur</span></div>
      </div>
      {!final && rapport.valides?.length > 0 && (
        <div className="tableau-boite">
          <table className="tableau">
            <thead><tr><th>Ligne</th><th>Pharmacie reconnue</th><th>Début</th><th>Fin</th></tr></thead>
            <tbody>
              {rapport.valides.slice(0, 12).map((v) => (
                <tr key={v.ligne}>
                  <td>{v.ligne}</td><td>{v.pharmacie}</td>
                  <td>{libelleJourInstant(v.debut)} {libelleHeure(v.debut)}</td>
                  <td>{libelleJourInstant(v.fin)} {libelleHeure(v.fin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const libelleJourInstant = (instant) => libelleJour(dateLibreville(new Date(instant)));
const heureLisible = (hhmm) => { const [h, m] = hhmm.split(':'); return m === '00' ? `${+h} h` : `${+h} h ${m}`; };

// ---------------------------------------------------------------- Ajout rapide

function AjoutGarde({ jour: jourInitial, pharmacies, communeParDefaut, onFermer, onAjoutee }) {
  const [commune, setCommune] = useState(communeParDefaut);
  const [pharmacie, setPharmacie] = useState('');
  const [jour, setJour] = useState(jourInitial);
  const [debut, setDebut] = useState('20:00');
  const [fin, setFin] = useState('08:00');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const choix = pharmacies
    .filter((p) => p.statut !== 'suspendue' && (!commune || p.commune === commune))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const ajouter = async (enchainer) => {
    if (!pharmacie) { setErreur('Choisissez la pharmacie de garde.'); return; }
    if (!debut || !fin) { setErreur('Indiquez les heures de début et de fin.'); return; }
    setErreur(''); setEnvoi(true);
    try {
      const p = periodeSaisie(jour, debut, fin);
      await rpc('ajouter_garde', { pharmacie, debut_garde: p.debut, fin_garde: p.fin });
      onAjoutee(pharmacies.find((x) => x.id === pharmacie)?.nom ?? 'la pharmacie', enchainer);
      if (enchainer) { setPharmacie(''); setJour(ajouterJours(jour, 1)); }
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  };

  const nomChoisi = pharmacies.find((x) => x.id === pharmacie)?.nom;
  const finLendemain = fin && debut && fin <= debut;

  return (
    <Panneau titre="Ajouter une garde" onFermer={onFermer}
      pied={(
        <>
          <button type="button" disabled={envoi} onClick={() => ajouter(false)}>Ajouter la garde</button>
          <button type="button" className="secondaire" disabled={envoi} onClick={() => ajouter(true)}>Ajouter et saisir le jour suivant</button>
        </>
      )}>
      <div className="section">
        <div className="grille-champs">
          <label className="champ">Commune
            <select value={commune} onChange={(e) => { setCommune(e.target.value); setPharmacie(''); }}>
              <option value="">Toutes</option>
              {COMMUNES.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
            </select>
          </label>
          <label className="champ">Pharmacie
            <select value={pharmacie} onChange={(e) => setPharmacie(e.target.value)}>
              <option value="">Choisir…</option>
              {choix.map((p) => <option key={p.id} value={p.id}>{p.nom}{p.quartier ? ` (${p.quartier})` : ''}</option>)}
            </select>
          </label>
          <label className="champ">Jour de début
            <input type="date" value={jour} onChange={(e) => setJour(e.target.value)} />
          </label>
        </div>
        <div className="ligne">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="secondaire petit" aria-pressed={debut === p.debut && fin === p.fin}
              onClick={() => { setDebut(p.debut); setFin(p.fin); }}>{p.libelle}</button>
          ))}
        </div>
        <div className="grille-champs">
          <label className="champ">Début<input type="time" value={debut} onChange={(e) => setDebut(e.target.value)} /></label>
          <label className="champ">Fin<input type="time" value={fin} onChange={(e) => setFin(e.target.value)} /></label>
        </div>
        {jour && debut && fin && (
          <p className="discret">
            {nomChoisi ?? 'La pharmacie'} sera de garde du {libelleJour(jour)} à {heureLisible(debut)}
            {' '}au {libelleJour(finLendemain ? ajouterJours(jour, 1) : jour)} à {heureLisible(fin)}.
          </p>
        )}
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </div>
    </Panneau>
  );
}
