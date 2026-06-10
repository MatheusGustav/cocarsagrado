-- Lançamentos financeiros manuais (trabalhos espirituais e avulsos).
-- Somados ao faturamento do painel admin junto com os agendamentos.
-- Valor pode ser negativo (despesa futura). Acesso restrito a admin.
CREATE TABLE IF NOT EXISTS public.lancamentos_financeiros (
  id        BIGSERIAL PRIMARY KEY,
  data      DATE NOT NULL DEFAULT CURRENT_DATE,
  descricao TEXT NOT NULL,
  valor     NUMERIC(10,2) NOT NULL CHECK (valor <> 0),
  categoria TEXT NOT NULL DEFAULT 'trabalho' CHECK (categoria IN ('trabalho', 'outro')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lanc_fin_data ON public.lancamentos_financeiros (data);

ALTER TABLE public.lancamentos_financeiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_lancamentos" ON public.lancamentos_financeiros;
CREATE POLICY "admin_lancamentos" ON public.lancamentos_financeiros
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
