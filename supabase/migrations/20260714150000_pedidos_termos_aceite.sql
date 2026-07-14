-- Prova de aceite dos Termos POR PEDIDO.
--
-- Antes, o aceite existia em dois lugares só: (a) guest — trava de UI no
-- checkout, NADA gravado; (b) logado — perfis.termos_versao. Cliente
-- contestando ("nunca concordei") virava palavra contra palavra.
-- Agora cada pedido grava a versão aceita no ato da criação:
--   logado  → herda do perfil (fonte da verdade; front nem envia);
--   guest   → p_termos_versao coletado do checkbox obrigatório;
--   NULL    → nenhum aceite registrado (pedidos antigos ficam NULL —
--             não se inventa aceite retroativo).

ALTER TABLE public.pedidos
  ADD COLUMN termos_versao text;

COMMENT ON COLUMN public.pedidos.termos_versao IS
  'Versão dos Termos de Uso aceita no ato do pedido. NULL = sem registro (pedidos anteriores a 14/07/2026).';

-- Assinatura muda (novo arg com DEFAULT): dropa a antiga pra não deixar
-- overload ambíguo no PostgREST. Front antigo (8 args nomeados) continua
-- funcionando — cai no DEFAULT NULL.
DROP FUNCTION public.criar_pedido(text, text, date, text, text, numeric, jsonb, text);

