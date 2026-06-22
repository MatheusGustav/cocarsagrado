-- ============================================================
-- CUPONS de desconto (R$ fixo no total do pedido).
--
-- Uso: comunidade do WhatsApp. O admin cria um código (ex: COMUNIDADE),
-- liga/desliga via `ativo`, e o cliente digita na revisão do carrinho.
-- Desconto é VALOR FIXO em reais, aplicado ao total do pedido.
--
-- Segurança:
--   - anon NÃO lê a tabela cupons (senão dá pra enumerar códigos).
--   - cliente valida via RPC validar_cupom (SECURITY DEFINER).
--   - criar_pedido revalida o cupom server-side (fonte da verdade).
-- Não acumula com promoção de serviço (operacionalmente nunca rodam juntos).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cupons (
  codigo         TEXT PRIMARY KEY,                      -- sempre em CAIXA ALTA
  valor_desconto NUMERIC(10,2) NOT NULL CHECK (valor_desconto > 0),
  descricao      TEXT,                                  -- nota interna (ex: "Comunidade Zap")
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;

-- Só admin autenticado lê/gerencia. anon não tem acesso direto.
DROP POLICY IF EXISTS "auth_admin_cupons" ON public.cupons;
CREATE POLICY "auth_admin_cupons" ON public.cupons
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- validar_cupom: anon checa um código para mostrar o desconto na hora.
-- Retorna apenas se é válido + o valor, sem expor a tabela inteira.
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
    AND c.ativo = TRUE;

  IF v IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::numeric;
  ELSE
    RETURN QUERY SELECT TRUE, v;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom(text) TO anon, authenticated;

-- Colunas de cupom no pedido (histórico do desconto aplicado).
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cupom_codigo   TEXT,
  ADD COLUMN IF NOT EXISTS cupom_desconto NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (cupom_desconto >= 0);

-- ============================================================
-- criar_pedido: agora aceita p_cupom_codigo (8º arg).
-- Drop da assinatura antiga (7 args) antes de recriar.
-- ============================================================
DROP FUNCTION IF EXISTS public.criar_pedido(text, text, date, text, text, numeric, jsonb);

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
  v_soma           numeric := 0;
  v_cfg            jsonb;
  v_cupom_cod      text;
  v_cupom_val      numeric := 0;
  v_cupom_desc     numeric := 0;
  v_ag_id          bigint;
  v_ids            bigint[]  := '{}';
  v_vals           numeric[] := '{}';
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
  v_cupom_cod := NULLIF(upper(trim(COALESCE(p_cupom_codigo, ''))), '');
  IF v_cupom_cod IS NOT NULL THEN
    SELECT valor_desconto INTO v_cupom_val
    FROM public.cupons
    WHERE upper(codigo) = v_cupom_cod
      AND ativo = TRUE;
    IF v_cupom_val IS NULL THEN
      RAISE EXCEPTION 'pedido_invalido: cupom inválido ou inativo';
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, status, cupom_codigo
  ) VALUES (
    p_chave, p_nome, p_nascimento, p_whatsapp,
    p_email, p_valor_total, 'pendente', v_cupom_cod
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

    -- valor_original deve ser múltiplo do preço do catálogo (qty 1–5; especial = 1)
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

    -- Desconto por item: só a promoção do serviço. (Cupom é no total, abaixo.)
    v_min_final := round(v_valor_original * (100 - v_promo_pct) / 100, 2);

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
      agendamento_especial, status
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
      'pendente'
    )
    RETURNING id INTO v_ag_id;

    v_ids  := array_append(v_ids, v_ag_id);
    v_vals := array_append(v_vals, v_valor_final);
  END LOOP;

  -- Cupom: nunca passa do total das leituras.
  v_cupom_desc := least(v_cupom_val, v_soma);

  IF abs(p_valor_total - (v_soma - v_cupom_desc)) > 0.05 THEN
    RAISE EXCEPTION 'pedido_invalido: total não confere com a soma das leituras';
  END IF;

  -- Distribui o desconto do cupom entre os filhos (proporcional, em centavos),
  -- para que cada agendamento.valor_final reflita o valor REALMENTE cobrado.
  -- Mantém pedido.valor_total = soma(valor_final) e os relatórios corretos.
  IF v_cupom_desc > 0 AND v_soma > 0 THEN
    v_resto_cents := round(v_cupom_desc * 100);
    FOR v_i IN 1 .. array_length(v_ids, 1) LOOP
      IF v_i = array_length(v_ids, 1) THEN
        v_share_cents := least(v_resto_cents, round(v_vals[v_i] * 100));
      ELSE
        v_share_cents := floor(round(v_cupom_desc * 100) * round(v_vals[v_i] * 100)
                               / round(v_soma * 100));
        v_resto_cents := v_resto_cents - v_share_cents;
      END IF;
      IF v_share_cents > 0 THEN
        UPDATE public.agendamentos
        SET desconto_aplicado = desconto_aplicado + v_share_cents / 100.0,
            valor_final       = valor_final       - v_share_cents / 100.0
        WHERE id = v_ids[v_i];
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
