import { useEffect, useState } from 'react';
import { supabase, messageErreur } from '../lib/supabase.js';
import { Croix } from '../Accueil.jsx';
import { FournisseurNotif } from './ui.jsx';
import Connexion from './Connexion.jsx';
import Pharmacies from './Pharmacies.jsx';
import Gardes from './Gardes.jsx';
import Medicaments from './Medicaments.jsx';
import Journal from './Journal.jsx';

const ONGLETS = [
  { id: 'pharmacies', libelle: 'Pharmacies', Vue: Pharmacies },
  { id: 'gardes', libelle: 'Gardes', Vue: Gardes },
  { id: 'medicaments', libelle: 'Médicaments', Vue: Medicaments },
  { id: 'journal', libelle: 'Journal', Vue: Journal },
];

const ongletDepuisAdresse = () =>
  ONGLETS.find((o) => location.pathname.startsWith(`/admin/${o.id}`)) ?? ONGLETS[0];

export default function AdminApp() {
  const [session, setSession] = useState(undefined);
  const [profil, setProfil] = useState(undefined);
  const [erreur, setErreur] = useState('');
  const [onglet, setOnglet] = useState(ongletDepuisAdresse);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const retour = () => setOnglet(ongletDepuisAdresse());
    window.addEventListener('popstate', retour);
    return () => { data.subscription.unsubscribe(); window.removeEventListener('popstate', retour); };
  }, []);

  useEffect(() => {
    if (!session) { setProfil(session === null ? null : undefined); return; }
    let annule = false;
    supabase.from('utilisateurs').select('role, email, nom').eq('id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (annule) return;
        if (error) setErreur(messageErreur(error));
        setProfil(data ?? null);
      });
    return () => { annule = true; };
  }, [session]);

  const aller = (o) => {
    setOnglet(o);
    history.pushState(null, '', `/admin/${o.id}`);
  };

  if (session === undefined || (session && profil === undefined)) {
    return <p className="chargement">Chargement…</p>;
  }

  if (!session) {
    return <FournisseurNotif><Connexion /></FournisseurNotif>;
  }

  if (profil?.role !== 'admin') {
    return (
      <div className="ecran-centre">
        <div className="carte-connexion">
          <div className="marque"><Croix /> Accès réservé</div>
          <p>
            Le compte {session.user.email} n'a pas accès au back-office.
            Il est réservé à l'équipe HULCE TECH.
          </p>
          {erreur && <p className="erreur">{erreur}</p>}
          <button type="button" className="secondaire" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
        </div>
      </div>
    );
  }

  const { Vue } = onglet;
  return (
    <FournisseurNotif>
      <header className="entete">
        <div className="marque"><Croix taille={26} /> Back-office <small>Pharmacies Gabon</small></div>
        <div className="compte">
          <span>{profil.email}</span>
          <button type="button" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
        </div>
      </header>
      <nav className="onglets" aria-label="Sections du back-office">
        {ONGLETS.map((o) => (
          <a key={o.id} href={`/admin/${o.id}`} aria-current={o.id === onglet.id ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); aller(o); }}>
            {o.libelle}
          </a>
        ))}
      </nav>
      <main className="contenu"><Vue /></main>
    </FournisseurNotif>
  );
}
