-- ============================================================
-- Migration: rpc_criar_pedido
-- Cria o pedido pai + N agendamentos filhos numa única transação.
-- SECURITY DEFINER: contorna o fato de anon não ter SELECT/DELETE em
-- pedidos (LGPD). Os triggers BEFORE INSERT de agendamentos (vaga
-- especial / desconto novo cliente) rodam por linha; se algum RAISE,
-- a transação inteira faz rollback automático.
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
  v_pedido_id bigint;
  v_item      jsonb;
BEGIN
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
    INSERT INTO public.agendamentos (
      chave_pedido, pedido_id, tipo_leitura_id, terapeuta,
      cliente_nome, cliente_nascimento, cliente_whatsapp, cliente_email,
      cliente_observacoes, data_agendamento, hora_agendamento, duracao_minutos,
      valor_original, desconto_aplicado, valor_final,
      aceitou_desconto_10, agendamento_especial, status
    ) VALUES (
      p_chave,
      v_pedido_id,
      (v_item->>'tipo_leitura_id')::bigint,
      v_item->>'terapeuta',
      p_nome, p_nascimento, p_whatsapp, p_email,
      v_item->>'observacoes',
      (v_item->>'data')::date,
      (v_item->>'horario')::time,
      (v_item->>'duracao_minutos')::int,
      (v_item->>'valor_original')::numeric,
      (v_item->>'desconto_aplicado')::numeric,
      (v_item->>'valor_final')::numeric,
      COALESCE((v_item->>'aceitou_novo_cliente')::boolean, FALSE),
      COALESCE((v_item->>'agendamento_especial')::boolean, FALSE),
      'pendente'
    );
  END LOOP;

  RETURN p_chave;
END;
$$;

-- anon precisa criar pedidos pelo site público.
GRANT EXECUTE ON FUNCTION public.criar_pedido(text, text, date, text, text, numeric, boolean, jsonb) TO anon;
