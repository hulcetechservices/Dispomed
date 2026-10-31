import { supabase, messageErreur } from '../supabase.js';
import { html, brut } from '../format.js';
import { notifier } from '../ui.js';

const MONNAIES = [
  { id: 'XAF', libelle: 'Franc CFA (XAF)' },
  { id: 'EUR', libelle: 'Euro' },
  { id: 'USD', libelle: 'Dollar US' },
];

const PAIEMENTS = [
  { id: 'especes', libelle: 'Espèces' },
  { id: 'airtel_money', libelle: 'Airtel Money' },
  { id: 'moov_money', libelle: 'Moov Money' },
  { id: 'carte', libelle: 'Carte bancaire' },
  { id: 'cheque', libelle: 'Chèque' },
  { id: 'assurance', libelle: 'Tiers payant / assurance' },
];

const cases = (nom, options, coches) => options.map((o) => brut(html`
  <label><input type="checkbox" name="${nom}" value="${o.id}" ${coches.includes(o.id) ? brut('checked') : ''}> ${o.libelle}</label>`));

export async function afficher(main, contexte) {
  const o = contexte.officine;
  main.innerHTML = html`
    <h2>Mon officine</h2>
    <p class="discret">Ces informations sont affichées aux patients à côté de vos produits.
      Pour changer le nom, l'adresse ou la position sur la carte, contactez l'équipe Dispomed.</p>
    <div class="lecture-seule">
      <b>${o.nom}</b>
      <span>${[o.adresse, o.quartier, o.ville].filter(Boolean).join(', ') || 'Adresse non renseignée'}</span>
    </div>
    <form class="formulaire" id="form-officine">
      <label class="champ">Téléphone affiché
        <input type="tel" name="telephone" autocomplete="tel" value="${o.telephone ?? ''}" placeholder="+241 …">
      </label>
      <label class="champ">Horaires
        <span class="aide">Par exemple : lun.-sam. 8 h-21 h, dim. 9 h-13 h</span>
        <input type="text" name="horaires" maxlength="200" value="${o.horaires ?? ''}">
      </label>
      <fieldset class="choix"><legend>Monnaies acceptées</legend>${cases('monnaies', MONNAIES, o.monnaies)}</fieldset>
      <fieldset class="choix"><legend>Moyens de paiement acceptés</legend>${cases('paiements', PAIEMENTS, o.moyens_paiement)}</fieldset>
      <label class="choix" style="font-weight:700">
        <input type="checkbox" name="de_garde" ${o.de_garde ? brut('checked') : ''}> Officine de garde en ce moment
      </label>
      <p class="erreur" id="erreur-officine" role="alert"></p>
      <div><button type="submit">Enregistrer les informations</button></div>
    </form>`;

  const form = main.querySelector('#form-officine');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const modifs = {
      telephone: String(d.get('telephone')).trim() || null,
      horaires: String(d.get('horaires')).trim() || null,
      monnaies: d.getAll('monnaies'),
      moyens_paiement: d.getAll('paiements'),
      de_garde: d.get('de_garde') === 'on',
    };
    const zone = main.querySelector('#erreur-officine');
    if (!modifs.monnaies.length || !modifs.moyens_paiement.length) {
      zone.textContent = 'Cochez au moins une monnaie et un moyen de paiement.';
      return;
    }
    zone.textContent = '';
    const bouton = form.querySelector('button[type="submit"]');
    bouton.disabled = true;
    const { data, error } = await supabase.from('officines')
      .update(modifs).eq('id', o.id).select('*').single();
    bouton.disabled = false;
    if (error) { zone.textContent = messageErreur(error); return; }
    Object.assign(contexte.officine, data);
    notifier('Informations enregistrées.');
  });
}
