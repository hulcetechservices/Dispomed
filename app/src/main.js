import { supabase, configure, messageErreur } from './supabase.js';
import { html, brut } from './format.js';
import { notifier, mettreAJourCompteur } from './ui.js';
import * as vueStock from './vues/stock.js';
import * as vueImporter from './vues/importer.js';
import * as vueCommander from './vues/commander.js';
import * as vueOfficine from './vues/officine.js';

const racine = document.getElementById('app');

const LOGO = brut(`<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="6" fill="currentColor"/>
  <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="var(--papier)"/></svg>`);

const ONGLETS = [
  { id: 'stock', libelle: 'Stock', vue: vueStock },
  { id: 'importer', libelle: 'Importer', vue: vueImporter },
  { id: 'commander', libelle: 'À commander', vue: vueCommander },
  { id: 'officine', libelle: 'Mon officine', vue: vueOfficine },
];

const contexte = { pharmacien: null, officine: null };

// Lien d'invitation Supabase : le compte est créé par l'équipe Dispomed, le
// pharmacien choisit son mot de passe à la première ouverture. À lire avant
// que supabase-js ne consomme l'adresse.
let invitation = /(^|[#&])type=invite(&|$)/.test(location.hash);

// ---------------------------------------------------------------- Connexion

function afficherConnexion(message = '') {
  racine.innerHTML = html`
    <div class="connexion">
      <form id="form-connexion" novalidate>
        <div class="marque">${LOGO} Dispomed Officine</div>
        <p class="discret">Connectez-vous pour gérer le stock de votre officine.</p>
        <label class="champ">Adresse e-mail
          <input type="email" name="email" autocomplete="username" required>
        </label>
        <label class="champ">Mot de passe
          <input type="password" name="motdepasse" autocomplete="current-password" required>
        </label>
        <p class="erreur" id="erreur-connexion" role="alert">${message}</p>
        <button type="submit">Se connecter</button>
        <button type="button" class="lien" id="oubli">Mot de passe oublié</button>
      </form>
    </div>`;

  const form = document.getElementById('form-connexion');
  const zoneErreur = document.getElementById('erreur-connexion');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = new FormData(form);
    const bouton = form.querySelector('button[type="submit"]');
    bouton.disabled = true;
    bouton.textContent = 'Connexion…';
    const { error } = await supabase.auth.signInWithPassword({
      email: String(donnees.get('email')).trim(),
      password: String(donnees.get('motdepasse')),
    });
    if (error) {
      zoneErreur.textContent = messageErreur(error);
      bouton.disabled = false;
      bouton.textContent = 'Se connecter';
    }
  });

  document.getElementById('oubli').addEventListener('click', async () => {
    const email = String(new FormData(form).get('email')).trim();
    if (!email) { zoneErreur.textContent = "Saisissez d'abord votre adresse e-mail."; return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) zoneErreur.textContent = messageErreur(error);
    else notifier('Lien de réinitialisation envoyé, si ce compte existe.');
  });
}

function afficherNouveauMotDePasse({ bienvenue = false } = {}) {
  racine.innerHTML = html`
    <div class="connexion">
      <form id="form-mdp">
        <div class="marque">${LOGO} ${bienvenue ? 'Bienvenue sur Dispomed' : 'Nouveau mot de passe'}</div>
        ${bienvenue ? brut('<p class="discret">Choisissez le mot de passe de votre compte. Vous l\'utiliserez pour vous connecter avec votre adresse e-mail.</p>') : ''}
        <label class="champ">Nouveau mot de passe
          <span class="aide">10 caractères minimum.</span>
          <input type="password" name="mdp" minlength="10" autocomplete="new-password" required>
        </label>
        <p class="erreur" role="alert" id="erreur-mdp"></p>
        <button type="submit">Enregistrer le mot de passe</button>
      </form>
    </div>`;
  const form = document.getElementById('form-mdp');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mdp = String(new FormData(form).get('mdp'));
    if (mdp.length < 10) {
      document.getElementById('erreur-mdp').textContent = 'Le mot de passe doit faire au moins 10 caractères.';
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: mdp });
    if (error) document.getElementById('erreur-mdp').textContent = messageErreur(error);
    else { notifier('Mot de passe enregistré.'); demarrerSession(); }
  });
}

