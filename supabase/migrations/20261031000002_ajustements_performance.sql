-- Ajustements après les contrôles Supabase (advisors).
--
-- Laissés tels quels, volontairement :
-- * public.disponibilites est une vue « security definer » : elle lit le stock
--   de toutes les officines pour n'en exposer que les champs prévus (spec §9).
--   L'alternative « security invoker » imposerait d'ouvrir la table stocks,
--   quantités comprises, à tous les comptes connectés.
-- * importer_stock, confirmer_stock et mon_officine sont « security definer » et
--   appelables par les comptes connectés : elles déduisent elles-mêmes l'officine.

-- Index sur la clé étrangère de l'auteur d'un import.
create index if not exists imports_stock_cree_par_idx on public.imports_stock (cree_par);

-- Évaluer l'identité une seule fois par requête, pas à chaque ligne.
alter policy pharmaciens_lecture on public.pharmaciens
  using (user_id = (select auth.uid()));

alter policy officines_lecture on public.officines
  using (id = (select public.mon_officine()));
alter policy officines_modification on public.officines
  using (id = (select public.mon_officine()))
  with check (id = (select public.mon_officine()));

alter policy produits_lecture on public.produits
  using ((select public.mon_officine()) is not null);

alter policy stocks_lecture on public.stocks
  using (officine_id = (select public.mon_officine()));
alter policy stocks_ajout on public.stocks
  with check (officine_id = (select public.mon_officine()));
alter policy stocks_modification on public.stocks
  using (officine_id = (select public.mon_officine()))
  with check (officine_id = (select public.mon_officine()));
alter policy stocks_suppression on public.stocks
  using (officine_id = (select public.mon_officine()));

alter policy imports_lecture on public.imports_stock
  using (officine_id = (select public.mon_officine()));

comment on view public.disponibilites is
  'Vue publique volontairement security definer : expose seulement les champs prévus (spec §9), sans quantité exacte.';
