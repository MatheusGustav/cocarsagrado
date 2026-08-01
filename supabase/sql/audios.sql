-- ============================================================
-- ÁUDIOS DAS LEITURAS — estado atual no banco
-- (espelho das migrations 20260708120000_audios_cliente.sql
--  + 20260719120000_reivindicar_audios.sql
--  + 20260719150000_audio_email.sql
--  + 20260720150000_audio_email_manual.sql
--  + 20260731120000_resend_prova_entrega.sql)
-- ------------------------------------------------------------
-- ENTREGA OFICIAL (2026-07-19, manual desde 2026-07-20): E-MAIL
-- COM ANEXO. Admin grava na aba "Áudios" do painel → bucket privado
-- "audios" + linha em audios_cliente. Salvar NÃO envia: a admin
-- dispara no ✉️ da aba "Áudios salvos" (seta email_liberado_em e
-- chama a edge audio-email com JWT admin). O cron 'audio-email-cron'
-- (*/10 min, gate x-cron-secret) só re-tenta LIBERADOS que falharam.
-- Anexo até ~24MB; maior vai como link assinado de 90 dias. Só envia
-- com pedido pago e e-mail presente; enviado_email_em marca o envio.
-- Se agendamentos.documento_pdf_path existir, o PDF do documento vai
-- ANEXADO no mesmo e-mail (bucket "documentos", abaixo).
--
-- LEGADO (conta no site morreu pro cliente em 2026-07-19, entrada
-- da UI removida): user_id snapshot no INSERT (trigger), adoção
-- via reivindicar_pedidos() (setup.sql), meus_audios() e policies
-- de dono continuam no banco — inofensivos e prontos se a conta
-- um dia voltar.
-- enviado_whatsapp_em: reservado para envio por WhatsApp futuro.
-- ============================================================

-- Tabela ---------------------------------------------------------------
CREATE TABLE public.audios_cliente (
  id                  BIGSERIAL PRIMARY KEY,
  agendamento_id      BIGINT NOT NULL REFERENCES public.agendamentos(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL = guest
  storage_path        TEXT NOT NULL UNIQUE,
  duracao_segundos    INTEGER,
  tamanho_bytes       BIGINT,
  mime                TEXT NOT NULL DEFAULT 'audio/webm',
  enviado_whatsapp_em TIMESTAMPTZ,
  enviado_email_em    TIMESTAMPTZ,  -- NULL = ainda não foi por e-mail (só "o Resend aceitou")
  email_liberado_em   TIMESTAMPTZ,  -- NULL = admin não pediu envio (✉️); edge/cron ignoram
  resend_id           TEXT,         -- id do e-mail no Resend; casa com email_eventos
  entregue_em         TIMESTAMPTZ,  -- aviso assinado do Resend: CHEGOU
  quicou_em           TIMESTAMPTZ,  -- aviso assinado do Resend: NÃO chegou (bounce)
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audios_agendamento ON public.audios_cliente (agendamento_id);
CREATE INDEX idx_audios_user ON public.audios_cliente (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audios_email_pendente ON public.audios_cliente (id)
  WHERE enviado_email_em IS NULL AND email_liberado_em IS NOT NULL;
CREATE INDEX idx_audios_resend ON public.audios_cliente (resend_id) WHERE resend_id IS NOT NULL;

-- entregue_em/quicou_em NÃO são escritos pelo painel: quem preenche é o
-- trigger de email_eventos (setup.sql), quando o aviso assinado do Resend
-- chega na edge resend-webhook. Reenvio zera os dois (veredito do envio
-- anterior morre; o histórico fica em email_eventos).

-- Trigger: resolve user_id no banco (front não manda) --------------------
CREATE OR REPLACE FUNCTION public.audio_seta_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT p.user_id INTO NEW.user_id
  FROM public.agendamentos a
  JOIN public.pedidos p ON p.id = a.pedido_id
  WHERE a.id = NEW.agendamento_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audio_user_id
  BEFORE INSERT ON public.audios_cliente
  FOR EACH ROW EXECUTE FUNCTION public.audio_seta_user_id();

REVOKE ALL ON FUNCTION public.audio_seta_user_id() FROM PUBLIC, anon, authenticated;

-- RLS --------------------------------------------------------------------
ALTER TABLE public.audios_cliente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audios_cliente FROM anon;

CREATE POLICY "auth_admin_audios" ON public.audios_cliente
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "audios_select_own" ON public.audios_cliente
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Bucket privado "audios" -------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('audios', 'audios', false, 52428800,
        ARRAY['audio/webm','audio/mp4','audio/mpeg','audio/ogg']);

-- Bucket privado "documentos" (migration 20260801190000) -------------------
-- PDF do documento do cliente (documento-verde.html rasterizado no painel;
-- path agendamento-<id>/documento.pdf, upsert ao regerar). A edge
-- audio-email ANEXA o PDF junto do áudio no mesmo e-mail quando
-- agendamentos.documento_pdf_path está preenchido; o compartilhar do
-- painel (WhatsApp) também leva os dois. Só admin acessa (UPDATE existe
-- por causa do upsert).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documentos', 'documentos', false, 20971520, ARRAY['application/pdf']);

CREATE POLICY "documentos_insert_admin" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'documentos' AND public.is_admin());
CREATE POLICY "documentos_update_admin" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'documentos' AND public.is_admin())
  WITH CHECK (bucket_id = 'documentos' AND public.is_admin());
CREATE POLICY "documentos_delete_admin" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'documentos' AND public.is_admin());
CREATE POLICY "documentos_select_admin" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'documentos' AND public.is_admin());

CREATE POLICY "audios_insert_admin"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'audios' AND public.is_admin());

CREATE POLICY "audios_delete_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'audios' AND public.is_admin());

CREATE POLICY "audios_select_dono_ou_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'audios' AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.audios_cliente ac
        WHERE ac.storage_path = storage.objects.name
          AND ac.user_id = auth.uid()
      )
    )
  );

-- RPC do cliente ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meus_audios()
RETURNS TABLE (
  id               bigint,
  agendamento_id   bigint,
  storage_path     text,
  duracao_segundos integer,
  mime             text,
  criado_em        timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ac.id, ac.agendamento_id, ac.storage_path,
         ac.duracao_segundos, ac.mime, ac.criado_em
  FROM public.audios_cliente ac
  WHERE ac.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
  ORDER BY ac.criado_em;
$$;

REVOKE ALL ON FUNCTION public.meus_audios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meus_audios() TO authenticated;

-- Cron de entrega por e-mail (varredura de pendentes; reusa o secret
-- 'cron_emails_secret' do Vault — mesmo gate do emails-cron) -------------
-- cron.schedule('audio-email-cron', '*/10 * * * *', net.http_post →
--   functions/v1/audio-email com header x-cron-secret)
