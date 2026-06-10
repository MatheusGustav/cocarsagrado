-- Habilita despesas nos lançamentos manuais: categoria 'despesa'
-- (valor gravado negativo; o painel mostra bruto e o efeito no total).
ALTER TABLE public.lancamentos_financeiros
  DROP CONSTRAINT IF EXISTS lancamentos_financeiros_categoria_check;

ALTER TABLE public.lancamentos_financeiros
  ADD CONSTRAINT lancamentos_financeiros_categoria_check
  CHECK (categoria IN ('trabalho', 'outro', 'despesa'));
