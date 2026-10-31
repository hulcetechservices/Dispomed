import { useEffect, useMemo, useState } from 'react';
import { COMMUNES, libelleCommune } from '../lib/config.js';
import { libelleDistance, lienItineraire, lienTelephone, preparerListe, quartiersDepuis } from '../lib/ouverture.js';
import { enLibreville } from '../lib/temps.js';
import { enregistrerPosition, localiser, positionEnregistree } from './donnees.js';
import CartePharmacies from './CartePharmacies.jsx';

const lirePreference = (cle, defaut) => { try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; } };
const garderPreference = (cle, v) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* rien */ } };

export default function Liste({ donnees, maintenant, onOuvrir }) {
  const [position, setPosition] = useState(positionEnregistree);
  const [vue, setVue] = useState('liste');
  const [mode, setMode] = useState(() => lirePreference('pg-mode', 'garde'));
  const [cnamgs, setCnamgs] = useState(() => lirePreference('pg-cnamgs', false));
  const [commune, setCommune] = useState('');
  const [localisation, setLocalisation] = useState({ enCours: false, erreur: '' });

  useEffect(() => garderPreference('pg-mode', mode), [mode]);
  useEffect(() => garderPreference('pg-cnamgs', cnamgs), [cnamgs]);

  const quartiers = useMemo(() => quartiersDepuis(donnees.pharmacies), [donnees.pharmacies]);
  const liste = useMemo(
    () => preparerListe(donnees, { position, commune, cnamgs, gardeSeulement: mode === 'garde', maintenant }),
    [donnees, position, commune, cnamgs, mode, maintenant],
  );
  const deGardeMaintenant = liste.filter((p) => p.etat.deGarde).length;

  const meLocaliser = async () => {
    setLocalisation({ enCours: true, erreur: '' });
    try {
      const p = await localiser();
      setPosition(p); enregistrerPosition(p); setCommune('');
      setLocalisation({ enCours: false, erreur: '' });
    } catch (e) {
      setLocalisation({ enCours: false, erreur: e.message });
    }
  };

  const choisirQuartier = (valeur) => {
    if (!valeur) { setPosition(null); enregistrerPosition(null); return; }
    const q = quartiers[Number(valeur)];
    const p = { latitude: q.latitude, longitude: q.longitude, libelle: `${q.quartier}, ${libelleCommune(q.commune)}`, source: 'quartier' };
    setPosition(p); enregistrerPosition(p);
  };

  const c = enLibreville(maintenant);
  const heure = `${c.heure} h ${String(c.minute).padStart(2, '0')}`;
  const pres = position ? ' près de vous' : '';
  const titre = mode === 'garde'
    ? (deGardeMaintenant > 0
      ? `${deGardeMaintenant} pharmacie${deGardeMaintenant > 1 ? 's' : ''} de garde${pres} en ce moment`
      : liste.length > 0 ? `Pharmacies de garde aujourd'hui${pres}` : 'Aucune garde enregistrée pour aujourd’hui')
    : `${liste.length} pharmacie${liste.length > 1 ? 's' : ''}${pres}`;

  const indexQuartier = position?.source === 'quartier'
    ? quartiers.findIndex((q) => `${q.quartier}, ${libelleCommune(q.commune)}` === position.libelle)
    : -1;

  return (
    <main className="contenu-patient">
      <section className="tete">
        <p className="heure">Il est {heure} à Libreville.</p>
        <h1>{titre}</h1>
      </section>

      <section className="reglages" aria-label="Ma position et filtres">
        <div className="position">
          <button type="button" className="secondaire" onClick={meLocaliser} disabled={localisation.enCours}>
            {localisation.enCours ? 'Localisation…' : position?.source === 'gps' ? 'Position à jour' : 'Me localiser'}
          </button>
          <select aria-label="Ou choisissez votre quartier" value={indexQuartier >= 0 ? String(indexQuartier) : ''}
            onChange={(e) => choisirQuartier(e.target.value)}>
            <option value="">{position?.source === 'gps' ? 'Ma position GPS' : 'Choisir mon quartier'}</option>
            {COMMUNES.map((co) => {
              const qs = quartiers.map((q, i) => ({ ...q, i })).filter((q) => q.commune === co.id);
              return qs.length ? (
                <optgroup key={co.id} label={co.libelle}>
                  {qs.map((q) => <option key={q.i} value={String(q.i)}>{q.quartier}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </div>
        {localisation.erreur && <p className="erreur" role="alert">{localisation.erreur}</p>}

        <div className="filtres-patient">
          <div className="bascule" role="group" aria-label="Pharmacies à afficher">
            <button type="button" aria-pressed={mode === 'garde'} onClick={() => setMode('garde')}>De garde</button>
            <button type="button" aria-pressed={mode === 'toutes'} onClick={() => setMode('toutes')}>Toutes</button>
          </div>
          <label className="case">
            <input type="checkbox" checked={cnamgs} onChange={(e) => setCnamgs(e.target.checked)} /> Accepte la CNAMGS
          </label>
          {!position && (
            <select aria-label="Commune" value={commune} onChange={(e) => setCommune(e.target.value)}>
              <option value="">Grand Libreville</option>
              {COMMUNES.map((co) => <option key={co.id} value={co.id}>{co.libelle}</option>)}
            </select>
          )}
        </div>
      </section>

      <div className="bascule vues" role="group" aria-label="Affichage">
        <button type="button" aria-pressed={vue === 'liste'} onClick={() => setVue('liste')}>Liste</button>
        <button type="button" aria-pressed={vue === 'carte'} onClick={() => setVue('carte')}>Carte</button>
      </div>

      {liste.length === 0 && (
        <div className="vide-patient">
          {mode === 'garde'
            ? <p>Aucune garde n'est enregistrée pour aujourd'hui{cnamgs ? ' parmi les pharmacies qui acceptent la CNAMGS' : ''}. Affichez toutes les pharmacies pour voir celles qui sont ouvertes.</p>
            : <p>Aucune pharmacie ne correspond{cnamgs ? ' (filtre CNAMGS actif)' : ''}.</p>}
          {mode === 'garde' && <button type="button" onClick={() => setMode('toutes')}>Voir toutes les pharmacies</button>}
        </div>
      )}

      {vue === 'carte' && liste.length > 0 && <CartePharmacies pharmacies={liste} position={position} onOuvrir={onOuvrir} />}

      {vue === 'liste' && (
        <ol className="cartes-pharmacies">
          {liste.map((p) => (
            <li key={p.id} className={`carte-pharmacie ${p.etat.statut}`}>
              <a href={`/pharmacie/${p.id}`} className="titre-pharmacie" onClick={(e) => { e.preventDefault(); onOuvrir(p.id); }}>
                {p.nom}
              </a>
              <p className="etat-ligne">
                <span className={`etat ${p.etat.statut}`}>{p.etat.libelle}</span>
                {p.distance != null && <span className="distance">{libelleDistance(p.distance)}</span>}
              </p>
              <p className="lieu">
                {[p.quartier, libelleCommune(p.commune)].filter(Boolean).join(', ')}
                {p.accepte_cnamgs && <span className="pastille-cnamgs">CNAMGS</span>}
              </p>
              <div className="actions-pharmacie">
                {p.telephone
                  ? <a className="bouton" href={lienTelephone(p.telephone)}>Appeler</a>
                  : <span className="discret">Pas de téléphone</span>}
                <a className="bouton secondaire" href={lienItineraire(p)} target="_blank" rel="noopener">Itinéraire</a>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
