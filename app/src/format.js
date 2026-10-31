// Petites fonctions d'affichage, sans dépendance.

export const FRAICHEUR = {
  recent: { libelle: 'Confirmé', classe: 'recent' },
  non_recent: { libelle: 'Stock non récent', classe: 'non-recent' },
  a_confirmer: { libelle: 'À confirmer', classe: 'a-confirmer' },
};

/** « à l'instant », « il y a 25 min », « il y a 3 h », « il y a 2 j ». */
export function depuis(date, maintenant = new Date()) {
  const ms = maintenant - new Date(date);
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

const nombre = new Intl.NumberFormat('fr-FR');
export const formaterNombre = (n) => (n == null ? '' : nombre.format(n));
export const formaterPrix = (n) => (n == null ? '—' : `${nombre.format(n)} F`);

/** Échappe le texte venant des fichiers ou de la base avant insertion HTML. */
export function echapper(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Gabarit HTML où chaque valeur interpolée est échappée. */
export function html(chaines, ...valeurs) {
  return chaines.reduce((acc, s, i) => {
    if (i === 0) return s;
    const v = valeurs[i - 1];
    const rendu = v && v.__brut !== undefined ? v.__brut
      : Array.isArray(v) ? v.map((x) => (x && x.__brut !== undefined ? x.__brut : echapper(x))).join('')
      : echapper(v);
    return acc + rendu + s;
  }, '');
}

/** Marque un fragment déjà sûr pour qu'il ne soit pas ré-échappé. */
export const brut = (texte) => ({ __brut: texte });
