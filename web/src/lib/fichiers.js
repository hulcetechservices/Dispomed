// Lecture des fichiers d'import (CSV ou Excel) et correspondance des colonnes.
// Fonctions pures, testées dans tests/fichiers.test.mjs.

export function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-.'’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Devine le séparateur (Excel en français exporte souvent avec « ; »). */
export function detecterSeparateur(texte) {
  const premiere = texte.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
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

/** Découpe un texte CSV en lignes de cellules. */
export function analyserCsv(texte, separateur = detecterSeparateur(texte)) {
  const source = texte.replace(/^﻿/, '');
  const lignes = [];
  let ligne = [];
  let cellule = '';
  let dansGuillemets = false;
  let debutChamp = true;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (source[i + 1] === '"') { cellule += '"'; i++; } else dansGuillemets = false;
      } else cellule += c;
    } else if (c === '"' && debutChamp) {
      dansGuillemets = true; debutChamp = false;
    } else if (c === separateur) {
      ligne.push(cellule); cellule = ''; debutChamp = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      ligne.push(cellule); lignes.push(ligne); ligne = []; cellule = ''; debutChamp = true;
    } else {
      cellule += c; debutChamp = false;
    }
  }
  if (cellule !== '' || ligne.length > 0) { ligne.push(cellule); lignes.push(ligne); }
  return lignes;
}

/**
 * Associe les colonnes du fichier aux champs attendus.
 * champs : { cle: { alias: ['nom', ...], obligatoire: true, libelle: 'Nom' } }
 */
export function correspondre(entetes, champs) {
  const norm = entetes.map(normaliser);
  const colonnes = {};
  for (const [cle, def] of Object.entries(champs)) {
    colonnes[cle] = norm.findIndex((h) => def.alias.includes(h));
  }
  const manquantes = Object.entries(champs)
    .filter(([cle, def]) => def.obligatoire && colonnes[cle] === -1)
    .map(([, def]) => def.libelle);
  return { colonnes, manquantes };
}

/** Tableau (1re ligne = en-têtes) → objets, lignes vides ignorées, n° de ligne conservé. */
export function versObjets(tableau, champs) {
  const [entetes = [], ...corps] = tableau;
  const { colonnes, manquantes } = correspondre(entetes.map((e) => String(e ?? '')), champs);
  if (manquantes.length) return { lignes: [], manquantes, entetes };
  const lignes = [];
  corps.forEach((cellules, i) => {
    if (!cellules.some((c) => String(c ?? '').trim() !== '')) return;
    const objet = { ligne: i + 2 };
    for (const cle of Object.keys(champs)) {
      objet[cle] = colonnes[cle] === -1 ? '' : cellules[colonnes[cle]] ?? '';
      if (typeof objet[cle] === 'string') objet[cle] = objet[cle].trim();
    }
    lignes.push(objet);
  });
  return { lignes, manquantes, entetes };
}

// ---------------------------------------------------------------- Dates des gardes

const deux = (n) => String(n).padStart(2, '0');

/**
 * Date d'un fichier → « AAAA-MM-JJ ». Accepte 02/11/2026, 2/11/26, 2026-11-02,
 * et les dates Excel (objet Date). Les dates françaises sont jour/mois.
 */
export function lireDate(valeur) {
  if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) {
    return `${valeur.getFullYear()}-${deux(valeur.getMonth() + 1)}-${deux(valeur.getDate())}`;
  }
  const t = String(valeur ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valide(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) {
    const annee = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valide(annee, +m[2], +m[1]);
  }
  return null;
}

function valide(a, mo, j) {
  const d = new Date(Date.UTC(a, mo - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null;
  return `${a}-${deux(mo)}-${deux(j)}`;
}

/** Heure d'un fichier → « HH:MM ». Accepte 20:00, 20h, 20 h 30, 8h30, et les heures Excel. */
export function lireHeure(valeur) {
  if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) {
    return `${deux(valeur.getHours())}:${deux(valeur.getMinutes())}`;
  }
  if (typeof valeur === 'number' && valeur >= 0 && valeur < 1) {
    const minutes = Math.round(valeur * 24 * 60);
    return `${deux(Math.floor(minutes / 60) % 24)}:${deux(minutes % 60)}`;
  }
  const t = String(valeur ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2})(?:[:h](\d{2})?)?$/);
  if (!m) return null;
  const h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h === 24 ? '24:00' : `${deux(h)}:${deux(mi)}`;
}

/**
 * Ligne de garde du fichier → { debut, fin } au format « AAAA-MM-JJTHH:MM »
 * (heure de Libreville). Fin absente : lendemain même jour si l'heure de fin est
 * avant l'heure de début (garde de nuit). « 24:00 » = minuit du jour suivant.
 */
export function periodeGarde({ date_debut, heure_debut, date_fin, heure_fin }) {
  const jd = lireDate(date_debut);
  const hd = lireHeure(heure_debut);
  const hf = lireHeure(heure_fin);
  if (!jd || !hd || !hf) return null;
  let jf = date_fin !== '' && date_fin != null ? lireDate(date_fin) : null;
  if (date_fin !== '' && date_fin != null && !jf) return null;
  if (!jf) jf = hf <= hd ? decalerJour(jd, 1) : jd;
  const debut = hd === '24:00' ? `${decalerJour(jd, 1)}T00:00` : `${jd}T${hd}`;
  const fin = hf === '24:00' ? `${decalerJour(jf, 1)}T00:00` : `${jf}T${hf}`;
  return { debut, fin };
}

export function decalerJour(iso, n) {
  const [a, m, j] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
}
