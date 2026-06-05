-- ============================================================
-- Higiene de segurança (advisors): remove EXECUTE público de
-- funções internas que não devem ser endpoints REST.
--
-- 1) Funções de trigger: o Postgres só checa EXECUTE na criação
--    do trigger, não no disparo — revogar tudo é seguro e tira
--    os endpoints /rest/v1/rpc/* inúteis.
-- 2) is_admin(): usada nas policies RLS de authenticated (a
--    policy roda como o role consultante, então authenticated
--    mantém EXECUTE). anon não usa em nenhuma policy.
-- ============================================================

-- Funções de trigger (nunca chamadas via RPC)
REVOKE ALL ON FUNCTION public.decrementar_vaga_especial_trigger()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_vaga_normal_trigger()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_desconto_primeiro_cliente()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column()             FROM PUBLIC, anon, authenticated;

-- is_admin(): só authenticated (policies RLS) precisa executar
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
