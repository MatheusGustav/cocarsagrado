-- ============================================================
-- Entrega do áudio por E-MAIL
-- ------------------------------------------------------------
-- Decisão 2026-07-19: o trâmite de conta morre pro cliente —
-- o e-mail com o áudio anexado VIRA o histórico dele.
--
-- Fluxo: admin grava o áudio → painel chama a edge function
-- audio-email na hora (JWT admin); um cron a cada 10 min varre
-- os pendentes (falha de rede, painel fechado etc. — mesmo gate
-- x-cron-secret do emails-cron). Anexo até ~24MB; maior que isso
-- o e-mail vai com botão de link assinado (90 dias).
-- ============================================================

ALTER TABLE public.audios_cliente
  ADD COLUMN enviado_email_em TIMESTAMPTZ;

-- Fila do cron: só os ainda não enviados.
CREATE INDEX idx_audios_email_pendente
  ON public.audios_cliente (id)
  WHERE enviado_email_em IS NULL;

-- Cron de varredura (reusa o secret 'cron_emails_secret' do Vault).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audio-email-cron') THEN
    PERFORM cron.unschedule('audio-email-cron');
  END IF;
  PERFORM cron.schedule(
    'audio-email-cron',
    '*/10 * * * *',
    $job$
    SELECT net.http_post(
      url     := 'https://demxedudbislzausvhwx.supabase.co/functions/v1/audio-email',
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
