-- Les fonctions de déclencheur n'ont pas à être appelables par l'API :
-- un déclencheur s'exécute sans droit EXECUTE de l'utilisateur.
-- Restent volontairement appelables : les fonctions d'administration (elles
-- vérifient est_admin()) et chercher_medicaments (recherche patient publique).
revoke all on function public.creer_profil() from public, anon, authenticated;
revoke all on function public.journaliser_suppression() from public, anon, authenticated;
revoke all on function public.pharmacies_modifiee() from public, anon, authenticated;
