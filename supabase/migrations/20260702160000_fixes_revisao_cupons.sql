-- ============================================================
-- Correções da revisão (varredura 02/07)
-- ------------------------------------------------------------
-- 1. Cupom uso único não pode ser "gasto" em 2 pedidos: criar_pedido
--    rejeita se já existe pedido pago (sempre) ou pendente nas últimas
--    24h (trava temporária — carrinho abandonado não prende pra sempre)
--    usando o mesmo código. confirmar_pedido_pago devolve 2 quando
--    detecta reuso que escapou (webhook alerta no Telegram).
-- 2. validar_cupom ganha `precisa_login`: cupom pessoal digitado por
--    quem está deslogado recebe a dica de entrar na conta (dono errado
--    segue com o "inválido" genérico — não vaza cupom alheio).
-- 3. Vassoura de fantasmas não apaga conta que tem cupom pessoal.
-- 4. Cupom de aniversário: expira 23:59:59 do 7º dia (era 00:00 do 8º —
--    a data anunciada mentia); código com 8 chars (era 6 — colisão
--    silenciosa) e idempotência por usuário/ano via NOT EXISTS.
-- 5. admin_user_por_email diz se a conta já confirmou o e-mail (painel
--    avisa antes de criar cupom pra conta que nunca terminou o login).
-- ============================================================

-- Índice p/ as checagens de cupom em uso (pedidos por código)
CREATE INDEX IF NOT EXISTS idx_pedidos_cupom
  ON public.pedidos (upper(cupom_codigo)) WHERE cupom_codigo IS NOT NULL;

-- 1a) criar_pedido: trava de uso único -------------------------------
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
  v_cupom_uso      boolean := FALSE;
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
    SELECT valor_desconto, uso_unico INTO v_cupom_val, v_cupom_uso
    FROM public.cupons
    WHERE upper(codigo) = v_cupom_cod
      AND ativo = TRUE
      AND (expira_em IS NULL OR expira_em > now())
      AND (user_id IS NULL OR user_id = auth.uid());
    IF v_cupom_val IS NULL THEN
      RAISE EXCEPTION 'pedido_invalido: cupom inválido ou inativo';
    END IF;

    -- Uso único: o desconto entra no link de pagamento ANTES do webhook
    -- queimar o cupom — sem esta trava, 2 pedidos pendentes gastariam o
    -- mesmo cupom. Pago trava sempre; pendente trava por 24h (carrinho
    -- abandonado não prende o cupom pra sempre).
    IF v_cupom_uso AND EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE upper(p.cupom_codigo) = v_cupom_cod
        AND (p.status = 'pago'
             OR (p.status = 'pendente' AND p.criado_em > now() - interval '24 hours'))
    ) THEN
      RAISE EXCEPTION 'pedido_invalido: cupom já está em uso em outro pedido';
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

