import { useEffect, useMemo, useRef, useState } from 'react';
import { libelleCommune } from '../lib/config.js';
import { etatPharmacie, libelleDistance, distanceKm, lienItineraire, lienTelephone } from '../lib/ouverture.js';
import { dateLibreville, enLibreville, libelleHeure, libelleJour, majuscule, NOMS_JOURS } from '../lib/temps.js';
import { chargerLeaflet, fondDeCarte } from '../lib/leaflet.js';
import { positionEnregistree } from './donnees.js';

// Fiche pharmacie (PAT-05) : adresse, carte, horaires, téléphone, appel et
// itinéraire en un clic, gardes à venir.
export default function Fiche({ pharmacie: p, donnees, maintenant, onRetour }) {
  const horaires = useMemo(() => donnees.horaires.filter((h) => h.pharmacie_id === p.id), [donnees, p.id]);
  const gardes = useMemo(() => donnees.gardes.filter((g) => g.pharmacie_id === p.id), [donnees, p.id]);
  const etat = etatPharmacie({ horaires, gardes }, maintenant);
  const distance = distanceKm(positionEnregistree(), p);
  const aujourdhui = enLibreville(maintenant).jourSemaine;

  useEffect(() => { document.title = `${p.nom} | Pharmacies Gabon`; return () => { document.title = 'Pharmacies Gabon'; }; }, [p.nom]);

  const plagesDu = (jour) => horaires
    .filter((h) => Number(h.jour) === jour)
    .sort((a, b) => a.ouverture.localeCompare(b.ouverture))
    .map((h) => (h.ouverture.slice(0, 5) === '00:00' && h.fermeture.slice(0, 5) === '00:00'
      ? '24 h/24'
      : `${heure(h.ouverture)} – ${h.fermeture.slice(0, 5) === '00:00' ? 'minuit' : heure(h.fermeture)}`));

  const gardesAVenir = gardes.filter((g) => new Date(g.fin) > maintenant).slice(0, 6);

  return (
    <main className="contenu-patient fiche">
      <button type="button" className="discret-btn retour" onClick={onRetour}>Retour à la liste</button>
      <section className="tete">
        <h1>{p.nom}</h1>
        <p className="etat-ligne">
          <span className={`etat ${etat.statut}`}>{etat.libelle}</span>
          {distance != null && <span className="distance">{libelleDistance(distance)}</span>}
        </p>
      </section>

      <div className="actions-pharmacie grandes">
        {p.telephone
          ? <a className="bouton" href={lienTelephone(p.telephone)}>Appeler le {p.telephone}</a>
          : <span className="discret">Téléphone non renseigné</span>}
        <a className="bouton secondaire" href={lienItineraire(p)} target="_blank" rel="noopener">Itinéraire</a>
      </div>

      <section className="bloc">
        <h2>Adresse</h2>
        <p>{[p.adresse, p.quartier, libelleCommune(p.commune)].filter(Boolean).join(', ')}</p>
        {p.latitude != null && <MiniCarte latitude={p.latitude} longitude={p.longitude} />}
      </section>

      <section className="bloc">
        <h2>Assurances et services</h2>
        <p>{p.accepte_cnamgs ? <span className="pastille-cnamgs">Accepte la CNAMGS</span> : 'N’accepte pas la CNAMGS.'}</p>
        {p.mutuelles?.length > 0 && <p>Mutuelles : {p.mutuelles.join(', ')}</p>}
        {p.services?.length > 0 && <p>Services : {p.services.join(', ')}</p>}
      </section>

      {gardesAVenir.length > 0 && (
        <section className="bloc">
          <h2>Gardes à venir</h2>
          <ul className="liste-simple">
            {gardesAVenir.map((g) => (
              <li key={g.debut}>
                {majuscule(libelleJour(dateLibreville(new Date(g.debut))))}, {libelleHeure(g.debut)} → {libelleJour(dateLibreville(new Date(g.fin))) !== libelleJour(dateLibreville(new Date(g.debut))) ? `${libelleJour(dateLibreville(new Date(g.fin)))}, ` : ''}{libelleHeure(g.fin)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bloc">
        <h2>Horaires habituels</h2>
        {horaires.length === 0
          ? <p className="discret">Horaires non renseignés. Appelez avant de vous déplacer.</p>
          : (
            <table className="horaires-patient">
              <tbody>
                {NOMS_JOURS.map((nom, i) => {
                  const plages = plagesDu(i + 1);
                  return (
                    <tr key={nom} className={i + 1 === aujourdhui ? 'aujourdhui' : undefined}>
                      <th scope="row">{majuscule(nom)}{i + 1 === aujourdhui && <span className="visuellement-cache"> (aujourd'hui)</span>}</th>
                      <td>{plages.length ? plages.join(', ') : 'Fermé'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </section>
    </main>
  );
}

const heure = (hhmm) => { const [h, m] = hhmm.slice(0, 5).split(':'); return m === '00' ? `${+h} h` : `${+h} h ${m}`; };

function MiniCarte({ latitude, longitude }) {
  const boite = useRef();
  const [erreur, setErreur] = useState(false);
  useEffect(() => {
    let carte;
    let detruit = false;
    chargerLeaflet().then((L) => {
      if (detruit) return;
      carte = L.map(boite.current, { scrollWheelZoom: false }).setView([latitude, longitude], 16);
      fondDeCarte(L).addTo(carte);
      L.circleMarker([latitude, longitude], { radius: 10, color: '#fff', weight: 3, fillColor: '#0b4f4a', fillOpacity: 1 }).addTo(carte);
    }).catch(() => setErreur(true));
    return () => { detruit = true; carte?.remove(); };
  }, [latitude, longitude]);
  if (erreur) return null;
  return <div className="carte carte-fiche" ref={boite} role="img" aria-label="Emplacement de la pharmacie sur la carte" />;
}
