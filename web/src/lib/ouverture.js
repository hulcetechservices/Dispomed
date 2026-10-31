// Ouverture, gardes et distances, calculées dans le navigateur (et donc aussi
// hors ligne, à partir des données gardées en cache). Testé dans tests/ouverture.test.mjs.
import { enLibreville, libelleHeure } from './temps.js';
import { normaliser } from './fichiers.js';

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const minutes = (hhmm) => {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};
const finPlage = (p) => (p.fermeture.slice(0, 5) === '00:00' ? 1440 : minutes(p.fermeture));
const heureLisible = (min) => {
  if (min >= 1440) return 'minuit';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};

/** Début (00:00) du jour de Libreville contenant l'instant, en millisecondes UTC. */
function debutJour(instant) {
  const c = enLibreville(instant);
  return Date.UTC(c.annee, c.mois - 1, c.jour) - 3600 * 1000;
}

/**
 * État d'une pharmacie à l'instant donné.
 *   horaires : [{ jour, ouverture: 'HH:MM', fermeture: 'HH:MM' }] (fermeture 00:00 = minuit)
 *   gardes   : [{ debut, fin }] (instants ISO)
 * Une pharmacie de garde est ouverte pendant toute sa garde, même hors horaires (RG-07).
 */
export function etatPharmacie({ horaires = [], gardes = [] }, maintenant = new Date()) {
  const t = new Date(maintenant).getTime();
  const finDuJour = debutJour(t) + 24 * 3600 * 1000;

  const enCours = gardes.find((g) => new Date(g.debut).getTime() <= t && t < new Date(g.fin).getTime());
  const plusTard = gardes
    .filter((g) => { const d = new Date(g.debut).getTime(); return d > t && d < finDuJour; })
    .sort((a, b) => new Date(a.debut) - new Date(b.debut))[0];

  const c = enLibreville(t);
  const m = c.heure * 60 + c.minute;
  const duJour = (j) => horaires.filter((h) => Number(h.jour) === j);
  const plageActuelle = duJour(c.jourSemaine).find((p) => minutes(p.ouverture) <= m && m < finPlage(p));

  const etat = {
    deGarde: Boolean(enCours),
    gardeAujourdhui: Boolean(enCours || plusTard),
    garde: enCours ?? plusTard ?? null,
    ouverte: Boolean(enCours || plageActuelle),
    horairesConnus: horaires.length > 0,
  };

  if (enCours) {
    etat.statut = 'garde';
    etat.libelle = `De garde jusqu'à ${libelleHeure(enCours.fin)}`;
    return etat;
  }
  if (plageActuelle) {
    const fin = finPlage(plageActuelle);
    etat.statut = 'ouverte';
    etat.libelle = minutes(plageActuelle.ouverture) === 0 && fin === 1440
      ? 'Ouverte 24 h/24'
      : `Ouverte jusqu'à ${heureLisible(fin)}`;
    if (plusTard) etat.libelle += `, de garde dès ${libelleHeure(plusTard.debut)}`;
    return etat;
  }

  etat.statut = 'fermee';
  if (plusTard) {
    etat.libelle = `Fermée, de garde dès ${libelleHeure(plusTard.debut)}`;
    return etat;
  }
  if (!etat.horairesConnus) {
    etat.libelle = 'Horaires non renseignés';
    return etat;
  }
  // Prochaine ouverture : plus tard aujourd'hui, puis les 7 jours suivants.
  for (let decalage = 0; decalage < 8; decalage++) {
    const jour = ((c.jourSemaine - 1 + decalage) % 7) + 1;
    const prochaine = duJour(jour)
      .map((p) => minutes(p.ouverture))
      .filter((debut) => decalage > 0 || debut > m)
      .sort((a, b) => a - b)[0];
    if (prochaine != null) {
      const quand = decalage === 0 ? '' : decalage === 1 ? 'demain ' : `${JOURS[jour - 1]} `;
      etat.libelle = `Fermée, ouvre ${quand}à ${heureLisible(prochaine)}`;
      return etat;
    }
  }
  etat.libelle = 'Fermée';
  return etat;
}

/** Distance à vol d'oiseau en kilomètres. */
export function distanceKm(a, b) {
  if (a?.latitude == null || b?.latitude == null) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
}

export function libelleDistance(km) {
  if (km == null) return '';
  if (km < 1) return `${Math.max(50, Math.round(km * 20) * 50)} m`;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

/**
 * Quartiers proposés quand le GPS n'est pas disponible : ceux des pharmacies
 * enregistrées, placés au centre de leurs pharmacies.
 */
export function quartiersDepuis(pharmacies) {
  const groupes = new Map();
  for (const p of pharmacies) {
    if (!p.quartier || p.latitude == null) continue;
    const cle = `${p.commune}|${normaliser(p.quartier)}`;
    const g = groupes.get(cle) ?? { commune: p.commune, quartier: p.quartier.trim(), lat: 0, lng: 0, n: 0 };
    g.lat += p.latitude; g.lng += p.longitude; g.n += 1;
    groupes.set(cle, g);
  }
  return [...groupes.values()]
    .map((g) => ({ commune: g.commune, quartier: g.quartier, latitude: g.lat / g.n, longitude: g.lng / g.n }))
    .sort((a, b) => a.commune.localeCompare(b.commune) || a.quartier.localeCompare(b.quartier, 'fr'));
}

/**
 * Liste prête à afficher : état, distance, filtres, tri.
 *   options : { position, commune, cnamgs, gardeSeulement, maintenant }
 * Tri : pharmacies ouvertes d'abord, puis par distance (ou par nom sans position).
 */
export function preparerListe(donnees, { position = null, commune = '', cnamgs = false, gardeSeulement = false, maintenant = new Date() } = {}) {
  const horairesPar = grouper(donnees.horaires, 'pharmacie_id');
  const gardesPar = grouper(donnees.gardes, 'pharmacie_id');
  return donnees.pharmacies
    .filter((p) => (!commune || p.commune === commune) && (!cnamgs || p.accepte_cnamgs))
    .map((p) => ({
      ...p,
      etat: etatPharmacie({ horaires: horairesPar.get(p.id) ?? [], gardes: gardesPar.get(p.id) ?? [] }, maintenant),
      distance: distanceKm(position, p),
    }))
    .filter((p) => !gardeSeulement || p.etat.gardeAujourdhui)
    .sort((a, b) => (b.etat.ouverte - a.etat.ouverte)
      || ((a.distance ?? Infinity) - (b.distance ?? Infinity))
      || a.nom.localeCompare(b.nom, 'fr'));
}

function grouper(lignes = [], cle) {
  const m = new Map();
  for (const l of lignes) {
    if (!m.has(l[cle])) m.set(l[cle], []);
    m.get(l[cle]).push(l);
  }
  return m;
}

/** Numéro pour un lien tel: (chiffres et + uniquement). */
export const lienTelephone = (numero) => `tel:${String(numero ?? '').replace(/[^\d+]/g, '')}`;

/** Itinéraire dans l'application de cartes du téléphone. */
export function lienItineraire(p) {
  if (p.latitude != null) return `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`;
  const q = [p.nom, p.adresse, p.quartier, p.commune, 'Gabon'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
