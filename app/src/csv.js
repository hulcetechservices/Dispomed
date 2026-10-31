// Lecture des fichiers de stock (CSV ou feuille Excel déjà convertie en lignes).
// Module pur, sans dépendance : testé dans tests/csv.test.mjs.

/** Normalise un en-tête : minuscules, sans accents, espaces simples. */
export function normaliserEntete(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Noms de colonnes acceptés, déjà normalisés. Les exports de logiciels
// d'officine varient : on reconnaît les libellés les plus courants.
const ALIAS = {
  code: ['code', 'code produit', 'code article', 'cip', 'code cip', 'cip13', 'cip7',
    'ean', 'ean13', 'code barre', 'code barres', 'reference', 'ref'],
  nom: ['nom', 'nom produit', 'designation', 'libelle', 'produit', 'article', 'medicament'],
  quantite: ['quantite', 'qte', 'qt', 'stock', 'quantite en stock', 'qte stock', 'stock actuel'],
  prix: ['prix', 'prix vente', 'prix de vente', 'pv', 'ppv', 'prix public', 'prix unitaire', 'pu'],
};

export const COLONNES_OBLIGATOIRES = ['code', 'quantite'];

/** Associe chaque champ attendu à l'index de sa colonne, ou -1. */
export function correspondreColonnes(entetes) {
  const normalises = entetes.map(normaliserEntete);
  const colonnes = {};
  for (const [champ, alias] of Object.entries(ALIAS)) {
    colonnes[champ] = normalises.findIndex((h) => alias.includes(h));
  }
  const manquantes = COLONNES_OBLIGATOIRES.filter((c) => colonnes[c] === -1);
  return { colonnes, manquantes };
}

/** Devine le séparateur (Excel en français exporte souvent avec « ; »). */
export function detecterSeparateur(texte) {
  const premiere = texte.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  let meilleur = ',';
  let max = -1;
  for (const sep of [';', ',', '\t']) {
    let n = 0;
    let dansGuillemets = false;
    for (const c of premiere) {
      if (c === '"') dansGuillemets = !dansGuillemets;
      else if (c === sep && !dansGuillemets) n++;
    }
    if (n > max) { max = n; meilleur = sep; }
  }
  return meilleur;
}

/** Découpe un texte CSV en lignes de cellules (guillemets et "" gérés). */
export function analyserCsv(texte, separateur = detecterSeparateur(texte)) {
  const source = texte.replace(/^\uFEFF/, '');
  const lignes = [];
  let ligne = [];
  let cellule = '';
  let dansGuillemets = false;
  let debutChamp = true; // un guillemet n'ouvre une zone protégée qu'en début de champ

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (source[i + 1] === '"') { cellule += '"'; i++; }
        else dansGuillemets = false;
      } else {
        cellule += c;
      }
    } else if (c === '"' && debutChamp) {
      dansGuillemets = true;
      debutChamp = false;
    } else if (c === separateur) {
      ligne.push(cellule); cellule = '';
      debutChamp = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      ligne.push(cellule); lignes.push(ligne);
      ligne = []; cellule = '';
      debutChamp = true;
    } else {
      cellule += c;
      debutChamp = false;
    }
  }
  if (cellule !== '' || ligne.length > 0) { ligne.push(cellule); lignes.push(ligne); }
  return lignes;
}

/**
 * Transforme un tableau de lignes (la première = en-têtes) en lignes prêtes
 * pour importer_stock. Les lignes vides sont ignorées ; « ligne » garde le
 * numéro de la ligne dans le fichier, pour que les erreurs soient lisibles.
 */
export function versLignesImport(tableau) {
  const [entetes = [], ...corps] = tableau;
  const { colonnes, manquantes } = correspondreColonnes(entetes);
  if (manquantes.length) {
    return { lignes: [], colonnes, manquantes, entetes };
  }
  const lire = (cellules, champ) =>
    colonnes[champ] === -1 ? '' : String(cellules[colonnes[champ]] ?? '').trim();

  const lignes = [];
  corps.forEach((cellules, i) => {
    if (!cellules.some((c) => String(c ?? '').trim() !== '')) return;
    lignes.push({
      ligne: i + 2,
      code: lire(cellules, 'code'),
      nom: lire(cellules, 'nom'),
      quantite: lire(cellules, 'quantite'),
      prix: lire(cellules, 'prix'),
    });
  });
  return { lignes, colonnes, manquantes, entetes };
}