-- 1b) confirmar_pedido_pago: detecta reuso de uso único (retorna 2) ---
CREATE OR REPLACE FUNCTION public.confirmar_pedido_pago(p_chave text, p_metodo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    bigint;
  v_cupom text;
  v_uso   boolean;
  v_ativo boolean;
  v_reuso boolean := FALSE;
BEGIN
  -- Trava o pedido pendente (guarda contra dupla confirmação concorrente)
  SELECT id, cupom_codigo INTO v_id, v_cupom
  FROM public.pedidos
  WHERE chave_pedido = p_chave
    AND status = 'pendente'
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN 0; -- não existe ou já processado
  END IF;

  UPDATE public.pedidos
  SET status = 'pago', pago_em = NOW(), metodo_pagamento = p_metodo
  WHERE id = v_id;

  UPDATE public.agendamentos
  SET status = 'pago', pago_em = NOW(), metodo_pagamento = p_metodo
  WHERE pedido_id = v_id
    AND status = 'pendente';

  -- Cupom de uso único: morre após o pagamento confirmado. Se JÁ estava
  -- morto (outro pedido queimou antes), o desconto deste pedido já foi
  -- dado no link — confirma mesmo assim, mas retorna 2 pro webhook
  -- alertar (dinheiro a menos que merece um olho humano).
  IF v_cupom IS NOT NULL THEN
    SELECT uso_unico, ativo INTO v_uso, v_ativo
    FROM public.cupons
    WHERE upper(codigo) = upper(v_cupom);
    IF COALESCE(v_uso, FALSE) AND v_ativo IS FALSE THEN
      v_reuso := TRUE;
    END IF;
    UPDATE public.cupons
    SET ativo = FALSE
    WHERE upper(codigo) = upper(v_cupom)
      AND uso_unico = TRUE;
  END IF;

  RETURN CASE WHEN v_reuso THEN 2 ELSE 1 END;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_pago(text, text) TO service_role;

-- 2) validar_cupom v2: + precisa_login + trava de uso único ----------
DROP FUNCTION IF EXISTS public.validar_cupom(text);
CREATE FUNCTION public.validar_cupom(p_codigo text)
RETURNS TABLE(valido boolean, valor_desconto numeric, precisa_login boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cod  text;
  v_val  numeric;
  v_user uuid;
  v_uso  boolean;
BEGIN
  v_cod := upper(trim(COALESCE(p_codigo, '')));

  SELECT c.valor_desconto, c.user_id, c.uso_unico
  INTO v_val, v_user, v_uso
  FROM public.cupons c
  WHERE upper(c.codigo) = v_cod
    AND c.ativo = TRUE
    AND (c.expira_em IS NULL OR c.expira_em > now());

  IF v_val IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::numeric, FALSE; RETURN;
  END IF;

  -- Cupom pessoal digitado por quem está DESLOGADO: dica de entrar na
  -- conta (o dono recebe o código por e-mail e pode estar noutro
  -- aparelho). Conta errada = "inválido" genérico, não vaza cupom alheio.
  IF v_user IS NOT NULL AND auth.uid() IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::numeric, TRUE; RETURN;
  END IF;
  IF v_user IS NOT NULL AND v_user <> auth.uid() THEN
    RETURN QUERY SELECT FALSE, 0::numeric, FALSE; RETURN;
  END IF;

  -- Uso único já preso em outro pedido (mesma regra da criar_pedido)
  IF v_uso AND EXISTS (
    SELECT 1 FROM public.pedidos p
    WHERE upper(p.cupom_codigo) = v_cod
      AND (p.status = 'pago'
           OR (p.status = 'pendente' AND p.criado_em > now() - interval '24 hours'))
  ) THEN
    RETURN QUERY SELECT FALSE, 0::numeric, FALSE; RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_val, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_cupom(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_cupom(text) TO anon, authenticated;

-- 3) Vassoura não leva cupom pessoal junto ----------------------------
CREATE OR REPLACE FUNCTION public.limpar_contas_fantasma()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM auth.users u
  WHERE u.email_confirmed_at IS NULL
    AND u.created_at < now() - interval '7 days'
    -- nunca-confirmado não deveria ter nada pendurado, mas se tiver
    -- (perfil, pedido ou CUPOM PESSOAL criado pelo admin), não apaga —
    -- o CASCADE levaria o cupom junto sem aviso.
    AND NOT EXISTS (SELECT 1 FROM public.perfis  p WHERE p.id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.pedidos o WHERE o.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.cupons  c WHERE c.user_id = u.id);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.limpar_contas_fantasma() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_contas_fantasma() TO service_role;

-- 4) Aniversário: validade honesta + código sem colisão ---------------
CREATE OR REPLACE FUNCTION public.gerar_cupons_aniversario()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ano      integer := extract(year FROM v_hoje)::integer;
  v_bissexto boolean := (v_ano % 4 = 0 AND (v_ano % 100 <> 0 OR v_ano % 400 = 0));
  v_prefixo  text := 'NIVER' || to_char(v_hoje, 'YY') || '-';
  v_n        integer;
BEGIN
  INSERT INTO public.cupons (codigo, valor_desconto, descricao, ativo, uso_unico, user_id, expira_em)
  SELECT
    -- 8 chars de md5 (era 6): colisão entre 2 aniversariantes fica ~1 em
    -- 4 bilhões. Idempotência real é o NOT EXISTS por usuário/ano abaixo.
    v_prefixo || upper(substr(md5(p.id::text || v_ano::text), 1, 8)),
    15,
    'aniversário: ' || p.nome,
    TRUE,
    TRUE,
    p.id,
    -- 23:59:59 SP do 7º dia após o aniversário (era 00:00 do 8º — todo
    -- lugar que mostra a data anunciava um dia em que já não valia)
    ((v_hoje + 8)::timestamp AT TIME ZONE 'America/Sao_Paulo') - interval '1 second'
  FROM public.perfis p
  WHERE (
    (extract(month FROM p.nascimento) = extract(month FROM v_hoje)
     AND extract(day FROM p.nascimento) = extract(day FROM v_hoje))
    -- nascido em 29/02: em ano não-bissexto comemora em 28/02
    OR (to_char(p.nascimento, 'MM-DD') = '02-29'
        AND to_char(v_hoje, 'MM-DD') = '02-28'
        AND NOT v_bissexto)
  )
  -- já ganhou este ano (mesmo que o admin tenha desativado)? pula.
  AND NOT EXISTS (
    SELECT 1 FROM public.cupons c
    WHERE c.user_id = p.id AND c.codigo LIKE v_prefixo || '%'
  )
  ON CONFLICT (codigo) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_cupons_aniversario() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_cupons_aniversario() TO service_role;

-- 5) admin_user_por_email v2: informa se a conta confirmou o e-mail ---
DROP FUNCTION IF EXISTS public.admin_user_por_email(text);
CREATE FUNCTION public.admin_user_por_email(p_email text)
RETURNS TABLE (user_id uuid, nome text, confirmado boolean)
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
  SELECT u.id, pf.nome, (u.email_confirmed_at IS NOT NULL)
  FROM auth.users u
  LEFT JOIN public.perfis pf ON pf.id = u.id
  WHERE lower(u.email) = lower(trim(p_email));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_user_por_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_por_email(text) TO authenticated;
