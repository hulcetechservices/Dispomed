-- Retire le schéma du premier prototype (données de démonstration uniquement,
-- aucun compte), remplacé par la migration semaine 1. Sans effet sur une base neuve.
-- Les espaces de stockage « cni » et « ordonnances » sont conservés pour la semaine 2.

drop table if exists public.sanctions cascade;
drop table if exists public.demandes cascade;
drop table if exists public.patients cascade;
drop table if exists public.pharmacien_officine cascade;
drop table if exists public.stocks cascade;
drop table if exists public.produits cascade;
drop table if exists public.officines cascade;

drop function if exists public.appliquer_non_retrait() cascade;
drop function if exists public.creer_officine(text, text, text, text) cascade;
drop function if exists public.mon_officine() cascade;

drop type if exists public.monnaie_niveau cascade;
drop type if exists public.statut_patient cascade;
drop type if exists public.type_demande cascade;
drop type if exists public.statut_demande cascade;
