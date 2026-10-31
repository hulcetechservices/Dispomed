/** Échappe un texte avant de l'insérer dans du HTML construit à la main (bulles de carte). */
export const echapperHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
