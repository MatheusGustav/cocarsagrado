-- ============================================================
-- criar_pedido com validação server-side.
-- Antes a RPC aceitava qualquer preço/quantidade vindos do
-- navegador. Agora:
--   1. 1 a 4 leituras por pedido;
--   2. tipo deve existir, estar ativo e o terapeuta conferir;
--   3. valor_original = preco_original × qty (qty 1–5; especial = 1);
--   4. desconto máximo por item = maior entre a promoção ativa
--      do serviço (configuracoes.descontos) e os 10% de novo
--      cliente — descontos NÃO acumulam;
--   5. valor_final = valor_original − desconto_aplicado;
--   6. valor_total do pedido = soma dos valor_final.
-- ============================================================

CREATE OR REPLACE FUNCTION public.criar_pedido(
  p_chave               text,
  p_nome                text,
  p_nascimento          date,
  p_whatsapp            text,
  p_email               text,
  p_valor_total         numeric,
  p_aceitou_desconto_10 boolean,
  p_itens               jsonb
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
  v_max_pct        numeric;
  v_min_final      numeric;
  v_soma           numeric := 0;
  v_cfg            jsonb;
BEGIN
  v_n := COALESCE(jsonb_array_length(p_itens), 0);
  IF v_n < 1 OR v_n > 4 THEN
    RAISE EXCEPTION 'pedido_invalido: o pedido deve ter entre 1 e 4 leituras';
  END IF;

  SELECT valor INTO v_cfg FROM public.configuracoes WHERE chave = 'descontos';

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, aceitou_desconto_10, status
  ) VALUES (
    p_chave, p_nome, p_nascimento, p_whatsapp,
    p_email, p_valor_total, p_aceitou_desconto_10, 'pendente'
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

    -- Desconto máximo: promoção OU 10% de novo cliente (não acumulam).
    -- Os 10% só valem se o item carrega a flag aceitou_novo_cliente — assim
    -- o trigger validar_desconto_primeiro_cliente sempre confere a elegibilidade.
    v_max_pct   := greatest(v_promo_pct,
      CASE WHEN COALESCE((v_item->>'aceitou_novo_cliente')::boolean, FALSE) THEN 10 ELSE 0 END);
    v_min_final := round(v_valor_original * (100 - v_max_pct) / 100, 2);

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
      aceitou_desconto_10, agendamento_especial, status
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
      COALESCE((v_item->>'aceitou_novo_cliente')::boolean, FALSE),
      v_tipo.especial,  -- vem do catálogo, não do cliente (impede burlar a trava de vagas)
      'pendente'
    );
  END LOOP;

  IF abs(p_valor_total - v_soma) > 0.05 THEN
    RAISE EXCEPTION 'pedido_invalido: total não confere com a soma das leituras';
  END IF;

  RETURN p_chave;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_pedido(text, text, date, text, text, numeric, boolean, jsonb) TO anon;
