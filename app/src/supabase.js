import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const configure = !SUPABASE_URL.includes('VOTRE-PROJET');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Message lisible à partir d'une erreur Supabase / Postgres. */
export function messageErreur(erreur) {
  if (!erreur) return '';
  const m = erreur.message || String(erreur);
  if (/Invalid login credentials/i.test(m)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(m)) return "Adresse e-mail pas encore confirmée. Ouvrez le lien reçu par e-mail.";
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion au serveur. Vérifiez internet puis réessayez.';
  if (erreur.code === '42501') return "Action refusée : votre compte n'a pas accès à cette officine.";
  return m;
}
