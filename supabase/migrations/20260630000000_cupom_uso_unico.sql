-- ============================================================
-- CUPOM de uso único.
--
-- Toggle `uso_unico` no cupom:
--   - TRUE  → o cupom é desativado (ativo=FALSE) assim que o pedido
--             que o usou é CONFIRMADO PAGO (não no abandono do carrinho).
--   - FALSE → segue vivo, uso ilimitado (comportamento atual).
--
-- A "morte" acontece em confirmar_pedido_pago (fonte da verdade do
-- pagamento), na mesma transação que marca pai + filhos como pagos.
-- ============================================================

ALTER TABLE public.cupons
  ADD COLUMN IF NOT EXISTS uso_unico BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- confirmar_pedido_pago: além de marcar pago, queima o cupom de uso único.
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirmar_pedido_pago(p_chave text, p_metodo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    bigint;
  v_cupom text;
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

  -- Cupom de uso único: morre após o pagamento confirmado.
  IF v_cupom IS NOT NULL THEN
    UPDATE public.cupons
    SET ativo = FALSE
    WHERE upper(codigo) = upper(v_cupom)
      AND uso_unico = TRUE;
  END IF;

  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_pago(text, text) TO service_role;
