-- ============================================================
-- Áudios das leituras (gravados pela admin no painel)
-- ------------------------------------------------------------
-- A admin grava áudios para o cliente na aba "Áudios" do painel.
-- O arquivo vai para o bucket PRIVADO "audios" e a linha em
-- audios_cliente vincula o áudio ao agendamento e à conta do
-- cliente (pedidos.user_id; NULL = guest). Cliente logado ouve
-- no drawer "Minha conta" via meus_audios() + signed URL.
--
-- Peças:
--   1. Tabela audios_cliente
--   2. Trigger que resolve user_id no banco (front não manda)
--   3. RLS: admin ALL, cliente SELECT do próprio
--   4. Bucket privado "audios" + policies em storage.objects
--   5. RPC meus_audios() (molde minhas_leituras)
--
-- Futuro (WhatsApp automático): coluna enviado_whatsapp_em fica
-- pronta; uma edge function (molde emails-cron) varre os NULL.
-- ============================================================

-- 1) Tabela -----------------------------------------------------------
CREATE TABLE public.audios_cliente (
  id                  BIGSERIAL PRIMARY KEY,
  agendamento_id      BIGINT NOT NULL REFERENCES public.agendamentos(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL = guest
  storage_path        TEXT NOT NULL UNIQUE,
  duracao_segundos    INTEGER,
  tamanho_bytes       BIGINT,
  mime                TEXT NOT NULL DEFAULT 'audio/webm',
  enviado_whatsapp_em TIMESTAMPTZ,  -- NULL = ainda não enviado (envio automático futuro)
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audios_agendamento ON public.audios_cliente (agendamento_id);
CREATE INDEX idx_audios_user ON public.audios_cliente (user_id) WHERE user_id IS NOT NULL;

-- 2) Trigger: user_id vem de agendamentos → pedidos, nunca do front ----
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

-- Função de trigger não é endpoint REST (molde 20260605144025)
REVOKE ALL ON FUNCTION public.audio_seta_user_id() FROM PUBLIC, anon, authenticated;

-- 3) RLS ---------------------------------------------------------------
ALTER TABLE public.audios_cliente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audios_cliente FROM anon;

-- Admin gerencia tudo
CREATE POLICY "auth_admin_audios" ON public.audios_cliente
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Cliente lê só o próprio (user_id NULL nunca casa com auth.uid())
CREATE POLICY "audios_select_own" ON public.audios_cliente
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 4) Bucket privado "audios" + policies --------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('audios', 'audios', false, 52428800,
        ARRAY['audio/webm','audio/mp4','audio/mpeg','audio/ogg'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 52428800,
      allowed_mime_types = ARRAY['audio/webm','audio/mp4','audio/mpeg','audio/ogg'];

DROP POLICY IF EXISTS "audios_insert_admin"          ON storage.objects;
DROP POLICY IF EXISTS "audios_delete_admin"          ON storage.objects;
DROP POLICY IF EXISTS "audios_select_dono_ou_admin"  ON storage.objects;

CREATE POLICY "audios_insert_admin"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'audios' AND public.is_admin());

CREATE POLICY "audios_delete_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'audios' AND public.is_admin());

-- SELECT (também autoriza createSignedUrl): admin ou dono do áudio.
-- Join por storage_path (índice UNIQUE) em vez de prefixo user_id/ no
-- path: se um guest virar conta depois (backfill de pedidos.user_id),
-- o áudio passa a aparecer sem mover arquivo nenhum.
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

-- 5) RPC meus_audios() (molde minhas_leituras) --------------------------
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
