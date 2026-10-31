-- Ajustements après les contrôles de performance de Supabase.

-- Les règles « admin » couvraient aussi la lecture, déjà couverte par la règle
-- de lecture : deux règles évaluées à chaque requête. On les limite à l'écriture.
drop policy horaires_admin on public.horaires;
create policy horaires_admin_ajout on public.horaires for insert to authenticated with check ((select public.est_admin()));
create policy horaires_admin_modif on public.horaires for update to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));
create policy horaires_admin_suppr on public.horaires for delete to authenticated using ((select public.est_admin()));

drop policy gardes_admin on public.gardes;
create policy gardes_admin_ajout on public.gardes for insert to authenticated with check ((select public.est_admin()));
create policy gardes_admin_modif on public.gardes for update to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));
create policy gardes_admin_suppr on public.gardes for delete to authenticated using ((select public.est_admin()));

drop policy medicaments_admin on public.medicaments;
create policy medicaments_admin_ajout on public.medicaments for insert to authenticated with check ((select public.est_admin()));
create policy medicaments_admin_modif on public.medicaments for update to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));
create policy medicaments_admin_suppr on public.medicaments for delete to authenticated using ((select public.est_admin()));

create index if not exists gardes_cree_par_idx on public.gardes (cree_par);
create index if not exists journal_auteur_idx on public.journal (auteur);
