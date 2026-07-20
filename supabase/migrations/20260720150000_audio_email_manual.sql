-- E-mail do áudio deixa de ser automático: salvar só salva; a admin
-- dispara o envio no botão ✉️ do painel (aba "Áudios salvos").
-- email_liberado_em NULL = admin ainda não pediu o envio — a edge
-- audio-email (chamada direta E cron) ignora esses.

ALTER TABLE public.audios_cliente ADD COLUMN email_liberado_em TIMESTAMPTZ;

-- Coerência do histórico: o que já foi enviado conta como liberado
UPDATE public.audios_cliente
SET email_liberado_em = enviado_email_em
WHERE enviado_email_em IS NOT NULL;

-- Fila do cron agora é "liberado e ainda não enviado"
DROP INDEX IF EXISTS idx_audios_email_pendente;
CREATE INDEX idx_audios_email_pendente ON public.audios_cliente (id)
  WHERE enviado_email_em IS NULL AND email_liberado_em IS NOT NULL;
