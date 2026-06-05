-- ============================================================
-- Segurança: revoga execução pública das funções de vagas.
-- incrementar_vagas_restantes: só o painel admin (authenticated)
-- usa — a RLS da tabela já restringe a escrita ao is_admin().
-- decrementar_vagas_restantes: não é mais usada em lugar nenhum
-- (o decremento é feito pelo trigger trg_decrementar_vaga_especial)
-- → removida.
-- ============================================================

REVOKE ALL ON FUNCTION public.incrementar_vagas_restantes(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.incrementar_vagas_restantes(text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.incrementar_vagas_restantes(text, date) TO authenticated;

DROP FUNCTION IF EXISTS public.decrementar_vagas_restantes(text, date);
