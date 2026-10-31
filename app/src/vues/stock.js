import { supabase, messageErreur } from '../supabase.js';
import { html, brut, depuis, formaterNombre, formaterPrix, FRAICHEUR } from '../format.js';
import { notifier, mettreAJourCompteur } from '../ui.js';

const FILTRES = [
  { id: 'tous', libelle: 'Tous' },
  { id: 'alerte', libelle: 'Sous le seuil' },
  { id: 'revoir', libelle: 'À revoir' },
];

let etat = { produits: [], recherche: '', filtre: 'tous' };

export async function afficher(main) {
  const { data, error } = await supabase.from('mon_stock').select('*').order('nom');
  if (error) throw error;
  etat = { produits: data ?? [], recherche: '', filtre: 'tous' };

  if (etat.produits.length === 0) {
    main.innerHTML = html`
      <h2>Stock</h2>
      <div class="vide">
        <h3>Aucun produit pour l'instant</h3>
        <p>Importez l'export de stock de votre logiciel (CSV ou Excel) pour remplir cette page.</p>
        <a class="bouton" href="#importer">Importer mon stock</a>
      </div>`;
    return;
  }

  main.innerHTML = html`
    <h2>Stock</h2>
    <div class="resume" id="resume"></div>
    <div class="barre">
      <input type="search" id="recherche" placeholder="Rechercher un produit ou un code"
        aria-label="Rechercher un produit ou un code" value="${etat.recherche}">
      <div class="filtres" role="group" aria-label="Filtrer">
        ${FILTRES.map((f) => brut(html`<button type="button" data-filtre="${f.id}"
          aria-pressed="${String(etat.filtre === f.id)}">${f.libelle}</button>`))}
      </div>
      <button type="button" class="secondaire pousse" id="confirmer-visibles">Confirmer les quantités affichées</button>
    </div>
    <p class="discret">Modifiez une quantité puis appuyez sur Entrée : elle est enregistrée et confirmée à l'heure actuelle.
      Après 12 h sans confirmation, le public voit « stock non récent » ; après 48 h, le produit n'est plus réservable.</p>
    <table class="tableau">
      <thead><tr>
        <th>Produit</th><th class="num">Quantité</th><th class="num">Seuil d'alerte</th>
        <th class="num">Prix</th><th>Fraîcheur</th><th><span class="discret">Action</span></th>
      </tr></thead>
      <tbody id="lignes"></tbody>
    </table>`;

  main.querySelector('#recherche').addEventListener('input', (e) => {
    etat.recherche = e.target.value;
    rendreLignes(main);
  });
  main.querySelectorAll('[data-filtre]').forEach((b) => b.addEventListener('click', () => {
    etat.filtre = b.dataset.filtre;
    main.querySelectorAll('[data-filtre]').forEach((x) =>
      x.setAttribute('aria-pressed', String(x.dataset.filtre === etat.filtre)));
    rendreLignes(main);
  }));
  main.querySelector('#confirmer-visibles').addEventListener('click', () => confirmerVisibles(main));

  rendreLignes(main);
}

function visibles() {
  const q = etat.recherche.trim().toLowerCase();
  return etat.produits.filter((p) => {
    if (q && !p.nom.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q)) return false;
    if (etat.filtre === 'alerte') return p.en_alerte;
    if (etat.filtre === 'revoir') return p.fraicheur !== 'recent';
    return true;
  });
}

function rendreResume(main) {
  const total = etat.produits.length;
  const alertes = etat.produits.filter((p) => p.en_alerte).length;
  const aRevoir = etat.produits.filter((p) => p.fraicheur !== 'recent').length;
  main.querySelector('#resume').innerHTML = html`
    <span><strong>${formaterNombre(total)}</strong> produits</span>
    <span><strong>${formaterNombre(alertes)}</strong> sous le seuil</span>
    <span><strong>${formaterNombre(aRevoir)}</strong> à revoir (non confirmés depuis 12 h)</span>`;
  mettreAJourCompteur(alertes);
}

