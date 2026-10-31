// Données publiques : pharmacies actives, horaires, gardes des 8 prochains jours.
// Affichage immédiat depuis le cache, mise à jour en arrière-plan, et repli
// hors ligne (cahier des charges §10 : gardes du jour consultables sans réseau).
import { supabase, messageErreur } from '../lib/supabase.js';

const CLE = 'pg-donnees-v1';
const CLE_POSITION = 'pg-position-v1';

function lire(cle) {
  try { return JSON.parse(localStorage.getItem(cle)); } catch { return null; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage plein ou bloqué */ }
}

export const donneesEnCache = () => lire(CLE);

export async function chargerDonnees() {
  const maintenant = new Date();
  const dans8Jours = new Date(maintenant.getTime() + 8 * 24 * 3600 * 1000);
  const [pharmacies, horaires, gardes] = await Promise.all([
    supabase.from('pharmacies')
      .select('id, nom, adresse, commune, quartier, latitude, longitude, telephone, accepte_cnamgs, mutuelles, services')
      .eq('statut', 'active').order('nom'),
    supabase.from('horaires').select('pharmacie_id, jour, ouverture, fermeture'),
    supabase.from('gardes').select('pharmacie_id, debut, fin')
      .gt('fin', maintenant.toISOString()).lt('debut', dans8Jours.toISOString()).order('debut'),
  ]);
  const erreur = pharmacies.error || horaires.error || gardes.error;
  if (erreur) throw new Error(messageErreur(erreur));
  const donnees = {
    pharmacies: pharmacies.data,
    horaires: horaires.data,
    gardes: gardes.data,
    mis_a_jour: maintenant.toISOString(),
  };
  ecrire(CLE, donnees);
  return donnees;
}

export const positionEnregistree = () => lire(CLE_POSITION);
export const enregistrerPosition = (p) => ecrire(CLE_POSITION, p);

/** Position GPS du téléphone, avec un message clair en cas de refus. */
export function localiser() {
  return new Promise((ok, ko) => {
    if (!navigator.geolocation) { ko(new Error('Votre téléphone ne permet pas la localisation. Choisissez votre quartier.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ latitude: p.coords.latitude, longitude: p.coords.longitude, libelle: 'Ma position', source: 'gps' }),
      (e) => ko(new Error(e.code === 1
        ? 'Localisation refusée. Choisissez votre quartier, ou autorisez la localisation dans le navigateur.'
        : 'Position introuvable pour le moment. Choisissez votre quartier.')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  });
}
