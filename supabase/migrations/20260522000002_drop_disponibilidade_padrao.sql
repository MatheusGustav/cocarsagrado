-- ============================================================
-- Remove tabela disponibilidade_padrao (código morto)
--
-- Nunca foi consumida pelo frontend. O sistema sempre operou
-- exclusivamente via disponibilidade_override (override por
-- data específica). Limpeza de schema.
-- ============================================================

DROP TABLE IF EXISTS public.disponibilidade_padrao CASCADE;
