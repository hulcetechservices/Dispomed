// Faux client Supabase en mémoire, servi à la place du CDN pendant les tests
// de navigation. Il reproduit juste ce que l'interface utilise.

const heures = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const db = {
  pharmaciens: [{ nom: 'Dr Mboumba', role: 'titulaire', verifie: true, officine_id: 'o1' }],
  officines: [{
    id: 'o1', nom: 'Pharmacie de l\'Estuaire', adresse: 'Boulevard Triomphal', quartier: 'Glass',
    ville: 'Libreville', telephone: '+241 01 23 45 67', horaires: null,
    monnaies: ['XAF'], moyens_paiement: ['especes', 'airtel_money'], de_garde: false,
  }],
  stocks: [
    ['p1', 'PARA500', 'Paracétamol 500 mg, boîte de 16', 40, 10, 1500, 2],
    ['p2', 'AMOX500', 'Amoxicilline 500 mg, boîte de 12', 3, 5, 3200, 20],
    ['p3', 'ARTE20', 'Artéméther-luméfantrine 20/120 mg, boîte de 24', 8, 5, 4500, 60],
    ['p4', 'SRO', 'Sels de réhydratation orale, sachet', 0, 20, 250, 1],
    ['p5', 'IBU400', 'Ibuprofène 400 mg, boîte de 30', 22, 10, 1800, 30],
    ['p6', 'METRO250', 'Métronidazole 250 mg, boîte de 20', 15, 5, null, 0.3],
  ].map(([produit_id, code, nom, quantite, seuil_alerte, prix, h]) =>
    ({ produit_id, code, nom, quantite, seuil_alerte, prix, confirme_le: heures(h) })),
  imports_stock: [],
};

const fraicheur = (d) => {
  const h = (Date.now() - new Date(d)) / 3600e3;
  return h < 12 ? 'recent' : h < 48 ? 'non_recent' : 'a_confirmer';
};

const vues = {
  mon_stock: () => db.stocks.map((s) => ({
    ...s, en_alerte: s.quantite <= s.seuil_alerte, fraicheur: fraicheur(s.confirme_le),
  })),
  a_reapprovisionner: () => vues.mon_stock().filter((s) => s.en_alerte).map((s) => ({
    ...s, quantite_suggeree: Math.max(s.seuil_alerte * 2 - s.quantite, 0),
  })),
};

const lire = (table) => (vues[table] ? vues[table]() : db[table]).map((x) => ({ ...x }));

function requete(table) {
  let lignes = null;
  let patch = null;
  const filtres = [];
  const tris = [];
  let unique = false;
  let tete = false;
  let limite = Infinity;

  const executer = () => {
    if (patch) {
      const cible = db[table].filter((r) => filtres.every(([c, v]) => r[c] === v));
      cible.forEach((r) => {
        Object.assign(r, patch);
        if (table === 'stocks' && 'quantite' in patch) r.confirme_le = new Date().toISOString();
      });
      lignes = cible.map((x) => ({ ...x }));
    } else {
      lignes = lire(table).filter((r) => filtres.every(([c, v]) => r[c] === v));
      for (const [c, asc] of [...tris].reverse()) {
        lignes.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      }
      lignes = lignes.slice(0, limite);
    }
    if (tete) return { data: null, count: lignes.length, error: null };
    if (unique) return { data: lignes[0] ?? null, error: null };
    return { data: lignes, count: lignes.length, error: null };
  };

  const q = {
    select(_c, opts = {}) { tete = !!opts.head; return q; },
    eq(c, v) { filtres.push([c, v]); return q; },
    order(c, opts = {}) { tris.push([c, opts.ascending !== false]); return q; },
    limit(n) { limite = n; return q; },
    update(p) { patch = p; return q; },
    single() { unique = true; return q; },
    maybeSingle() { unique = true; return q; },
    then(ok, ko) { return Promise.resolve(executer()).then(ok, ko); },
  };
  return q;
}

function importer({ lignes, mode, simulation, fichier }) {
  const erreurs = [];
  const valides = [];
  const vus = new Set();
  for (const l of lignes) {
    const motifs = [];
    if (!l.code) motifs.push('code produit manquant');
    else if (vus.has(l.code)) motifs.push('code en double dans le fichier');
    if (!/^\d+$/.test(String(l.quantite).replace(/\s/g, ''))) motifs.push('quantité invalide (entier positif attendu)');
    const connu = db.stocks.some((s) => s.code === l.code);
    if (l.code && !connu && !l.nom) motifs.push('produit inconnu : le nom est obligatoire');
    if (motifs.length) erreurs.push({ ligne: l.ligne, code: l.code || null, motifs });
    else { vus.add(l.code); valides.push(l); }
  }
  const nouveaux = valides.filter((l) => !db.stocks.some((s) => s.code === l.code)).length;
  const absents = db.stocks.filter((s) => s.quantite > 0 && !vus.has(s.code));
  if (!simulation) {
    for (const l of valides) {
      let s = db.stocks.find((x) => x.code === l.code);
      if (!s) { s = { produit_id: 'n' + l.code, code: l.code, nom: l.nom, seuil_alerte: 5, prix: null }; db.stocks.push(s); }
      s.quantite = Number(String(l.quantite).replace(/\s/g, ''));
      if (l.prix) s.prix = Number(String(l.prix).replace(/\s/g, '').replace(',', '.'));
      s.confirme_le = new Date().toISOString();
    }
    if (mode === 'remplacement') absents.forEach((s) => { s.quantite = 0; s.confirme_le = new Date().toISOString(); });
    db.imports_stock.push({ fichier, mode, nb_lignes: lignes.length, nb_importees: valides.length, nb_erreurs: erreurs.length, cree_le: new Date().toISOString() });
  }
  return {
    simulation, mode, nb_lignes: lignes.length, nb_valides: valides.length, nb_erreurs: erreurs.length,
    nouveaux_produits: nouveaux, mis_a_zero: mode === 'remplacement' ? absents.length : 0, erreurs,
  };
}

export function createClient() {
  let session = null;
  const abonnes = [];
  const emettre = (e) => abonnes.forEach((f) => f(e, session));
  return {
    auth: {
      async getSession() { return { data: { session } }; },
      onAuthStateChange(f) { abonnes.push(f); setTimeout(() => f('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) {
        if (password !== 'motdepasse-test') return { error: { message: 'Invalid login credentials' } };
        session = { user: { id: 'u1', email } };
        emettre('SIGNED_IN');
        return { data: { session }, error: null };
      },
      async signOut() { session = null; emettre('SIGNED_OUT'); return { error: null }; },
      async resetPasswordForEmail() { return { error: null }; },
      async updateUser() { return { error: null }; },
    },
    from: requete,
    async rpc(nom, args) {
      if (nom === 'importer_stock') return { data: importer(args), error: null };
      if (nom === 'confirmer_stock') {
        let n = 0;
        db.stocks.forEach((s) => { if (args.produits.includes(s.produit_id)) { s.confirme_le = new Date().toISOString(); n++; } });
        return { data: n, error: null };
      }
      return { data: null, error: { message: 'rpc inconnue' } };
    },
  };
}
