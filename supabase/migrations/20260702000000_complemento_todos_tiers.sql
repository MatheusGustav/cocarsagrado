-- ============================================================
-- Complemento generalizado: qualquer grupo de tiers por pergunta
-- ------------------------------------------------------------
-- Antes só Naipes + grupo 'amarracao' aceitavam pergunta adicional.
-- Agora: naipe OU qualquer grupo_slug cujos tiers tenham num_perguntas
-- preenchido (hoje: amarracao, mesa-cigana-avulsa; futuros entram só
-- de cadastrar). Guards que seguram catálogo estranho:
--   - tier atual e alvo precisam existir (ativo, num_perguntas casando);
--   - delta > 0 obrigatório (tier maior mais barato = recusa);
--   - num_perguntas = 0 nos tiers → grupo fora do complemento.
-- Front (js/conta-cliente.js) já era genérico — nenhuma mudança lá.
-- ============================================================

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
             WHEN m.t_grupo IS NOT NULL THEN COALESCE((
               SELECT max(t2.num_perguntas)::integer
               FROM public.tipos_leitura t2
               WHERE t2.grupo_slug = m.t_grupo AND t2.ativo
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
        OR (ct.t_grupo IS NOT NULL AND ct.valor_original = ct.t_preco)
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
