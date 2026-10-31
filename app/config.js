// Configuration publique du client Supabase.
// La clé « publishable » (anon) est faite pour être exposée au navigateur :
// la sécurité repose sur les règles RLS de la base, pas sur ce secret.
// Ne mettez JAMAIS la clé service_role ici.
export const SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
export const SUPABASE_ANON_KEY = 'VOTRE_CLE_PUBLISHABLE';
