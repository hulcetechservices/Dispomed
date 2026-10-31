// Dates et heures à l'heure de Libreville (UTC+1, sans heure d'été).
const DECALAGE_MS = 60 * 60 * 1000;
const deux = (n) => String(n).padStart(2, '0');

/** Instant (ISO ou Date) → composants de l'heure de Libreville. */
export function enLibreville(instant) {
  const d = new Date(new Date(instant).getTime() + DECALAGE_MS);
  return {
    annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1, jour: d.getUTCDate(),
    heure: d.getUTCHours(), minute: d.getUTCMinutes(), jourSemaine: ((d.getUTCDay() + 6) % 7) + 1,
  };
}

/** « AAAA-MM-JJ » du jour à Libreville. */
export function dateLibreville(instant = new Date()) {
  const c = enLibreville(instant);
  return `${c.annee}-${deux(c.mois)}-${deux(c.jour)}`;
}

/** « AAAA-MM-JJTHH:MM » saisi à Libreville → instant ISO (UTC). */
export function versInstant(local) {
  const [d, h = '00:00'] = local.split('T');
  const [a, m, j] = d.split('-').map(Number);
  const [hh, mm] = h.split(':').map(Number);
  return new Date(Date.UTC(a, m - 1, j, hh, mm) - DECALAGE_MS).toISOString();
}

/** Lundi de la semaine contenant la date « AAAA-MM-JJ ». */
export function lundiDe(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  const decal = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - decal);
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
}

export function ajouterJours(iso, n) {
  const [a, m, j] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
}

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const NOMS_JOURS = JOURS;

/** « lundi 2 nov. » */
export function libelleJour(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  const js = (new Date(Date.UTC(a, m - 1, j)).getUTCDay() + 6) % 7;
  return `${JOURS[js]} ${j} ${MOIS[m - 1]}`;
}

/** « 20 h » ou « 8 h 30 », à l'heure de Libreville. */
export function libelleHeure(instant) {
  const c = enLibreville(instant);
  return c.minute ? `${c.heure} h ${deux(c.minute)}` : `${c.heure} h`;
}

/** « 20:00 » pour un champ <input type="time">. */
export function heureChamp(instant) {
  const c = enLibreville(instant);
  return `${deux(c.heure)}:${deux(c.minute)}`;
}

/** Première lettre en majuscule : « Lundi 2 nov. » */
export const majuscule = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** « 1 pharmacie », « 3 pharmacies ». */
export const pluriel = (n, singulier, plurielForme = `${singulier}s`) => `${n} ${n > 1 ? plurielForme : singulier}`;

/** Il y a combien de temps, en français. */
export function depuis(instant, maintenant = new Date()) {
  const min = Math.floor((maintenant - new Date(instant)) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
