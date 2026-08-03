-- ============================================================
-- termos_aceites: revoga os GRANTs default do anon.
--
-- Com RLS sem policy o anon já não via nada (SELECT = 0 linhas),
-- mas o padrão da casa é lockdown explícito: anon não tem GRANT
-- nenhum na tabela — todo acesso do cliente passa pelas RPCs
-- aceite_info/aceitar_termos_link (SECURITY DEFINER + token).
-- authenticated mantém o GRANT: o painel usa via policy is_admin().
-- ============================================================

REVOKE ALL ON public.termos_aceites FROM anon;
