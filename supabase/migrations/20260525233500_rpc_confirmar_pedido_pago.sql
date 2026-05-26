-- ============================================================
-- Migration: rpc_confirmar_pedido_pago
-- RPC transacional chamada pelo webhook da InfinitePay.
-- Marca o pedido pai + todos os agendamentos filhos como 'pago'
-- numa única transação (evita pai pago / filhos pendentes).
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirmar_pedido_pago(p_chave text, p_metodo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  -- Trava o pedido pendente (guarda contra dupla confirmação concorrente)
  SELECT id INTO v_id
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

  RETURN 1;
END;
$$;

-- Função mutante e SECURITY DEFINER: NUNCA exposta ao público.
-- Só o webhook (service_role) pode confirmar pagamento.
REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_pago(text, text) TO service_role;
