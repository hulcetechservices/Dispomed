import { useCallback, useEffect, useMemo, useState } from 'react';
import { Croix } from '../Croix.jsx';
import { chargerDonnees, donneesEnCache } from './donnees.js';
import Liste from './Liste.jsx';
import Fiche from './Fiche.jsx';
import { enLibreville } from '../lib/temps.js';

// Site patient (lot 2) : pharmacies de garde, carte, fiches, filtre CNAMGS.
// Routes : /  et  /pharmacie/<id>

const routeDepuisAdresse = () => {
  const m = location.pathname.match(/^\/pharmacie\/([0-9a-f-]{8,})/i);
  return m ? { page: 'fiche', id: m[1] } : { page: 'accueil' };
};

/** Nuit : de 20 h à 7 h à Libreville. La page passe en couleurs sombres. */
const estNuit = (d = new Date()) => { const h = enLibreville(d).heure; return h >= 20 || h < 7; };

export default function PatientApp() {
  const [route, setRoute] = useState(routeDepuisAdresse);
  const [donnees, setDonnees] = useState(donneesEnCache);
  const [etat, setEtat] = useState({ chargement: true, horsLigne: false, erreur: '' });
  const [maintenant, setMaintenant] = useState(() => new Date());

  const rafraichir = useCallback(async () => {
    setEtat((e) => ({ ...e, chargement: true }));
    try {
      setDonnees(await chargerDonnees());
      setEtat({ chargement: false, horsLigne: false, erreur: '' });
    } catch (e) {
      setEtat({ chargement: false, horsLigne: Boolean(donneesEnCache()), erreur: e.message });
    }
  }, []);

  useEffect(() => {
    rafraichir();
    const retour = () => setRoute(routeDepuisAdresse());
    window.addEventListener('popstate', retour);
    // Les états « ouverte » et « de garde » changent avec l'heure.
    const horloge = setInterval(() => setMaintenant(new Date()), 60 * 1000);
    const reseau = () => rafraichir();
    window.addEventListener('online', reseau);
    return () => { window.removeEventListener('popstate', retour); clearInterval(horloge); window.removeEventListener('online', reseau); };
  }, [rafraichir]);

  useEffect(() => {
    document.documentElement.dataset.moment = estNuit(maintenant) ? 'nuit' : 'jour';
  }, [maintenant]);

  const aller = useCallback((chemin) => {
    history.pushState(null, '', chemin);
    setRoute(routeDepuisAdresse());
    window.scrollTo(0, 0);
  }, []);

  const pharmacie = useMemo(
    () => (route.page === 'fiche' ? donnees?.pharmacies.find((p) => p.id === route.id) : null),
    [route, donnees],
  );

  return (
    <div className="patient">
      <header className="barre-patient">
        <a href="/" className="marque" onClick={(e) => { e.preventDefault(); aller('/'); }}>
          <Croix taille={28} /> Pharmacies Gabon
        </a>
      </header>

      {etat.horsLigne && donnees && (
        <p className="bandeau-hors-ligne" role="status">
          Hors ligne : informations du {new Date(donnees.mis_a_jour).toLocaleString('fr-FR', { timeZone: 'Africa/Libreville', dateStyle: 'short', timeStyle: 'short' })}.
          Appelez avant de vous déplacer.
        </p>
      )}

      {!donnees && etat.chargement && <p className="chargement">Chargement des pharmacies…</p>}
      {!donnees && !etat.chargement && (
        <div className="contenu-patient">
          <p className="erreur">{etat.erreur || 'Impossible de charger les pharmacies.'}</p>
          <button type="button" onClick={rafraichir}>Réessayer</button>
        </div>
      )}

      {donnees && route.page === 'accueil' && (
        <Liste donnees={donnees} maintenant={maintenant} onOuvrir={(id) => aller(`/pharmacie/${id}`)} />
      )}
      {donnees && route.page === 'fiche' && (
        pharmacie
          ? <Fiche pharmacie={pharmacie} donnees={donnees} maintenant={maintenant} onRetour={() => aller('/')} />
          : (
            <div className="contenu-patient">
              <p>Cette pharmacie n'est pas (ou plus) référencée.</p>
              <button type="button" onClick={() => aller('/')}>Voir les pharmacies</button>
            </div>
          )
      )}

      <footer className="pied-patient">
        <p>Les informations sont données par les pharmacies et l'équipe HULCE TECH. En cas d'urgence, appelez la pharmacie avant de vous déplacer.</p>
      </footer>
    </div>
  );
}
