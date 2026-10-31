// Faux client Supabase en mémoire pour les tests navigateur du back-office.
// Il imite l'API utilisée par l'interface ; la logique serveur réelle est testée
// à part (supabase/tests/acces.sql).

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(16).slice(2)}`);
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const COMMUNES = { libreville: 'libreville', lbv: 'libreville', akanda: 'akanda', owendo: 'owendo' };

const db = {
  utilisateurs: [
    { id: 'u-admin', email: 'hulcetechservices@gmail.com', role: 'admin', nom: null },
    { id: 'u-patient', email: 'patient@exemple.ga', role: 'patient', nom: null },
  ],
  pharmacies: [],
  horaires: [],
  gardes: [],
  medicaments: [
    ['Paracétamol', 'paracétamol', '500 mg', 'comprimé', ['Doliprane', 'Efferalgan']],
    ['Paracétamol', 'paracétamol', '1 g', 'comprimé', ['Doliprane']],
    ['Amoxicilline', 'amoxicilline', '500 mg', 'gélule', ['Clamoxyl']],
    ['Clamoxyl', 'amoxicilline', '500 mg', 'gélule', []],
  ].map(([nom_commercial, molecule, dosage, forme, synonymes]) => ({ id: uid(), nom_commercial, molecule, dosage, forme, synonymes, actif: true })),
  journal: [],
};
globalThis.__fauxDb = db;

// Données d'essai injectées par un test (window.__fauxDonnees), et options :
// __fauxHorsLigne (Supabase injoignable), __fauxDelai (millisecondes par requête, réseau lent).
if (globalThis.__fauxDonnees) {
  for (const [table, lignes] of Object.entries(globalThis.__fauxDonnees)) db[table] = lignes.map((l) => ({ ...l }));
}
const attendre = () => new Promise((ok) => setTimeout(ok, globalThis.__fauxDelai ?? 0));

const recherche = (m) => norm(`${m.nom_commercial} ${m.molecule ?? ''} ${m.dosage ?? ''} ${m.forme ?? ''} ${m.synonymes.join(' ')}`);
const journaliser = (action, cible, details) => db.journal.push({ id: db.journal.length + 1, action, cible, details, date: new Date().toISOString() });

// ---------------------------------------------------------------- Requêtes

function requete(table) {
  const filtres = [];
  const tris = [];
  let op = 'select';
  let valeurs = null;
  let unique = false;
  let tete = false;
  let compter = false;
  let plage = null;

  const lignes = () => db[table].filter((r) => filtres.every((f) => f(r)));

  const executer = () => {
    if (op === 'update') {
      const cible = lignes();
      for (const r of cible) {
        if (table === 'medicaments' && db.medicaments.some((m) => m !== r && norm(m.nom_commercial) === norm(valeurs.nom_commercial ?? r.nom_commercial)
          && norm(m.dosage) === norm(valeurs.dosage ?? r.dosage) && norm(m.forme) === norm(valeurs.forme ?? r.forme))) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        Object.assign(r, valeurs);
      }
      return { data: null, error: null };
    }
    if (op === 'insert') {
      const r = { id: uid(), ...valeurs };
      if (table === 'medicaments' && db.medicaments.some((m) => norm(m.nom_commercial) === norm(r.nom_commercial)
        && norm(m.dosage) === norm(r.dosage) && norm(m.forme) === norm(r.forme))) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      db[table].push(r);
      return { data: null, error: null };
    }
    if (op === 'delete') {
      const cible = new Set(lignes());
      db[table] = db[table].filter((r) => !cible.has(r));
      return { data: null, error: null };
    }
    let res = lignes().map((r) => ({ ...r }));
    for (const [col, asc] of [...tris].reverse()) {
      res.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? ''), 'fr') * (asc ? 1 : -1));
    }
    const total = res.length;
    if (plage) res = res.slice(plage[0], plage[1] + 1);
    if (tete) return { data: null, count: total, error: null };
    if (unique) return { data: res[0] ?? null, error: null };
    return { data: res, count: compter ? total : null, error: null };
  };

  const q = {
    select(_c, opts = {}) { tete = !!opts.head; compter = opts.count === 'exact'; return q; },
    eq(c, v) { filtres.push((r) => r[c] === v); return q; },
    lt(c, v) { filtres.push((r) => r[c] < v); return q; },
    gt(c, v) { filtres.push((r) => r[c] > v); return q; },
    ilike(c, motif) {
      const t = norm(motif.replace(/%/g, ''));
      filtres.push((r) => (c === 'recherche' ? recherche(r) : norm(r[c])).includes(t));
      return q;
    },
    order(c, opts = {}) { tris.push([c, opts.ascending !== false]); return q; },
    range(a, b) { plage = [a, b]; return q; },
    limit(n) { plage = [0, n - 1]; return q; },
    update(v) { op = 'update'; valeurs = v; return q; },
    insert(v) { op = 'insert'; valeurs = v; return q; },
    delete() { op = 'delete'; return q; },
    single() { unique = true; return q; },
    maybeSingle() { unique = true; return q; },
    then(ok, ko) {
      return attendre()
        .then(() => (globalThis.__fauxHorsLigne ? { data: null, error: { message: 'Failed to fetch' } } : executer()))
        .then(ok, ko);
    },
  };
  return q;
}

// ---------------------------------------------------------------- Fonctions

const fonctions = {
  pharmacies_admin: () => [...db.pharmacies].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),

  enregistrer_pharmacie: ({ fiche }) => {
    if (fiche.id) {
      Object.assign(db.pharmacies.find((p) => p.id === fiche.id), fiche);
      return fiche.id;
    }
    const p = { statut: 'en_attente', mutuelles: [], services: [], ...fiche, id: uid() };
    db.pharmacies.push(p);
    return p.id;
  },

  changer_statut_pharmacie: ({ pharmacie, nouveau }) => {
    const p = db.pharmacies.find((x) => x.id === pharmacie);
    journaliser('statut_pharmacie', p.id, { nom: p.nom, avant: p.statut, apres: nouveau });
    p.statut = nouveau;
  },

  definir_horaires: ({ pharmacie, plages }) => {
    db.horaires = db.horaires.filter((h) => h.pharmacie_id !== pharmacie);
    plages.forEach((p) => db.horaires.push({ id: uid(), pharmacie_id: pharmacie, ...p }));
    return plages.length;
  },

  importer_pharmacies: ({ lignes, simulation, activer = true }) => {
    const erreurs = [];
    const valides = [];
    for (const l of lignes) {
      const commune = COMMUNES[norm(l.commune)];
      const motifs = [];
      if (String(l.nom ?? '').trim().length < 2) motifs.push('nom manquant');
      if (!commune) motifs.push('commune inconnue (Libreville, Akanda ou Owendo)');
      if (motifs.length) { erreurs.push({ ligne: l.ligne, nom: l.nom, motifs }); continue; }
      const existe = db.pharmacies.find((p) => norm(p.nom) === norm(l.nom) && p.commune === commune);
      valides.push({ l, commune, existe });
    }
    if (!simulation) {
      for (const { l, commune, existe } of valides) {
        const champs = {
          nom: l.nom.trim(), commune, quartier: l.quartier || null, adresse: l.adresse || null, telephone: l.telephone || null,
          latitude: l.latitude ? Number(String(l.latitude).replace(',', '.')) : null,
          longitude: l.longitude ? Number(String(l.longitude).replace(',', '.')) : null,
          accepte_cnamgs: ['oui', 'o', 'x', '1'].includes(norm(l.cnamgs)),
        };
        if (existe) Object.assign(existe, champs);
        else db.pharmacies.push({ id: uid(), statut: activer ? 'active' : 'en_attente', mutuelles: [], services: [], ...champs });
      }
      journaliser('import_pharmacies', 'pharmacies', { lignes: lignes.length, importees: valides.length });
    }
    const nouvelles = valides.filter((v) => !v.existe).length;
    return { simulation, nb_lignes: lignes.length, nb_valides: valides.length, nb_erreurs: erreurs.length, nouvelles, mises_a_jour: valides.length - nouvelles, erreurs };
  },

  ajouter_garde: ({ pharmacie, debut_garde, fin_garde }) => {
    const g = { id: uid(), pharmacie_id: pharmacie, debut: debut_garde, fin: fin_garde, source: 'admin', validee: true };
    db.gardes.push(g);
    return g.id;
  },

  importer_gardes: ({ lignes, simulation }) => {
    const erreurs = [];
    const valides = [];
    for (const l of lignes) {
      const commune = COMMUNES[norm(l.commune)];
      let candidats = db.pharmacies.filter((p) => norm(p.nom) === norm(l.pharmacie) && (!commune || p.commune === commune));
      if (!candidats.length && norm(l.pharmacie).length >= 4) {
        candidats = db.pharmacies.filter((p) => norm(p.nom).includes(norm(l.pharmacie)) && (!commune || p.commune === commune));
      }
      if (candidats.length !== 1) {
        erreurs.push({ ligne: l.ligne, pharmacie: l.pharmacie, motifs: [candidats.length ? 'plusieurs pharmacies correspondent' : 'pharmacie introuvable'] });
        continue;
      }
      const iso = (local) => new Date(`${local}:00+01:00`).toISOString();
      valides.push({ ligne: l.ligne, pharmacie_id: candidats[0].id, pharmacie: candidats[0].nom, debut: iso(l.debut), fin: iso(l.fin) });
    }
    if (!simulation) {
      valides.forEach((v) => db.gardes.push({ id: uid(), pharmacie_id: v.pharmacie_id, debut: v.debut, fin: v.fin, source: 'admin', validee: true }));
      journaliser('import_gardes', 'gardes', { lignes: lignes.length, importees: valides.length });
    }
    return { simulation, nb_lignes: lignes.length, nb_valides: valides.length, nb_erreurs: erreurs.length, deja_presentes: 0, valides, erreurs };
  },

  importer_medicaments: ({ lignes, simulation }) => {
    const erreurs = [];
    const valides = lignes.filter((l) => {
      if (String(l.nom_commercial ?? '').trim().length < 2) {
        erreurs.push({ ligne: l.ligne, nom: l.nom_commercial, motifs: ['nom commercial manquant'] });
        return false;
      }
      return true;
    });
    const existe = (l) => db.medicaments.find((m) => norm(m.nom_commercial) === norm(l.nom_commercial) && norm(m.dosage) === norm(l.dosage) && norm(m.forme) === norm(l.forme));
    const nouveaux = valides.filter((l) => !existe(l)).length;
    if (!simulation) {
      for (const l of valides) {
        const syn = String(l.synonymes ?? '').split(/[;|]/).map((s) => s.trim()).filter(Boolean);
        const m = existe(l);
        if (m) m.synonymes = [...new Set([...m.synonymes, ...syn])];
        else db.medicaments.push({ id: uid(), nom_commercial: l.nom_commercial, molecule: l.molecule || null, dosage: l.dosage || null, forme: l.forme || null, synonymes: syn, actif: true });
      }
    }
    return { simulation, nb_lignes: lignes.length, nb_valides: valides.length, nb_erreurs: erreurs.length, nouveaux, completes: valides.length - nouveaux, erreurs };
  },

  fusionner_medicaments: ({ doublon, garde }) => {
    const d = db.medicaments.find((m) => m.id === doublon);
    const g = db.medicaments.find((m) => m.id === garde);
    g.synonymes = [...new Set([...g.synonymes, ...d.synonymes, d.nom_commercial])].filter((s) => norm(s) !== norm(g.nom_commercial));
    db.medicaments = db.medicaments.filter((m) => m.id !== doublon);
    journaliser('fusion_medicaments', garde, d);
  },
};

// ---------------------------------------------------------------- Client

export function createClient() {
  const cle = 'faux-session';
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(cle)); } catch { /* vide */ }
  const abonnes = [];
  const emettre = (evt) => abonnes.forEach((f) => f(evt, session));
  let emailEnAttente = null;

  return {
    auth: {
      async getSession() { return { data: { session } }; },
      onAuthStateChange(f) { abonnes.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOtp({ email }) {
        globalThis.__dernierOtp = { email };
        emailEnAttente = email;
        if (!db.utilisateurs.some((u) => u.email === email)) db.utilisateurs.push({ id: uid(), email, role: 'patient' });
        return { error: null };
      },
      async verifyOtp({ email, token }) {
        if (token !== '123456' || email !== emailEnAttente) return { error: { message: 'Token has expired or is invalid' } };
        const u = db.utilisateurs.find((x) => x.email === email);
        session = { user: { id: u.id, email } };
        sessionStorage.setItem(cle, JSON.stringify(session));
        emettre('SIGNED_IN');
        return { data: { session }, error: null };
      },
      async signOut() { session = null; sessionStorage.removeItem(cle); emettre('SIGNED_OUT'); return { error: null }; },
    },
    from: requete,
    async rpc(nom, args) {
      const u = session && db.utilisateurs.find((x) => x.id === session.user.id);
      if (!u || u.role !== 'admin') return { data: null, error: { code: '42501', message: 'Réservé aux administrateurs' } };
      try { return { data: fonctions[nom](args ?? {}), error: null }; }
      catch (e) { return { data: null, error: { message: e.message } }; }
    },
  };
}
