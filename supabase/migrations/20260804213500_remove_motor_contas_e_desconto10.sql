-- ============================================================
-- Remove o motor de contas/cupons pessoais/e-mails (morto desde
-- que o login de cliente saiu do front em 19/07) e os restos do
-- desconto de 10% de novo cliente (descontinuado em 10/06).
--
-- FICA de pé (usado pelo checkout/entrega vivos):
--   - cron audio-email-cron (entrega de áudio comprado)
--   - tabela perfis (vazia, mas criar_pedido/complemento citam)
--   - colunas cupons.user_id/expira_em (validar_cupom/criar_pedido citam)
--   - email_eventos + resend-webhook (rastreio dos e-mails de áudio)
--   - termos_aceites (fluxo aceite.html em uso)
-- ============================================================

-- 1. Desliga os robôs do motor (idempotente)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('emails-cron', 'limpar-contas-fantasma');

-- 2. Funções do motor de contas/cupom pessoal
DROP FUNCTION IF EXISTS public.emails_pendentes;
DROP FUNCTION IF EXISTS public.meus_cupons;
DROP FUNCTION IF EXISTS public.reivindicar_pedidos;
DROP FUNCTION IF EXISTS public.admin_user_por_email;
DROP FUNCTION IF EXISTS public.limpar_contas_fantasma;

-- 3. Log/idempotência dos e-mails promocionais (só emails_pendentes usava)
DROP TABLE IF EXISTS public.emails_enviados;

-- 4. Restos do 10% de novo cliente (nenhuma função viva referencia)
ALTER TABLE public.pedidos      DROP COLUMN IF EXISTS aceitou_desconto_10;
ALTER TABLE public.agendamentos DROP COLUMN IF EXISTS aceitou_desconto_10;
