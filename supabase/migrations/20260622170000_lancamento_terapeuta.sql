-- ============================================================
-- Lançamentos manuais: atribuição opcional a um terapeuta.
--
-- Permite que trabalhos espirituais/avulsos apareçam na quebra
-- "Por terapeuta" do financeiro. NULL = Geral (não atribuído).
-- ============================================================

ALTER TABLE public.lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS terapeuta TEXT
    CHECK (terapeuta IS NULL OR terapeuta IN ('matheus', 'camila'));
