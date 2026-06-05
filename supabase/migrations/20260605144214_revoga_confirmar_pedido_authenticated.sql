-- ============================================================
-- confirmar_pedido_pago é exclusiva do webhook (service_role).
-- O setup original revogou PUBLIC e anon mas esqueceu
-- authenticated — qualquer usuário logado podia marcar pedidos
-- como pagos via /rest/v1/rpc/confirmar_pedido_pago.
-- (O painel admin marca pago via UPDATE direto, não usa a RPC.)
-- ============================================================

REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM authenticated;
