-- ============================================================
-- ÁUDIOS DAS LEITURAS — estado atual no banco
-- (espelho da migration 20260708120000_audios_cliente.sql)
-- ------------------------------------------------------------
-- Admin grava áudios na aba "Áudios" do painel; arquivo no bucket
-- privado "audios", metadados em audios_cliente. Cliente logado
-- ouve no drawer via meus_audios() + createSignedUrl (a policy de
-- SELECT em storage.objects autoriza só admin e dono).
-- user_id NULL = pedido guest (não aparece para ninguém no site).
-- enviado_whatsapp_em: reservado para o envio automático futuro.
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
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audios_agendamento ON public.audios_cliente (agendamento_id);
CREATE INDEX idx_audios_user ON public.audios_cliente (user_id) WHERE user_id IS NOT NULL;

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
