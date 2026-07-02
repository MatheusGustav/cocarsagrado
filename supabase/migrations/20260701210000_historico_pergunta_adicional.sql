-- ============================================================
-- Histórico de leituras + pergunta adicional (pedido complemento)
-- ------------------------------------------------------------
-- Cliente logado vê suas leituras e, nas elegíveis (Naipes da Pomba
-- Gira e Amarração de Igbo), pode adicionar perguntas pagando só a
-- diferença da tabela ATUAL, até o fim do dia seguinte ao dia agendado.
--
-- Peças:
--   1. pedidos.user_id            — vínculo pedido ↔ conta (só pedidos logados)
--   2. agendamentos.num_perguntas — qtd de perguntas do item (antes só no payload)
--   3. agendamentos.leitura_origem_id — marca complemento e aponta a origem
--   4. triggers de vaga           — complemento NÃO consome vaga nem conta como usada
--   5. criar_pedido               — grava user_id (auth.uid()) e num_perguntas
--   6. minhas_leituras()          — histórico do cliente logado (authenticated)
--   7. criar_pedido_complemento() — cria pedido/agendamento da diferença
--
-- Complemento é pedido NORMAL (chave/order_nsu próprios): checkout e
-- webhook (confirmar_pedido_pago) funcionam sem nenhuma mudança.
-- ============================================================

-- 1) pedidos.user_id ------------------------------------------------
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_user
  ON public.pedidos (user_id) WHERE user_id IS NOT NULL;

-- 2/3) agendamentos.num_perguntas + leitura_origem_id ---------------
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS num_perguntas integer NOT NULL DEFAULT 0
    CHECK (num_perguntas >= 0 AND num_perguntas <= 20);
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS leitura_origem_id bigint
    REFERENCES public.agendamentos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agend_origem
  ON public.agendamentos (leitura_origem_id) WHERE leitura_origem_id IS NOT NULL;

-- 4) Triggers de vaga: complemento não passa pela trava --------------
-- (a pergunta extra acontece dentro da sessão já agendada; e não pode
-- ocupar vaga do dia — que normalmente já é hoje/ontem — nem inflar a
-- contagem de "usadas" contra outros clientes.)
CREATE OR REPLACE FUNCTION public.decrementar_vaga_especial_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restantes INTEGER;
BEGIN
  IF NEW.leitura_origem_id IS NOT NULL THEN
    RETURN NEW; -- complemento: não consome vaga
  END IF;

  IF NEW.agendamento_especial IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.terapeuta IS NULL OR NEW.data_agendamento IS NULL THEN
    RAISE EXCEPTION 'Agendamento especial exige terapeuta e data';
  END IF;

  SELECT vagas_restantes INTO v_restantes
  FROM public.disponibilidade_especial
  WHERE profissional = NEW.terapeuta
    AND data = NEW.data_agendamento
  FOR UPDATE;

  IF v_restantes IS NULL THEN
    RAISE EXCEPTION 'Disponibilidade especial não encontrada para % em %',
      NEW.terapeuta, NEW.data_agendamento;
  END IF;

  IF v_restantes <= 0 THEN
    RAISE EXCEPTION 'Sem vagas disponíveis para % em %',
      NEW.terapeuta, NEW.data_agendamento;
  END IF;

  UPDATE public.disponibilidade_especial
  SET vagas_restantes = vagas_restantes - 1
  WHERE profissional = NEW.terapeuta
    AND data = NEW.data_agendamento;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_vaga_normal_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total  INTEGER;
  v_ativo  BOOLEAN;
  v_usadas INTEGER;
BEGIN
  IF NEW.leitura_origem_id IS NOT NULL THEN
    RETURN NEW; -- complemento: não consome vaga
  END IF;

  IF NEW.agendamento_especial IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.terapeuta IS NULL OR NEW.data_agendamento IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT vagas_total, ativo INTO v_total, v_ativo
  FROM public.disponibilidade_override
  WHERE profissional = NEW.terapeuta
    AND data = NEW.data_agendamento
  FOR UPDATE;

  IF v_total IS NULL OR v_ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem vagas disponíveis para % em %',
      NEW.terapeuta, NEW.data_agendamento;
  END IF;

  SELECT count(*) INTO v_usadas
  FROM public.agendamentos
  WHERE terapeuta = NEW.terapeuta
    AND data_agendamento = NEW.data_agendamento
    AND agendamento_especial IS NOT TRUE
    AND leitura_origem_id IS NULL
    AND status IN ('pendente', 'pago', 'confirmado', 'atendido');

  IF v_usadas >= v_total THEN
    RAISE EXCEPTION 'Sem vagas disponíveis para % em %',
      NEW.terapeuta, NEW.data_agendamento;
  END IF;

  RETURN NEW;
END;
$$;

-- 5) criar_pedido: grava user_id + num_perguntas ---------------------
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

