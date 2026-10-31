// Éléments d'interface partagés entre les vues.

let minuterie;

export function notifier(message, { erreur = false } = {}) {
  const zone = document.getElementById('notification');
  zone.textContent = message;
  zone.className = erreur ? 'erreur' : '';
  zone.hidden = false;
  clearTimeout(minuterie);
  minuterie = setTimeout(() => { zone.hidden = true; }, erreur ? 7000 : 3500);
}

/** Pastille du nombre de produits à commander, dans l'onglet. */
export function mettreAJourCompteur(n) {
  const pastille = document.querySelector('[data-compteur="commander"]');
  if (!pastille) return;
  pastille.textContent = String(n);
  pastille.hidden = n === 0;
}

/** Télécharge un texte comme fichier. */
export function telecharger(nomFichier, contenu, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + contenu], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