CREATE OR REPLACE FUNCTION public.criar_pedido(
  p_chave         text,
  p_nome          text,
  p_nascimento    date,
  p_whatsapp      text,
  p_email         text,
  p_valor_total   numeric,
  p_itens         jsonb,
  p_cupom_codigo  text DEFAULT NULL,
  p_termos_versao text DEFAULT NULL
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
  v_termos         text;
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

  -- Aceite dos Termos gravado no pedido (prova por transação). Logado usa
  -- a versão do PERFIL (aceita no cadastro/re-aceite — o front nem envia);
  -- guest e logado-sem-perfil usam o que o checkbox do checkout coletou.
  -- NULL = nenhum aceite registrado (fica visível, não se mascara).
  SELECT termos_versao INTO v_termos FROM public.perfis WHERE id = auth.uid();
  v_termos := COALESCE(v_termos, NULLIF(trim(p_termos_versao), ''));

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, status, cupom_codigo, user_id, termos_versao
  ) VALUES (
    p_chave, p_nome, p_nascimento, p_whatsapp,
    p_email, p_valor_total, 'pendente', v_cupom_cod,
    auth.uid(),  -- NULL para guest; base do histórico do cliente logado
    v_termos
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

GRANT EXECUTE ON FUNCTION public.criar_pedido(text, text, date, text, text, numeric, jsonb, text, text) TO anon;

CREATE OR REPLACE FUNCTION public.criar_pedido_complemento(
  p_chave             text,
  p_leitura_origem_id bigint,
  p_perguntas_extra   integer,
  p_observacoes       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_ag         public.agendamentos%ROWTYPE;
  v_tipo       public.tipos_leitura%ROWTYPE;
  v_user_ped   uuid;
  v_atuais     integer;
  v_novo_total integer;
  v_preco_de   numeric;
  v_preco_para numeric;
  v_delta      numeric;
  v_pedido_id  bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'complemento_invalido: é preciso estar logado';
  END IF;
  IF p_perguntas_extra IS NULL OR p_perguntas_extra < 1 OR p_perguntas_extra > 3 THEN
    RAISE EXCEPTION 'complemento_invalido: quantidade de perguntas inválida';
  END IF;
  IF p_chave IS NULL OR length(trim(p_chave)) < 6 THEN
    RAISE EXCEPTION 'complemento_invalido: chave inválida';
  END IF;

  -- FOR UPDATE na origem serializa complementos concorrentes da mesma leitura
  SELECT a.* INTO v_ag
  FROM public.agendamentos a
  WHERE a.id = p_leitura_origem_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'complemento_invalido: leitura não encontrada';
  END IF;

  SELECT p.user_id INTO v_user_ped
  FROM public.pedidos p WHERE p.id = v_ag.pedido_id;
  IF v_user_ped IS NULL OR v_user_ped <> v_uid THEN
    RAISE EXCEPTION 'complemento_invalido: leitura não pertence a esta conta';
  END IF;

  IF v_ag.leitura_origem_id IS NOT NULL THEN
    RAISE EXCEPTION 'complemento_invalido: complemento não pode ter complemento';
  END IF;
  IF v_ag.status NOT IN ('pago','confirmado','atendido') THEN
    RAISE EXCEPTION 'complemento_invalido: a leitura original ainda não foi paga';
  END IF;

  -- Janela: até o fim do dia seguinte ao dia agendado (fuso São Paulo)
  IF (now() AT TIME ZONE 'America/Sao_Paulo')::date > v_ag.data_agendamento + 1 THEN
    RAISE EXCEPTION 'complemento_expirado: o prazo para adicionar perguntas terminou';
  END IF;

  SELECT * INTO v_tipo
  FROM public.tipos_leitura
  WHERE id = v_ag.tipo_leitura_id;

  -- perguntas já garantidas = origem + complementos pagos
  SELECT v_ag.num_perguntas + COALESCE(sum(c.num_perguntas)::integer, 0)
  INTO v_atuais
  FROM public.agendamentos c
  WHERE c.leitura_origem_id = v_ag.id
    AND c.status IN ('pago','confirmado','atendido');

  IF v_atuais < 1 THEN
    RAISE EXCEPTION 'complemento_invalido: leitura sem registro de perguntas';
  END IF;
  v_novo_total := v_atuais + p_perguntas_extra;

  IF v_tipo.slug = 'naipes-da-pombo-gira' THEN
    IF v_novo_total > 4 THEN
      RAISE EXCEPTION 'complemento_invalido: o naipe aceita no máximo 4 perguntas';
    END IF;
    -- Tabela progressiva atual do naipe (mesma da criar_pedido)
    v_preco_de   := CASE v_atuais     WHEN 1 THEN 30 WHEN 2 THEN 56 WHEN 3 THEN 78 WHEN 4 THEN 96 END;
    v_preco_para := CASE v_novo_total WHEN 1 THEN 30 WHEN 2 THEN 56 WHEN 3 THEN 78 WHEN 4 THEN 96 END;
  ELSIF v_tipo.grupo_slug IS NOT NULL THEN
    -- Qualquer grupo de tiers por nº de perguntas (amarração, mesa cigana
    -- avulsa, futuros). Tier atual e alvo pelo catálogo ATUAL (preço cheio).
    SELECT t.preco_original INTO v_preco_de
    FROM public.tipos_leitura t
    WHERE t.grupo_slug = v_tipo.grupo_slug AND t.ativo AND t.num_perguntas = v_atuais;
    SELECT t.preco_original INTO v_preco_para
    FROM public.tipos_leitura t
    WHERE t.grupo_slug = v_tipo.grupo_slug AND t.ativo AND t.num_perguntas = v_novo_total;
  ELSE
    RAISE EXCEPTION 'complemento_invalido: esta leitura não aceita perguntas adicionais';
  END IF;

  IF v_preco_de IS NULL OR v_preco_para IS NULL OR v_preco_para <= v_preco_de THEN
    RAISE EXCEPTION 'complemento_invalido: quantidade indisponível para esta leitura';
  END IF;
  v_delta := v_preco_para - v_preco_de;

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, status, user_id, termos_versao
  ) VALUES (
    p_chave, v_ag.cliente_nome, v_ag.cliente_nascimento, v_ag.cliente_whatsapp,
    v_ag.cliente_email, v_delta, 'pendente', v_uid,
    -- complemento é sempre logado: prova de aceite vem do perfil
    (SELECT termos_versao FROM public.perfis WHERE id = v_uid)
  )
  RETURNING id INTO v_pedido_id;

  INSERT INTO public.agendamentos (
    chave_pedido, pedido_id, tipo_leitura_id, terapeuta,
    cliente_nome, cliente_nascimento, cliente_whatsapp, cliente_email,
    cliente_observacoes, data_agendamento, hora_agendamento,
    valor_original, desconto_aplicado, valor_final,
    agendamento_especial, status, num_perguntas, leitura_origem_id
  ) VALUES (
    p_chave, v_pedido_id, v_ag.tipo_leitura_id, v_ag.terapeuta,
    v_ag.cliente_nome, v_ag.cliente_nascimento, v_ag.cliente_whatsapp, v_ag.cliente_email,
    p_observacoes,
    v_ag.data_agendamento,  -- mesmo dia/contexto da leitura original
    v_ag.hora_agendamento,
    v_delta, 0, v_delta,
    FALSE, 'pendente', p_perguntas_extra, v_ag.id
  );

  RETURN jsonb_build_object('chave', p_chave, 'valor', v_delta);
END;
$$;

-- PostgREST: recarrega o cache de schema (nova assinatura da RPC).
NOTIFY pgrst, 'reload schema';