-- 6) minhas_leituras: histórico do cliente logado ---------------------
-- Só pedidos com user_id = auth.uid() (guest antigo fica de fora — casar
-- por WhatsApp seria spoofável). Admin não usa (não tem pedidos).
-- pode_complementar já vem calculado: elegível (naipe / amarração tier
-- único), pago, dentro da janela (até o fim do dia seguinte ao dia
-- agendado, fuso São Paulo) e ainda abaixo do teto de perguntas.
CREATE OR REPLACE FUNCTION public.minhas_leituras()
RETURNS TABLE (
  id                bigint,
  chave_pedido      text,
  tipo_nome         text,
  tipo_slug         text,
  grupo_slug        text,
  terapeuta         text,
  data_agendamento  date,
  status            text,
  valor_final       numeric,
  num_perguntas     integer,
  perguntas_total   integer,
  max_perguntas     integer,
  leitura_origem_id bigint,
  pode_complementar boolean,
  criado_em         timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH minhas AS (
    SELECT a.*,
           t.nome  AS t_nome,
           t.slug  AS t_slug,
           t.grupo_slug AS t_grupo,
           t.preco_original AS t_preco
    FROM public.agendamentos a
    JOIN public.pedidos p       ON p.id = a.pedido_id
    JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
    WHERE p.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ),
  com_totais AS (
    SELECT m.*,
           -- perguntas já garantidas: as da origem + complementos PAGOS
           m.num_perguntas + COALESCE((
             SELECT sum(c.num_perguntas)::integer
             FROM public.agendamentos c
             WHERE c.leitura_origem_id = m.id
               AND c.status IN ('pago','confirmado','atendido')
           ), 0) AS p_total,
           CASE
             WHEN m.t_slug = 'naipes-da-pombo-gira' THEN 4
             WHEN m.t_grupo = 'amarracao' THEN COALESCE((
               SELECT max(t2.num_perguntas)::integer
               FROM public.tipos_leitura t2
               WHERE t2.grupo_slug = 'amarracao' AND t2.ativo
             ), 0)
             ELSE 0
           END AS p_max
    FROM minhas m
  )
  SELECT
    ct.id,
    ct.chave_pedido,
    ct.t_nome,
    ct.t_slug,
    ct.t_grupo,
    ct.terapeuta,
    ct.data_agendamento,
    ct.status,
    ct.valor_final,
    ct.num_perguntas,
    ct.p_total,
    ct.p_max,
    ct.leitura_origem_id,
    (
      ct.leitura_origem_id IS NULL
      AND ct.status IN ('pago','confirmado','atendido')
      AND ct.num_perguntas >= 1
      AND (
        ct.t_slug = 'naipes-da-pombo-gira'
        OR (ct.t_grupo = 'amarracao' AND ct.valor_original = ct.t_preco)
      )
      AND (now() AT TIME ZONE 'America/Sao_Paulo')::date <= ct.data_agendamento + 1
      AND ct.p_total < ct.p_max
    ) AS pode_complementar,
    ct.criado_em
  FROM com_totais ct
  ORDER BY ct.criado_em DESC;
$$;

REVOKE ALL ON FUNCTION public.minhas_leituras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_leituras() TO authenticated;

-- 7) criar_pedido_complemento -----------------------------------------
-- Cria o pedido da DIFERENÇA: valida dono/janela/elegibilidade e calcula
-- o delta 100% no servidor (tabela atual, sem cupom/desconto). O front
-- só manda chave nova + origem + qtd extra + texto das perguntas.
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
  ELSIF v_tipo.grupo_slug = 'amarracao' THEN
    -- Tiers atuais do catálogo por qtd de perguntas (preço cheio, sem promo/cupom)
    SELECT t.preco_original INTO v_preco_de
    FROM public.tipos_leitura t
    WHERE t.grupo_slug = 'amarracao' AND t.ativo AND t.num_perguntas = v_atuais;
    SELECT t.preco_original INTO v_preco_para
    FROM public.tipos_leitura t
    WHERE t.grupo_slug = 'amarracao' AND t.ativo AND t.num_perguntas = v_novo_total;
  ELSE
    RAISE EXCEPTION 'complemento_invalido: esta leitura não aceita perguntas adicionais';
  END IF;

  IF v_preco_de IS NULL OR v_preco_para IS NULL OR v_preco_para <= v_preco_de THEN
    RAISE EXCEPTION 'complemento_invalido: quantidade indisponível para esta leitura';
  END IF;
  v_delta := v_preco_para - v_preco_de;

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, status, user_id
  ) VALUES (
    p_chave, v_ag.cliente_nome, v_ag.cliente_nascimento, v_ag.cliente_whatsapp,
    v_ag.cliente_email, v_delta, 'pendente', v_uid
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

REVOKE ALL ON FUNCTION public.criar_pedido_complemento(text, bigint, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_pedido_complemento(text, bigint, integer, text) TO authenticated;
