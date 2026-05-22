-- ============================================================
-- COCAR SAGRADO — Agenda Especial (leituras complexas)
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Tabela de disponibilidade para serviços especiais
CREATE TABLE IF NOT EXISTS public.disponibilidade_especial (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional    TEXT    NOT NULL CHECK (profissional IN ('camila', 'matheus')),
  data            DATE    NOT NULL,
  vagas_total     INTEGER NOT NULL DEFAULT 1 CHECK (vagas_total >= 0),
  vagas_restantes INTEGER NOT NULL CHECK (vagas_restantes >= 0),
  ate_horario     TIME    NOT NULL DEFAULT '18:00',
  ativo           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profissional, data),
  CHECK (vagas_restantes <= vagas_total)
);

CREATE INDEX IF NOT EXISTS idx_disp_especial_prof ON public.disponibilidade_especial (profissional);
CREATE INDEX IF NOT EXISTS idx_disp_especial_data ON public.disponibilidade_especial (data);

-- Coluna para identificar agendamentos especiais na tabela existente
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS agendamento_especial BOOLEAN NOT NULL DEFAULT false;

-- RLS
ALTER TABLE public.disponibilidade_especial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_disp_especial" ON public.disponibilidade_especial;
DROP POLICY IF EXISTS "all_disp_especial"    ON public.disponibilidade_especial;

CREATE POLICY "select_disp_especial"
  ON public.disponibilidade_especial FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "all_disp_especial"
  ON public.disponibilidade_especial FOR ALL
  TO anon
  USING (true) WITH CHECK (true);

-- ============================================================
-- Funções para controle de vagas restantes
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrementar_vagas_restantes(
  p_profissional text,
  p_data date
)
RETURNS void AS $$
BEGIN
  UPDATE public.disponibilidade_especial
  SET vagas_restantes = vagas_restantes - 1
  WHERE profissional = p_profissional
    AND data = p_data
    AND vagas_restantes > 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.incrementar_vagas_restantes(
  p_profissional text,
  p_data date
)
RETURNS void AS $$
BEGIN
  UPDATE public.disponibilidade_especial
  SET vagas_restantes = least(vagas_restantes + 1, vagas_total)
  WHERE profissional = p_profissional
    AND data = p_data;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.decrementar_vagas_restantes TO anon;
GRANT EXECUTE ON FUNCTION public.incrementar_vagas_restantes TO anon;
