import { supabase } from '../supabase.js';
import { html, brut, formaterNombre } from '../format.js';
import { notifier, mettreAJourCompteur, telecharger } from '../ui.js';

export async function afficher(main, contexte) {
  const { data, error } = await supabase.from('a_reapprovisionner')
    .select('*')
    .order('quantite')
    .order('nom');
  if (error) throw error;
  mettreAJourCompteur(data.length);

  if (data.length === 0) {
    main.innerHTML = html`
      <h2>À commander</h2>
      <div class="vide">
        <h3>Rien à commander</h3>
        <p>Aucun produit n'est sous son seuil d'alerte. Les seuils se règlent produit par produit dans l'onglet Stock.</p>
        <a class="bouton secondaire" href="#stock">Régler les seuils</a>
      </div>`;
    return;
  }

  main.innerHTML = html`
    <h2>À commander</h2>
    <p class="discret">Produits au seuil d'alerte ou en dessous. La quantité suggérée remonte le stock à deux fois le seuil ; ajustez-la selon votre grossiste.</p>
    <div class="barre">
      <button type="button" id="copier">Copier la liste</button>
      <button type="button" class="secondaire" id="csv">Télécharger en CSV</button>
    </div>
    <table class="tableau">
      <thead><tr><th>Produit</th><th class="num">En stock</th><th class="num">Seuil</th><th class="num">À commander</th></tr></thead>
      <tbody>${data.map((p) => brut(html`
        <tr class="${p.quantite === 0 ? 'a-confirmer' : 'non-recent'}">
          <td><div class="produit-nom">${p.nom}</div><div class="code">${p.code}</div></td>
          <td class="num" data-libelle="En stock">${formaterNombre(p.quantite)}</td>
          <td class="num" data-libelle="Seuil">${formaterNombre(p.seuil_alerte)}</td>
          <td class="num" data-libelle="À commander"><b>${formaterNombre(p.quantite_suggeree)}</b></td>
        </tr>`))}</tbody>
    </table>`;

  const date = new Date().toLocaleDateString('fr-FR');
  main.querySelector('#copier').addEventListener('click', async () => {
    const texte = [`Commande ${contexte.officine.nom}, ${date}`, '']
      .concat(data.map((p) => `${p.code}  ${p.nom}  x ${p.quantite_suggeree}`))
      .join('\n');
    try {
      await navigator.clipboard.writeText(texte);
      notifier(`Liste copiée : ${data.length} produits.`);
    } catch {
      notifier('Copie impossible dans ce navigateur. Utilisez le téléchargement CSV.', { erreur: true });
    }
  });
  main.querySelector('#csv').addEventListener('click', () => {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const contenu = ['code;nom;en_stock;seuil;a_commander']
      .concat(data.map((p) => [p.code, p.nom, p.quantite, p.seuil_alerte, p.quantite_suggeree].map(q).join(';')))
      .join('\r\n');
    telecharger(`commande-${date.replace(/\//g, '-')}.csv`, contenu);
  });
}
