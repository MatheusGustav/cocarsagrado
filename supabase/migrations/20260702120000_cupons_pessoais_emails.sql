-- ============================================================
-- Cupons pessoais + opt-in de e-mails + e-mails automáticos
-- ------------------------------------------------------------
-- 1. cupons.user_id/expira_em — cupom com dono (só a conta dona usa)
--    e validade opcional. Cupom sem dono segue global (comunidade).
-- 2. perfis.aceita_emails(+_em) — opt-in LGPD: cliente marca no
--    cadastro (desmarcado por padrão) e liga/desliga na tela logada.
--    Sem opt-in NENHUM e-mail promocional sai (cupom continua
--    visível no drawer).
-- 3. emails_enviados — log/idempotência dos envios (service_role).
-- 4. validar_cupom / criar_pedido — cupom pessoal só vale pro dono
--    logado; expirado não passa. Erro é o genérico de sempre (não
--    vaza a existência de cupom alheio).
-- 5. meus_cupons() — cupons da conta logada, com status calculado.
-- 6. admin_user_por_email() — admin resolve e-mail → conta ao criar
--    cupom pessoal no painel.
-- 7. emails_pendentes() — fila do cron (cupom ganho + lembrete de
--    recompra 30 dias depois da última leitura, janela de 14 dias
--    pra não spammar cliente antigo no lançamento; horário humano SP).
-- 8. pg_cron + pg_net — job a cada 15 min chama a edge function
--    emails-cron (secret no Vault: 'cron_emails_secret').
-- ============================================================

-- 1) cupons: dono + validade ----------------------------------------
ALTER TABLE public.cupons
  ADD COLUMN IF NOT EXISTS user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS expira_em timestamptz;
CREATE INDEX IF NOT EXISTS idx_cupons_user
  ON public.cupons (user_id) WHERE user_id IS NOT NULL;

-- 2) perfis: opt-in de e-mails (LGPD: guarda QUANDO consentiu) -------
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS aceita_emails    boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS aceita_emails_em timestamptz;

-- 3) emails_enviados: log + trava de reenvio -------------------------
CREATE TABLE IF NOT EXISTS public.emails_enviados (
  id         bigserial PRIMARY KEY,
  tipo       text NOT NULL,           -- 'cupom_ganho' | 'lembrete_recompra'
  ref        text NOT NULL,           -- 'cupom:CODIGO' | 'leitura:ID'
  user_id    uuid,
  email      text NOT NULL,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, ref)                  -- idempotência: 1 e-mail por evento
);
ALTER TABLE public.emails_enviados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.emails_enviados FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.emails_enviados_id_seq FROM anon, authenticated;