function ligneHtml(p) {
  const f = FRAICHEUR[p.fraicheur] ?? FRAICHEUR.a_confirmer;
  return html`
    <tr class="${f.classe}${p.en_alerte ? ' en-alerte' : ''}" data-id="${p.produit_id}">
      <td>
        <div class="produit-nom">${p.nom}</div>
        <div class="code">${p.code}</div>
        ${p.en_alerte ? brut('<div class="alerte-texte">Sous le seuil d\'alerte</div>') : ''}
      </td>
      <td class="num" data-libelle="Quantité">
        <input class="quantite" type="number" inputmode="numeric" min="0" step="1"
          value="${p.quantite}" data-champ="quantite" aria-label="Quantité de ${p.nom}">
      </td>
      <td class="num" data-libelle="Seuil d'alerte">
        <input class="seuil" type="number" inputmode="numeric" min="0" step="1"
          value="${p.seuil_alerte}" data-champ="seuil_alerte" aria-label="Seuil d'alerte de ${p.nom}">
      </td>
      <td class="num" data-libelle="Prix">${formaterPrix(p.prix)}</td>
      <td data-libelle="Fraîcheur">
        <div class="fraicheur ${f.classe}"><b>${f.libelle}</b><span>${depuis(p.confirme_le)}</span></div>
      </td>
      <td>
        ${p.fraicheur !== 'recent'
          ? brut(html`<button type="button" class="secondaire" data-confirmer="${p.produit_id}">Confirmer</button>`)
          : ''}
      </td>
    </tr>`;
}

function rendreLignes(main) {
  rendreResume(main);
  const liste = visibles();
  const tbody = main.querySelector('#lignes');
  tbody.innerHTML = liste.length
    ? liste.map(ligneHtml).join('')
    : '<tr><td colspan="6">Aucun produit ne correspond.</td></tr>';

  tbody.querySelectorAll('input[data-champ]').forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('change', () => enregistrer(main, input));
  });
  tbody.querySelectorAll('[data-confirmer]').forEach((b) =>
    b.addEventListener('click', () => confirmer(main, [b.dataset.confirmer])));
}

async function enregistrer(main, input) {
  const id = input.closest('tr').dataset.id;
  const champ = input.dataset.champ;
  const produit = etat.produits.find((p) => p.produit_id === id);
  const valeur = Number(input.value);

  if (!Number.isInteger(valeur) || valeur < 0) {
    notifier('Saisissez un nombre entier positif.', { erreur: true });
    input.value = produit[champ];
    return;
  }
  if (valeur === produit[champ]) return;

  input.disabled = true;
  // L'officine n'est pas envoyée : la base n'autorise que les lignes de la vôtre.
  const { data, error } = await supabase.from('stocks')
    .update({ [champ]: valeur })
    .eq('produit_id', id)
    .select('quantite, seuil_alerte, confirme_le')
    .single();
  input.disabled = false;

  if (error) {
    notifier(messageErreur(error), { erreur: true });
    input.value = produit[champ];
    return;
  }
  Object.assign(produit, data, {
    en_alerte: data.quantite <= data.seuil_alerte,
    fraicheur: champ === 'quantite' ? 'recent' : produit.fraicheur,
  });
  notifier(champ === 'quantite'
    ? `${produit.nom} : ${formaterNombre(valeur)} en stock, confirmé.`
    : `${produit.nom} : seuil d'alerte à ${formaterNombre(valeur)}.`);
  rendreLignes(main);
  main.querySelector(`tr[data-id="${CSS.escape(id)}"] input[data-champ="${champ}"]`)?.classList.add('enregistre');
}

async function confirmer(main, ids) {
  const { data: nb, error } = await supabase.rpc('confirmer_stock', { produits: ids });
  if (error) { notifier(messageErreur(error), { erreur: true }); return; }
  const maintenant = new Date().toISOString();
  etat.produits.forEach((p) => {
    if (ids.includes(p.produit_id)) Object.assign(p, { confirme_le: maintenant, fraicheur: 'recent' });
  });
  notifier(nb === 1 ? 'Quantité confirmée.' : `${formaterNombre(nb)} quantités confirmées.`);
  rendreLignes(main);
}

function confirmerVisibles(main) {
  const ids = visibles().filter((p) => p.fraicheur !== 'recent').map((p) => p.produit_id);
  if (ids.length === 0) { notifier('Toutes les quantités affichées sont déjà confirmées.'); return; }
  const ok = window.confirm(
    `Confirmer ${ids.length} quantité(s) sans les modifier ?\n\n` +
    'Ne le faites que si vous avez vérifié ces produits en rayon : les patients verront ces quantités comme sûres.');
  if (ok) confirmer(main, ids);
}
