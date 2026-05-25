-- ============================================================
-- REALTIME — dashboard escuta a tabela agendamentos
-- Quando o webhook da InfinitePay muda pendente -> pago, o painel
-- admin recebe o evento e atualiza na hora (sem polling de 2 min).
-- REPLICA IDENTITY FULL garante que payload.old traga o status
-- anterior, necessário para detectar a transição pendente -> pago.
-- A autorização do canal respeita a RLS: só authenticated
-- (policy auth_select_agend) recebe os eventos.
-- ============================================================

ALTER TABLE public.agendamentos REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agendamentos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agendamentos;
  END IF;
END $$;
