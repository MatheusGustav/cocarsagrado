-- Item 5 do review de segurança (31/07): nada amarrava um pagamento
-- específico ao pedido. As colunas txid existiam desde sempre em pedidos e
-- agendamentos, mas o webhook nunca as preenchia — ficavam 100% NULL. Sem
-- isso, o mesmo transaction_nsu podia ser apresentado para pedidos
-- diferentes e nenhuma trava percebia.
--
-- 1) confirmar_pedido_pago ganha 3º argumento (p_txid) e grava no pai e nos
--    filhos.
-- 2) Índice único parcial: um transaction_nsu paga UM pedido só.
-- 3) A função recusa antes de mexer em qualquer linha (retorno 3) quando o
--    txid já está em outro pedido; o índice é a rede contra corrida (duas
--    confirmações simultâneas) — nesse caso a 2ª estoura unique_violation,
--    o webhook devolve 500 e a reentrega da InfinitePay cai no retorno 3.

-- Todas as linhas têm txid NULL hoje, então o índice sobe sem conflito.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_txid_unico
  ON public.pedidos (txid) WHERE txid IS NOT NULL;

-- A assinatura muda (2 → 3 args). A versão antiga precisa sair: com as duas
-- no catálogo, a chamada de 2 argumentos ficaria ambígua. Só o webhook
-- (service_role) chama esta função.
DROP FUNCTION IF EXISTS public.confirmar_pedido_pago(text, text);

CREATE OR REPLACE FUNCTION public.confirmar_pedido_pago(
  p_chave  text,
  p_metodo text,
  p_txid   text DEFAULT NULL
)
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
  -- Este pagamento já quitou OUTRO pedido: não confirma nada (retorno 3).
  IF p_txid IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.pedidos
       WHERE txid = p_txid AND chave_pedido <> p_chave
     ) THEN
    RETURN 3;
  END IF;

  SELECT id, cupom_codigo INTO v_id, v_cupom
  FROM public.pedidos
  WHERE chave_pedido = p_chave
    AND status = 'pendente'
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.pedidos
  SET status = 'pago', pago_em = NOW(), metodo_pagamento = p_metodo,
      txid = COALESCE(p_txid, txid)
  WHERE id = v_id;

  UPDATE public.agendamentos
  SET status = 'pago', pago_em = NOW(), metodo_pagamento = p_metodo,
      txid = COALESCE(p_txid, txid)
  WHERE pedido_id = v_id
    AND status = 'pendente';

  -- Cupom de uso único: morre após o pagamento confirmado. Se JÁ estava
  -- morto (outro pedido queimou antes), o desconto deste pedido já foi
  -- dado no link — confirma mesmo assim, mas retorna 2 pro webhook
  -- alertar no Telegram (desconto saiu em dobro).
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

REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_pago(text, text, text) TO service_role;