function afficherAttente(pharmacien) {
  racine.innerHTML = html`
    <div class="connexion">
      <form>
        <div class="marque">${LOGO} Compte en cours de vérification</div>
        <p>${pharmacien
          ? `Bonjour ${pharmacien.nom}. L'équipe Dispomed vérifie votre numéro d'inscription à l'Ordre. Vous aurez accès à votre officine dès que la vérification sera faite.`
          : "Ce compte n'est rattaché à aucune officine. Contactez l'équipe Dispomed pour l'activer."}</p>
        <button type="button" class="secondaire" id="deconnexion">Se déconnecter</button>
      </form>
    </div>`;
  document.getElementById('deconnexion').addEventListener('click', () => supabase.auth.signOut());
}

// ---------------------------------------------------------------- Application

function ongletCourant() {
  const id = location.hash.replace('#', '');
  return ONGLETS.find((o) => o.id === id) ?? ONGLETS[0];
}

async function afficherOnglet() {
  const onglet = ongletCourant();
  document.querySelectorAll('nav.onglets a').forEach((a) => {
    if (a.dataset.onglet === onglet.id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const main = document.querySelector('main');
  main.innerHTML = '<p class="chargement">Chargement…</p>';
  try {
    await onglet.vue.afficher(main, contexte);
  } catch (e) {
    main.innerHTML = html`<p class="erreur">${messageErreur(e)}</p>`;
  }
}

function afficherApplication() {
  const { officine, pharmacien } = contexte;
  racine.innerHTML = html`
    <header class="entete">
      <div class="officine">
        <h1>${officine.nom}</h1>
        <small>${pharmacien.nom}${officine.quartier ? `, ${officine.quartier}` : ''}</small>
      </div>
      <button type="button" id="deconnexion">Se déconnecter</button>
    </header>
    <nav class="onglets" aria-label="Sections">
      ${ONGLETS.map((o) => brut(html`<a href="#${o.id}" data-onglet="${o.id}">${o.libelle}${
        o.id === 'commander' ? brut('<span class="compteur" data-compteur="commander" hidden></span>') : ''
      }</a>`))}
    </nav>
    <main></main>`;
  document.getElementById('deconnexion').addEventListener('click', () => supabase.auth.signOut());
  afficherOnglet();
  // Compteur de l'onglet « À commander », affiché quel que soit l'onglet ouvert.
  supabase.from('a_reapprovisionner').select('produit_id', { count: 'exact', head: true })
    .then(({ count }) => mettreAJourCompteur(count ?? 0));
}

// ---------------------------------------------------------------- Session

let sessionChargee = null;

async function demarrerSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { sessionChargee = null; afficherConnexion(); return; }
  if (sessionChargee === session.user.id && contexte.officine) return;
  sessionChargee = session.user.id;

  const { data: pharmacien, error } = await supabase
    .from('pharmaciens')
    .select('nom, role, verifie, officine_id')
    .maybeSingle();
  if (error) { afficherConnexion(messageErreur(error)); return; }
  if (!pharmacien || !pharmacien.verifie) { afficherAttente(pharmacien); return; }

  const { data: officine, error: e2 } = await supabase.from('officines').select('*').single();
  if (e2 || !officine) { afficherAttente(pharmacien); return; }

  Object.assign(contexte, { pharmacien, officine });
  afficherApplication();
}

window.addEventListener('hashchange', () => { if (contexte.officine) afficherOnglet(); });

if (!configure) {
  racine.innerHTML = html`<div class="connexion"><form>
    <div class="marque">${LOGO} Configuration manquante</div>
    <p>Renseignez l'URL du projet Supabase et la clé publishable dans <b>config.js</b>.</p>
  </form></div>`;
} else {
  supabase.auth.onAuthStateChange((evenement, session) => {
    if (evenement === 'PASSWORD_RECOVERY') { afficherNouveauMotDePasse(); return; }
    if (evenement === 'SIGNED_OUT') {
      sessionChargee = null;
      Object.assign(contexte, { pharmacien: null, officine: null });
      afficherConnexion();
      return;
    }
    if (invitation && session && (evenement === 'SIGNED_IN' || evenement === 'INITIAL_SESSION')) {
      invitation = false;
      afficherNouveauMotDePasse({ bienvenue: true });
      return;
    }
    if (evenement === 'SIGNED_IN' || evenement === 'INITIAL_SESSION') {
      // Différé : on ne doit pas appeler Supabase dans le rappel lui-même.
      setTimeout(demarrerSession, 0);
    }
  });
}
