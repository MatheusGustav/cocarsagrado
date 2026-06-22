-- ============================================================
-- Backfill: lançamentos manuais antigos (sem terapeuta) eram todos
-- trabalhos espirituais do Matheus. Atribui retroativamente.
-- ============================================================

UPDATE public.lancamentos_financeiros
SET terapeuta = 'matheus'
WHERE terapeuta IS NULL;
