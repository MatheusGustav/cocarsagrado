-- ============================================================
-- Fecha INSERT direto de anon em pedidos/agendamentos.
--
-- Bug: as policies anon_insert_* eram WITH CHECK (TRUE), permitindo
-- que anon desse POST /rest/v1/pedidos (ou /agendamentos) direto,
-- com status='pago' e valor_total=0 — furando toda a validação de
-- preço/desconto da RPC criar_pedido.
--
-- A criar_pedido é SECURITY DEFINER (roda como dono, ignora RLS),
-- então NÃO precisa dessas policies para funcionar. Removê-las +
-- revogar INSERT do anon força toda criação a passar pela RPC validada.
-- ============================================================

-- 1) Remove as policies de INSERT abertas
DROP POLICY IF EXISTS "anon_insert_pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "anon_insert_agend"   ON public.agendamentos;

-- 2) Revoga o privilégio de INSERT no nível da tabela (defesa em profundidade)
REVOKE INSERT ON public.pedidos      FROM anon;
REVOKE INSERT ON public.agendamentos FROM anon;

-- A criar_pedido (SECURITY DEFINER) continua criando pedido + agendamentos
-- normalmente, pois roda com os privilégios do dono da função.
