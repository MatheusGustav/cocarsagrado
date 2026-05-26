-- ============================================================
-- Migration: rls_rpcs_pedidos
-- RLS, RPCs e Realtime para a tabela pedidos.
-- ============================================================

-- 1) RLS: pedidos
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

-- anon pode apenas INSERT (criar pedido novo)
DROP POLICY IF EXISTS "anon_insert_pedidos" ON public.pedidos;
CREATE POLICY "anon_insert_pedidos" ON public.pedidos
  FOR INSERT TO anon WITH CHECK (TRUE);

-- authenticated admin tem acesso total via is_admin()
DROP POLICY IF EXISTS "auth_admin_pedidos" ON public.pedidos;
CREATE POLICY "auth_admin_pedidos" ON public.pedidos
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- anon NÃO tem SELECT em pedidos (mesma política LGPL de agendamentos)

-- 2) RPC: pedido_status (substitui SELECT direto que anon não tem)
CREATE OR REPLACE FUNCTION public.pedido_status(p_chave text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT status FROM public.pedidos WHERE chave_pedido = p_chave;
$$;

GRANT EXECUTE ON FUNCTION public.pedido_status(text) TO anon;

-- 3) RPC: chave_pedido_existe — agora checa pedidos (chave é gerada no pai)
CREATE OR REPLACE FUNCTION public.chave_pedido_existe(p_chave text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pedidos WHERE chave_pedido = p_chave
  );
$$;

-- 4) Realtime: publicar pedidos também (dashboard admin precisa ver status)
ALTER TABLE public.pedidos REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pedidos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos;
  END IF;
END $$;
