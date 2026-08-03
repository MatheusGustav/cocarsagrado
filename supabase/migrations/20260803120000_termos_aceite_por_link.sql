-- ============================================================
-- Aceite dos Termos por LINK (cliente que agenda pelo WhatsApp).
--
-- Caso de uso: cliente que não consegue usar o site (analfabeto,
-- pouca familiaridade com internet). A consulta é combinada e paga
-- por fora, no zap — mas o aceite dos Termos precisa da MESMA prova
-- que os pedidos do site têm (pedidos.termos_versao). Fluxo:
--   1. Painel (aba "Termos") gera um link com token CSPRNG e o nome
--      do cliente; Camila manda no WhatsApp.
--   2. Cliente abre /aceite?t=TOKEN, vê os termos (com botão de
--      OUVIR) e toca num único botão "LI E ACEITO".
--   3. aceitar_termos_link grava versão + quando + IP + user-agent.
--      No painel o status vira "Aceito".
--
-- anon NÃO lê a tabela (não enumera links): acesso só pelas 2 RPCs,
-- e ambas exigem o token (o token É o segredo, como a chave_pedido).
-- ============================================================

CREATE TABLE public.termos_aceites (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token             text NOT NULL UNIQUE CHECK (length(token) BETWEEN 8 AND 64),
  cliente_nome      text NOT NULL CHECK (length(trim(cliente_nome)) > 0),
  cliente_whatsapp  text,          -- opcional: habilita o botão "Zap" no painel
  termos_versao     text,          -- NULL = ainda não aceitou
  aceito_em         timestamptz,   -- NULL = ainda não aceitou
  aceite_ip         text,          -- prova extra, capturada no servidor
  aceite_user_agent text,
  criado_em         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.termos_aceites ENABLE ROW LEVEL SECURITY;

-- Só admin (AAL2) gerencia direto; anon/cliente passam pelas RPCs.
CREATE POLICY "auth_admin_termos_aceites" ON public.termos_aceites
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- aceite_info: a página cumprimenta o cliente pelo nome e sabe se
-- já aceitou (link reaberto mostra "tudo certo" em vez do botão).
-- NULL = token inexistente (a página mostra "link não funcionou").
-- ============================================================
CREATE OR REPLACE FUNCTION public.aceite_info(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'nome',      ta.cliente_nome,
           'aceito',    ta.aceito_em IS NOT NULL,
           'aceito_em', ta.aceito_em
         )
  FROM public.termos_aceites ta
  WHERE ta.token = trim(COALESCE(p_token, ''));
$$;

GRANT EXECUTE ON FUNCTION public.aceite_info(text) TO anon, authenticated;

-- ============================================================
-- aceitar_termos_link: grava o aceite. Idempotente — segundo toque
-- no botão (ou link reaberto) devolve o aceite original, sem erro
-- e sem sobrescrever a prova. IP/user-agent vêm dos headers que o
-- PostgREST expõe (request.headers), nunca do cliente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.aceitar_termos_link(p_token text, p_versao text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ta      public.termos_aceites%ROWTYPE;
  v_headers jsonb;
  v_ip      text;
  v_ua      text;
BEGIN
  IF NULLIF(trim(COALESCE(p_versao, '')), '') IS NULL THEN
    RAISE EXCEPTION 'aceite_invalido: versão dos termos ausente';
  END IF;

  -- FOR UPDATE serializa toque duplo simultâneo no botão
  SELECT * INTO v_ta
  FROM public.termos_aceites
  WHERE token = trim(COALESCE(p_token, ''))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;  -- token inexistente: front trata como link inválido
  END IF;

  IF v_ta.aceito_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_aceito', true, 'aceito_em', v_ta.aceito_em);
  END IF;

  -- Prova extra: nunca derruba o aceite se os headers vierem tortos
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
    v_ip := NULLIF(trim(split_part(COALESCE(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
    v_ua := NULLIF(left(COALESCE(v_headers->>'user-agent', ''), 300), '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL; v_ua := NULL;
  END;

  UPDATE public.termos_aceites
  SET termos_versao     = trim(p_versao),
      aceito_em         = now(),
      aceite_ip         = v_ip,
      aceite_user_agent = v_ua
  WHERE id = v_ta.id;

  RETURN jsonb_build_object('ok', true, 'ja_aceito', false, 'aceito_em', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.aceitar_termos_link(text, text) TO anon, authenticated;

-- PostgREST: recarrega o cache de schema (tabela + RPCs novas).
NOTIFY pgrst, 'reload schema';
