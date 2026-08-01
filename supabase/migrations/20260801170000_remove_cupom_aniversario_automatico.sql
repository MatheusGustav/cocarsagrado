-- ============================================================
-- CUPOM DE ANIVERSÁRIO AUTOMÁTICO — DESLIGADO (2026-08-01)
--
-- Matheus e Camila passam a dar o cupom manualmente. O gerador
-- diário morre aqui (nunca teve efeito real: 0 perfis e 0 cupons
-- NIVER% no banco na data do corte).
--
-- O fluxo de e-mail (emails_pendentes + emails-cron) continua
-- tratando códigos NIVER% — template de parabéns e janela 9h–20h —
-- para cupons criados à mão com esse prefixo.
-- ============================================================

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cupons-aniversario') THEN
    PERFORM cron.unschedule('cupons-aniversario');
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.gerar_cupons_aniversario();
