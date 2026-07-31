-- ============================================================
-- PROVA DE ENTREGA DOS E-MAILS (webhook do Resend) — 2026-07-31
--
-- Problema: enviado_email_em só diz "o Resend aceitou o pedido de
-- envio". Se o e-mail do cliente estiver errado, ele quica e o painel
-- continua jurando que entregou. E o registro do Resend expira em 30
-- dias, muito antes do prazo de um estorno.
--
-- Solução: o Resend avisa cada mudança (entregue/quicou/reclamou) num
-- webhook ASSINADO (Svix). A função edge resend-webhook confere a
-- assinatura e guarda o aviso INTEIRO E CRU aqui. Assinatura só fecha
-- com os bytes exatos que o Resend mandou — por isso corpo_cru é TEXT
-- puro, e não jsonb: jsonb reordena chaves e normaliza espaço, o que
-- tornaria impossível re-conferir a assinatura depois. Pra consultar o
-- conteúdo basta corpo_cru::jsonb na hora da leitura.
--
-- É a única peça deste fluxo que a casa não consegue forjar: todo o
-- resto (áudio, carimbo de hora) é registro nosso sobre nós mesmos.
-- ============================================================

-- 1) Número do recibo + status derivado -----------------------------
ALTER TABLE public.audios_cliente
  ADD COLUMN IF NOT EXISTS resend_id   TEXT,        -- id do e-mail no Resend
  ADD COLUMN IF NOT EXISTS entregue_em TIMESTAMPTZ, -- Resend confirmou a entrega
  ADD COLUMN IF NOT EXISTS quicou_em   TIMESTAMPTZ; -- bounce: NÃO chegou

CREATE INDEX IF NOT EXISTS idx_audios_resend
  ON public.audios_cliente (resend_id) WHERE resend_id IS NOT NULL;

ALTER TABLE public.emails_enviados
  ADD COLUMN IF NOT EXISTS resend_id TEXT;

-- 2) Cofre dos avisos assinados -------------------------------------
CREATE TABLE IF NOT EXISTS public.email_eventos (
  id          BIGSERIAL PRIMARY KEY,
  svix_id     TEXT NOT NULL UNIQUE,   -- idempotência: o Svix re-entrega o mesmo aviso
  resend_id   TEXT,                   -- casa com audios_cliente/emails_enviados
  tipo        TEXT NOT NULL,          -- email.sent | email.delivered | email.bounced | ...
  para        TEXT,
  ocorrido_em TIMESTAMPTZ,            -- hora que o Resend carimbou (não a nossa)
  corpo_cru   TEXT NOT NULL,          -- bytes exatos do POST: é o que a assinatura cobre
  assinatura  TEXT NOT NULL,          -- header svix-signature
  svix_ts     TEXT NOT NULL,          -- header svix-timestamp (entra no cálculo)
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_eventos_resend
  ON public.email_eventos (resend_id) WHERE resend_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_eventos_tipo
  ON public.email_eventos (tipo, recebido_em DESC);

-- Prova não se apaga por acidente: só service_role (a edge) escreve e lê.
ALTER TABLE public.email_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_eventos FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.email_eventos_id_seq FROM anon, authenticated;

-- 3) O aviso pinta o status do áudio --------------------------------
-- Fica no banco (e não na edge) pra que o status derive sempre do
-- mesmo lugar: chegou aviso, mudou status. A edge só confere e grava.
CREATE OR REPLACE FUNCTION public.email_evento_aplica_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.resend_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.tipo = 'email.delivered' THEN
    UPDATE public.audios_cliente
       SET entregue_em = COALESCE(NEW.ocorrido_em, NEW.recebido_em)
     WHERE resend_id = NEW.resend_id AND entregue_em IS NULL;

  ELSIF NEW.tipo IN ('email.bounced', 'email.failed') THEN
    UPDATE public.audios_cliente
       SET quicou_em = COALESCE(NEW.ocorrido_em, NEW.recebido_em)
     WHERE resend_id = NEW.resend_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_evento_status ON public.email_eventos;
CREATE TRIGGER trg_email_evento_status
  AFTER INSERT ON public.email_eventos
  FOR EACH ROW EXECUTE FUNCTION public.email_evento_aplica_status();

REVOKE ALL ON FUNCTION public.email_evento_aplica_status() FROM PUBLIC, anon, authenticated;
