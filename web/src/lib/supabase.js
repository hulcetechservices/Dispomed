import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Message lisible pour une erreur Supabase ou Postgres. */
export function messageErreur(erreur) {
  if (!erreur) return '';
  const m = erreur.message || String(erreur);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Pas de connexion au serveur. Vérifiez internet puis réessayez.';
  if (/rate limit|too many/i.test(m)) return 'Trop de demandes en peu de temps. Patientez une minute puis réessayez.';
  if (/Token has expired|invalid.*otp|otp.*invalid/i.test(m)) return 'Code incorrect ou expiré. Demandez un nouveau code.';
  if (/Signups not allowed/i.test(m)) return "Cette adresse n'a pas de compte.";
  if (erreur.code === '42501') return "Action refusée : votre compte n'y a pas accès.";
  if (erreur.code === '23505') return 'Cet élément existe déjà.';
  if (erreur.code === '23514') return 'Une valeur saisie est hors des limites autorisées.';
  return m;
}

/** Appel RPC qui lève une erreur lisible. */
export async function rpc(fonction, args) {
  const { data, error } = await supabase.rpc(fonction, args);
  if (error) throw new Error(messageErreur(error));
  return data;
}
