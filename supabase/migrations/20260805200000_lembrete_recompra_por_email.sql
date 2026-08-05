-- ============================================================
-- Lembrete de recompra — versão SEM CONTA
-- ------------------------------------------------------------
-- O motor antigo (migration 20260702120000) pendurava a fila em
-- perfis.aceita_emails + auth.users. Com o login de cliente fora
-- do site (19/07) isso zerou: 0 perfis, 0 cupons pessoais — a
-- caixa de correio existia, mas não tinha morador cadastrado.
-- A 20260804213500 derrubou o motor inteiro.
--
-- Esta migration reergue SÓ o lembrete de recompra, agora em cima
-- do único canal vivo: agendamentos.cliente_email (o e-mail que o
-- guest dá no checkout). Cupom pessoal fica fora — nada no painel
-- cria cupom por pessoa hoje.
--
-- Régua nova: passou de 10 dias da última leitura paga e não tem
-- nada marcado pra frente. (A antiga era janela de 30–44 dias,
-- feita pra não ressuscitar cliente de 2019; aqui isso não é risco
-- — o cliente_email só passou a ser coletado em julho/26.)
--
-- Descadastro: sem conta não há "Minha conta → desligar novidades",
-- e o rodapé apontava pra uma porta pintada na parede. Agora vai
-- link com token HMAC (nada de tabela de tokens: o token é derivado
-- do e-mail + segredo do Vault, e confere sozinho).
--
-- Esta migration NÃO liga o cron — ela não dispara e-mail nenhum.
-- O interruptor está na migration seguinte.
-- ============================================================

-- 1) Log de envio: idempotência (1 e-mail por evento) -----------------
CREATE TABLE IF NOT EXISTS public.emails_enviados (
  id         bigserial PRIMARY KEY,
  tipo       text NOT NULL,           -- 'lembrete_recompra'
  ref        text NOT NULL,           -- 'leitura:ID'
  user_id    uuid,                    -- histórico da era com conta; hoje NULL
  email      text NOT NULL,
  resend_id  text,                    -- casa com email_eventos (resend-webhook)
  enviado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, ref)
);
ALTER TABLE public.emails_enviados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.emails_enviados FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.emails_enviados_id_seq FROM anon, authenticated;

-- 2) Quem pediu pra sair ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.emails_descadastro (
  email            text PRIMARY KEY,        -- sempre lower(trim(...))
  descadastrado_em timestamptz NOT NULL DEFAULT now(),
  ip               inet,
  user_agent       text
);
ALTER TABLE public.emails_descadastro ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.emails_descadastro FROM anon, authenticated;

-- 3) Segredo do token (criado aqui pra não nascer fora do git; o
--    valor em si nunca aparece no arquivo — sai de gen_random_bytes).
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'emails_descadastro_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'emails_descadastro_secret');
  END IF;
END
$do$;

-- 4) Token de descadastro: HMAC do e-mail. Sem tabela de tokens —
--    o link confere sozinho, e quem não tem o segredo não forja.
CREATE OR REPLACE FUNCTION public.email_descadastro_token(p_email text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
  SELECT left(encode(
    extensions.hmac(
      lower(trim(p_email)),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'emails_descadastro_secret'),
      'sha256'), 'hex'), 32);
$$;
REVOKE ALL ON FUNCTION public.email_descadastro_token(text) FROM PUBLIC, anon, authenticated;

-- 5) Fila do cron (só service_role) -----------------------------------
CREATE OR REPLACE FUNCTION public.emails_pendentes()
RETURNS TABLE (
  tipo    text,
  ref     text,
  user_id uuid,
  email   text,
  nome    text,
  payload jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH agora_sp AS (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date                   AS hoje,
           extract(hour FROM now() AT TIME ZONE 'America/Sao_Paulo')::int   AS hora
  ),
  -- Última leitura de cada e-mail (complemento não conta como leitura nova)
  ultimas AS (
    SELECT DISTINCT ON (lower(trim(a.cliente_email)))
           lower(trim(a.cliente_email)) AS email,
           a.id                         AS ag_id,
           a.cliente_nome               AS nome,
           a.data_agendamento,
           t.nome                       AS tipo_nome
    FROM public.agendamentos a
    JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
    WHERE a.cliente_email IS NOT NULL
      AND trim(a.cliente_email) <> ''
      AND a.leitura_origem_id IS NULL
      AND a.status IN ('pago', 'confirmado', 'atendido')
    ORDER BY lower(trim(a.cliente_email)), a.data_agendamento DESC, a.id DESC
  )
  SELECT 'lembrete_recompra'::text,
         'leitura:' || u.ag_id,
         NULL::uuid,
         u.email,
         u.nome,
         jsonb_build_object(
           'tipo_nome',          u.tipo_nome,
           'data',               u.data_agendamento,
           'descadastro_token',  public.email_descadastro_token(u.email)
         )
  FROM ultimas u
  CROSS JOIN agora_sp h
  WHERE (h.hoje - u.data_agendamento) > 10   -- dormente há mais de 10 dias
    AND h.hora BETWEEN 9 AND 20              -- só em horário humano (SP)
    AND NOT EXISTS (                         -- pediu pra sair
      SELECT 1 FROM public.emails_descadastro d WHERE d.email = u.email
    )
    AND NOT EXISTS (                         -- já tem coisa marcada pra frente
      SELECT 1 FROM public.agendamentos a2
      WHERE lower(trim(a2.cliente_email)) = u.email
        AND a2.data_agendamento > u.data_agendamento
        AND a2.status IN ('pendente', 'pago', 'confirmado')
    )
    AND NOT EXISTS (                         -- já mandei por esta leitura
      SELECT 1 FROM public.emails_enviados e
      WHERE e.tipo = 'lembrete_recompra'
        AND e.ref  = 'leitura:' || u.ag_id
    );
$$;
REVOKE ALL ON FUNCTION public.emails_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emails_pendentes() TO service_role;

-- 6) Descadastrar (anon: o token no link é o segredo) -----------------
CREATE OR REPLACE FUNCTION public.descadastrar_email(p_email text, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(p_email));
BEGIN
  IF p_token IS NULL OR v_email = ''
     OR p_token <> public.email_descadastro_token(v_email) THEN
    RETURN false;
  END IF;

  -- Idempotente: clicar duas vezes no link não é erro.
  INSERT INTO public.emails_descadastro (email, ip, user_agent)
  VALUES (
    v_email,
    inet_client_addr(),
    left(coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), 400)
  )
  ON CONFLICT (email) DO NOTHING;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.descadastrar_email(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.descadastrar_email(text, text) TO anon, authenticated;
