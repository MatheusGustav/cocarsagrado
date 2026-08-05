-- ============================================================
-- Liga o robô do lembrete de recompra
-- ------------------------------------------------------------
-- Separado da migration anterior de propósito: aquela só monta as
-- peças (não dispara nada) e esta é o interruptor. Aplicar isto
-- SIGNIFICA COMEÇAR A MANDAR E-MAIL PRA CLIENTE DE VERDADE — e
-- e-mail enviado não volta atrás.
--
-- No dia em que foi escrita, a fila tinha 16 pessoas (leituras de
-- 19 a 24/07), todas dormentes entre 12 e 17 dias. O primeiro tick
-- manda pra essas 16 de uma vez; depois disso vira gotejamento, uma
-- pessoa por vez, conforme cada uma completa 10 dias.
--
-- A trava de reenvio é emails_enviados (UNIQUE tipo+ref): cada
-- leitura gera no máximo um lembrete, pra sempre.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-cron') THEN
    PERFORM cron.unschedule('emails-cron');
  END IF;
  PERFORM cron.schedule(
    'emails-cron',
    '*/15 * * * *',
    $job$
    SELECT net.http_post(
      url     := 'https://demxedudbislzausvhwx.supabase.co/functions/v1/emails-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_emails_secret')
      ),
      body    := '{}'::jsonb
    );
    $job$
  );
END
$do$;