-- 4a) validar_cupom: dono + validade ---------------------------------
CREATE OR REPLACE FUNCTION public.validar_cupom(p_codigo text)
RETURNS TABLE(valido boolean, valor_desconto numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v numeric;
BEGIN
  SELECT c.valor_desconto INTO v
  FROM public.cupons c
  WHERE upper(c.codigo) = upper(trim(p_codigo))
    AND c.ativo = TRUE
    AND (c.expira_em IS NULL OR c.expira_em > now())
    AND (c.user_id IS NULL OR c.user_id = auth.uid());

  IF v IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::numeric;
  ELSE
    RETURN QUERY SELECT TRUE, v;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom(text) TO anon, authenticated;

-- 4b) criar_pedido: revalida cupom com dono/validade (fonte da verdade).
-- Única mudança vs 20260701210000: o SELECT do cupom ganha as duas
-- condições novas. Resto idêntico.
CREATE OR REPLACE FUNCTION public.criar_pedido(
  p_chave        text,
  p_nome         text,
  p_nascimento   date,
  p_whatsapp     text,
  p_email        text,
  p_valor_total  numeric,
  p_itens        jsonb,
  p_cupom_codigo text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id      bigint;
  v_item           jsonb;
  v_n              integer;
  v_tipo           public.tipos_leitura%ROWTYPE;
  v_valor_original numeric;
  v_desconto       numeric;
  v_valor_final    numeric;
  v_qty            numeric;
  v_promo_pct      numeric;
  v_min_final      numeric;
  v_num_perg       integer;   -- naipe: qtd de perguntas declarada (1..4)
  v_esperado_naipe numeric;   -- preço acumulado esperado para v_num_perg
  v_soma           numeric := 0;
  v_soma_elig      numeric := 0;   -- soma das leituras elegíveis a cupom (não-naipe)
  v_cfg            jsonb;
  v_cupom_cod      text;
  v_cupom_val      numeric := 0;
  v_cupom_desc     numeric := 0;
  v_ag_id          bigint;
  v_ids            bigint[]  := '{}';
  v_vals           numeric[] := '{}';
  v_elig_ids       bigint[]  := '{}'; -- filhos que entram no rateio do cupom
  v_elig_vals      numeric[] := '{}';
  v_i              integer;
  v_share_cents    numeric;
  v_resto_cents    numeric;
BEGIN
  v_n := COALESCE(jsonb_array_length(p_itens), 0);
  IF v_n < 1 OR v_n > 4 THEN
    RAISE EXCEPTION 'pedido_invalido: o pedido deve ter entre 1 e 4 leituras';
  END IF;

  SELECT valor INTO v_cfg FROM public.configuracoes WHERE chave = 'descontos';

  -- Cupom (R$ fixo no total). Valida cedo pra falhar antes de inserir.
  -- Cupom pessoal só vale pro dono logado; expirado não passa.
  v_cupom_cod := NULLIF(upper(trim(COALESCE(p_cupom_codigo, ''))), '');
  IF v_cupom_cod IS NOT NULL THEN
    SELECT valor_desconto INTO v_cupom_val
    FROM public.cupons
    WHERE upper(codigo) = v_cupom_cod
      AND ativo = TRUE
      AND (expira_em IS NULL OR expira_em > now())
      AND (user_id IS NULL OR user_id = auth.uid());
    IF v_cupom_val IS NULL THEN
      RAISE EXCEPTION 'pedido_invalido: cupom inválido ou inativo';
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, status, cupom_codigo, user_id
  ) VALUES (
    p_chave, p_nome, p_nascimento, p_whatsapp,
    p_email, p_valor_total, 'pendente', v_cupom_cod,
    auth.uid()  -- NULL para guest; base do histórico do cliente logado
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    SELECT * INTO v_tipo
    FROM public.tipos_leitura
    WHERE id = (v_item->>'tipo_leitura_id')::bigint
      AND ativo = TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pedido_invalido: leitura inexistente ou inativa';
    END IF;
    IF v_tipo.terapeuta IS DISTINCT FROM (v_item->>'terapeuta') THEN
      RAISE EXCEPTION 'pedido_invalido: terapeuta não confere com o catálogo';
    END IF;

    v_valor_original := COALESCE((v_item->>'valor_original')::numeric, -1);
    v_desconto       := COALESCE((v_item->>'desconto_aplicado')::numeric, 0);
    v_valor_final    := COALESCE((v_item->>'valor_final')::numeric, -1);

    IF v_tipo.slug = 'naipes-da-pombo-gira' THEN
      -- Naipes da Pomba Gira: preço progressivo por qtd de perguntas, amarrado
      -- ao num_perguntas declarado (1→30, 2→56, 3→78, 4→96). Sem desconto.
      v_num_perg := COALESCE((v_item->>'num_perguntas')::integer, 0);
      IF v_num_perg < 1 OR v_num_perg > 4 THEN
        RAISE EXCEPTION 'pedido_invalido: qtd de perguntas do naipe inválida';
      END IF;
      v_esperado_naipe := CASE v_num_perg
                            WHEN 1 THEN 30
                            WHEN 2 THEN 56
                            WHEN 3 THEN 78
                            WHEN 4 THEN 96
                          END;
      IF v_valor_original <> v_esperado_naipe THEN
        RAISE EXCEPTION 'pedido_invalido: valor do naipe não confere com a qtd de perguntas';
      END IF;
      v_min_final := v_valor_original; -- força valor_final = valor_original
    ELSE
      -- valor_original deve ser múltiplo do preço do catálogo (qty 1–5; especial = 1)
      v_num_perg := v_tipo.num_perguntas;
      IF v_tipo.preco_original = 0 THEN
        IF v_valor_original <> 0 THEN
          RAISE EXCEPTION 'pedido_invalido: valor não confere com o catálogo';
        END IF;
      ELSE
        v_qty := v_valor_original / v_tipo.preco_original;
        IF v_qty <> trunc(v_qty) OR v_qty < 1 OR v_qty > 5
           OR (v_tipo.especial AND v_qty <> 1) THEN
          RAISE EXCEPTION 'pedido_invalido: valor não confere com o catálogo';
        END IF;
      END IF;

      -- Percentual de promoção ativa do serviço (id salvo = slug ou grupo_slug)
      v_promo_pct := 0;
      IF v_cfg IS NOT NULL THEN
        SELECT COALESCE(max((p->>'percentualDesconto')::numeric), 0) INTO v_promo_pct
        FROM jsonb_array_elements(COALESCE(v_cfg->'promocoes', '[]'::jsonb)) AS p
        WHERE COALESCE((p->>'descontoAtivo')::boolean, FALSE)
          AND p->>'id' IN (v_tipo.slug, v_tipo.grupo_slug);
      END IF;

      -- Único desconto possível agora: promoção ativa do serviço.
      v_min_final := round(v_valor_original * (100 - v_promo_pct) / 100, 2);
    END IF;

    IF v_valor_final < v_min_final - 0.01
       OR v_valor_final > v_valor_original
       OR abs(v_valor_final - (v_valor_original - v_desconto)) > 0.01 THEN
      RAISE EXCEPTION 'pedido_invalido: desconto acima do permitido';
    END IF;

    v_soma := v_soma + v_valor_final;

    INSERT INTO public.agendamentos (
      chave_pedido, pedido_id, tipo_leitura_id, terapeuta,
      cliente_nome, cliente_nascimento, cliente_whatsapp, cliente_email,
      cliente_observacoes, data_agendamento, hora_agendamento,
      valor_original, desconto_aplicado, valor_final,
      agendamento_especial, status, num_perguntas
    ) VALUES (
      p_chave,
      v_pedido_id,
      v_tipo.id,
      v_item->>'terapeuta',
      p_nome, p_nascimento, p_whatsapp, p_email,
      v_item->>'observacoes',
      (v_item->>'data')::date,
      (v_item->>'horario')::time,
      v_valor_original,
      v_desconto,
      v_valor_final,
      v_tipo.especial,  -- vem do catálogo, não do cliente (impede burlar a trava de vagas)
      'pendente',
      COALESCE(v_num_perg, 0)
    )
    RETURNING id INTO v_ag_id;

    v_ids  := array_append(v_ids, v_ag_id);
    v_vals := array_append(v_vals, v_valor_final);
    -- Naipes da Pomba Gira não entram em cupom (leitura sem desconto).
    IF v_tipo.slug <> 'naipes-da-pombo-gira' THEN
      v_elig_ids  := array_append(v_elig_ids, v_ag_id);
      v_elig_vals := array_append(v_elig_vals, v_valor_final);
      v_soma_elig := v_soma_elig + v_valor_final;
    END IF;
  END LOOP;

  -- Cupom: incide só sobre as leituras elegíveis (nunca passa da base).
  v_cupom_desc := least(v_cupom_val, v_soma_elig);

  IF abs(p_valor_total - (v_soma - v_cupom_desc)) > 0.05 THEN
    RAISE EXCEPTION 'pedido_invalido: total não confere com a soma das leituras';
  END IF;

  -- Distribui o desconto do cupom entre os filhos ELEGÍVEIS (proporcional, em
  -- centavos), para que cada agendamento.valor_final reflita o valor REALMENTE
  -- cobrado. Mantém pedido.valor_total = soma(valor_final) e relatórios corretos.
  IF v_cupom_desc > 0 AND v_soma_elig > 0 THEN
    v_resto_cents := round(v_cupom_desc * 100);
    FOR v_i IN 1 .. array_length(v_elig_ids, 1) LOOP
      IF v_i = array_length(v_elig_ids, 1) THEN
        v_share_cents := least(v_resto_cents, round(v_elig_vals[v_i] * 100));
      ELSE
        v_share_cents := floor(round(v_cupom_desc * 100) * round(v_elig_vals[v_i] * 100)
                               / round(v_soma_elig * 100));
        v_resto_cents := v_resto_cents - v_share_cents;
      END IF;
      IF v_share_cents > 0 THEN
        UPDATE public.agendamentos
        SET desconto_aplicado = desconto_aplicado + v_share_cents / 100.0,
            valor_final       = valor_final       - v_share_cents / 100.0
        WHERE id = v_elig_ids[v_i];
      END IF;
    END LOOP;
  END IF;

  UPDATE public.pedidos
  SET cupom_desconto = v_cupom_desc
  WHERE id = v_pedido_id;

  RETURN p_chave;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_pedido(text, text, date, text, text, numeric, jsonb, text) TO anon;

-- 5) meus_cupons: cupons da conta logada, com status calculado --------
-- descricao fica de fora (nota interna do admin).
CREATE OR REPLACE FUNCTION public.meus_cupons()
RETURNS TABLE (
  codigo         text,
  valor_desconto numeric,
  expira_em      timestamptz,
  status         text,
  criado_em      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    c.codigo,
    c.valor_desconto,
    c.expira_em,
    CASE
      WHEN c.ativo AND (c.expira_em IS NULL OR c.expira_em > now()) THEN 'disponivel'
      WHEN c.uso_unico AND NOT c.ativo AND EXISTS (
        SELECT 1 FROM public.pedidos p
        WHERE upper(p.cupom_codigo) = upper(c.codigo) AND p.status = 'pago'
      ) THEN 'usado'
      WHEN c.expira_em IS NOT NULL AND c.expira_em <= now() THEN 'expirado'
      ELSE 'inativo'
    END AS status,
    c.criado_em
  FROM public.cupons c
  WHERE auth.uid() IS NOT NULL
    AND c.user_id = auth.uid()
  ORDER BY c.criado_em DESC;
$$;

REVOKE ALL ON FUNCTION public.meus_cupons() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meus_cupons() TO authenticated;

-- 6) admin_user_por_email: resolve e-mail → conta (cupom pessoal) -----
CREATE OR REPLACE FUNCTION public.admin_user_por_email(p_email text)
RETURNS TABLE (user_id uuid, nome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  RETURN QUERY
  SELECT u.id, pf.nome
  FROM auth.users u
  LEFT JOIN public.perfis pf ON pf.id = u.id
  WHERE lower(u.email) = lower(trim(p_email));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_user_por_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_por_email(text) TO authenticated;

-- 7) emails_pendentes: fila do cron (só service_role) -----------------
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
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date          AS hoje,
           extract(hour FROM now() AT TIME ZONE 'America/Sao_Paulo')::int AS hora
  ),
  -- Cupom pessoal ativo cujo dono optou por e-mails e ainda não foi avisado
  cupom AS (
    SELECT 'cupom_ganho'::text        AS tipo,
           'cupom:' || c.codigo       AS ref,
           c.user_id,
           u.email::text              AS email,
           pf.nome,
           jsonb_build_object(
             'codigo',    c.codigo,
             'valor',     c.valor_desconto,
             'expira_em', c.expira_em
           ) AS payload
    FROM public.cupons c
    JOIN public.perfis pf ON pf.id = c.user_id AND pf.aceita_emails
    JOIN auth.users u     ON u.id  = c.user_id
    WHERE c.user_id IS NOT NULL
      AND c.ativo
      AND (c.expira_em IS NULL OR c.expira_em > now())
  ),
  -- Última leitura concluída de cada conta (complementos não contam)
  ultimas AS (
    SELECT DISTINCT ON (p.user_id)
           p.user_id, a.id AS ag_id, a.data_agendamento, t.nome AS tipo_nome
    FROM public.agendamentos a
    JOIN public.pedidos p       ON p.id = a.pedido_id
    JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
    WHERE p.user_id IS NOT NULL
      AND a.leitura_origem_id IS NULL
      AND a.status IN ('pago', 'confirmado', 'atendido')
    ORDER BY p.user_id, a.data_agendamento DESC, a.id DESC
  ),
  -- Lembrete de recompra: 30 dias após a última leitura. Janela fecha em
  -- 44 dias — no lançamento da feature, cliente antigo não é ressuscitado.
  -- Só em horário humano (9h–20h SP); o dedup fica no NOT EXISTS final.
  lembrete AS (
    SELECT 'lembrete_recompra'::text  AS tipo,
           'leitura:' || ul.ag_id     AS ref,
           ul.user_id,
           u.email::text              AS email,
           pf.nome,
           jsonb_build_object(
             'tipo_nome', ul.tipo_nome,
             'data',      ul.data_agendamento
           ) AS payload
    FROM ultimas ul
    CROSS JOIN agora_sp h
    JOIN public.perfis pf ON pf.id = ul.user_id AND pf.aceita_emails
    JOIN auth.users u     ON u.id  = ul.user_id
    WHERE (h.hoje - ul.data_agendamento) BETWEEN 30 AND 44
      AND h.hora BETWEEN 9 AND 20
      AND NOT EXISTS (              -- já tem coisa marcada pra frente? não lembra
        SELECT 1 FROM public.agendamentos a2
        JOIN public.pedidos p2 ON p2.id = a2.pedido_id
        WHERE p2.user_id = ul.user_id
          AND a2.data_agendamento > ul.data_agendamento
          AND a2.status IN ('pendente', 'pago', 'confirmado')
      )
  )
  SELECT q.*
  FROM (SELECT * FROM cupom UNION ALL SELECT * FROM lembrete) q
  WHERE NOT EXISTS (
    SELECT 1 FROM public.emails_enviados e
    WHERE e.tipo = q.tipo AND e.ref = q.ref
  );
$$;

REVOKE ALL ON FUNCTION public.emails_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emails_pendentes() TO service_role;

-- 8) Cron: a cada 15 min chama a edge function emails-cron ------------
-- Secret fica no Vault ('cron_emails_secret'), criado fora do git:
--   select vault.create_secret('<valor>', 'cron_emails_secret');
-- A edge function compara com o env CRON_SECRET.
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
