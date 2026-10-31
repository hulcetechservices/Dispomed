import { useState } from 'react';
import { supabase, messageErreur } from '../lib/supabase.js';
import { Croix } from '../Croix.jsx';

// Connexion sans mot de passe (cahier des charges, section 10) : un e-mail
// contenant un lien de connexion, et un code si le modèle d'e-mail l'affiche.
export default function Connexion() {
  const [email, setEmail] = useState('');
  const [etape, setEtape] = useState('email');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const demander = async (e) => {
    e.preventDefault();
    const adresse = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(adresse)) { setErreur('Saisissez une adresse e-mail valide.'); return; }
    setErreur(''); setEnvoi(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: adresse,
      options: { emailRedirectTo: `${location.origin}/admin` },
    });
    setEnvoi(false);
    if (error) setErreur(messageErreur(error));
    else { setEmail(adresse); setEtape('code'); }
  };

  const verifier = async (e) => {
    e.preventDefault();
    const jeton = code.replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(jeton)) { setErreur('Le code compte 6 chiffres.'); return; }
    setErreur(''); setEnvoi(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: jeton, type: 'email' });
    setEnvoi(false);
    if (error) setErreur(messageErreur(error));
  };

  return (
    <div className="ecran-centre">
      {etape === 'email' ? (
        <form className="carte-connexion" onSubmit={demander} noValidate>
          <div className="marque"><Croix /> Back-office</div>
          <p className="discret">Réservé à l'équipe HULCE TECH. Pas de mot de passe : vous recevez un lien de connexion par e-mail.</p>
          <label className="champ">Adresse e-mail
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {erreur && <p className="erreur" role="alert">{erreur}</p>}
          <button type="submit" disabled={envoi}>{envoi ? 'Envoi…' : 'Recevoir le lien de connexion'}</button>
        </form>
      ) : (
        <form className="carte-connexion" onSubmit={verifier} noValidate>
          <div className="marque"><Croix /> Vérifiez vos e-mails</div>
          <p>Un e-mail a été envoyé à <b>{email}</b>. Ouvrez le lien qu'il contient sur cet appareil.</p>
          <p className="discret">Si l'e-mail contient un code à 6 chiffres, vous pouvez aussi le saisir ici.</p>
          <label className="champ">Code reçu
            <input className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
              value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          {erreur && <p className="erreur" role="alert">{erreur}</p>}
          <button type="submit" disabled={envoi}>{envoi ? 'Vérification…' : 'Me connecter'}</button>
          <button type="button" className="discret-btn" onClick={() => { setEtape('email'); setCode(''); setErreur(''); }}>
            Changer d'adresse ou renvoyer l'e-mail
          </button>
        </form>
      )}
    </div>
  );
}
