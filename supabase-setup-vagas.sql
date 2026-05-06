-- ============================================================
-- COCAR SAGRADO — Sistema de Vagas Flexível
-- Execute no SQL Editor do Supabase (separado do setup principal)
-- ============================================================

-- Tabela 1: Padrão semanal por profissional
CREATE TABLE IF NOT EXISTS public.disponibilidade_padrao (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional TEXT    NOT NULL CHECK (profissional IN ('camila', 'matheus')),
  dia_semana   INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  -- 0 = Domingo, 1 = Segunda ... 6 = Sábado
  vagas_total  INTEGER NOT NULL DEFAULT 0 CHECK (vagas_total >= 0),
  ate_horario  TIME    NOT NULL DEFAULT '18:00',
  ativo        BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profissional, dia_semana)
);

CREATE INDEX IF NOT EXISTS idx_disp_padrao_prof ON public.disponibilidade_padrao (profissional);
CREATE INDEX IF NOT EXISTS idx_disp_padrao_dia  ON public.disponibilidade_padrao (dia_semana);

-- Tabela 2: Override por data específica (sobrescreve o padrão)
CREATE TABLE IF NOT EXISTS public.disponibilidade_override (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional    TEXT    NOT NULL CHECK (profissional IN ('camila', 'matheus')),
  data            DATE    NOT NULL,
  vagas_total     INTEGER NOT NULL CHECK (vagas_total >= 0),
  vagas_restantes INTEGER NOT NULL CHECK (vagas_restantes >= 0),
  ate_horario     TIME    NOT NULL,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profissional, data),
  CHECK (vagas_restantes <= vagas_total)
);

CREATE INDEX IF NOT EXISTS idx_disp_override_prof ON public.disponibilidade_override (profissional);
CREATE INDEX IF NOT EXISTS idx_disp_override_data ON public.disponibilidade_override (data);

-- ============================================================
-- Dados iniciais — Padrão Semanal
-- ============================================================
INSERT INTO public.disponibilidade_padrao (profissional, dia_semana, vagas_total, ate_horario, ativo) VALUES
  ('camila', 0, 0, '00:00', false),
  ('camila', 1, 5, '18:00', true),
  ('camila', 2, 5, '18:00', true),
  ('camila', 3, 5, '18:00', true),
  ('camila', 4, 5, '18:00', true),
  ('camila', 5, 4, '17:00', true),
  ('camila', 6, 0, '00:00', false)
ON CONFLICT (profissional, dia_semana) DO NOTHING;

INSERT INTO public.disponibilidade_padrao (profissional, dia_semana, vagas_total, ate_horario, ativo) VALUES
  ('matheus', 0, 0, '00:00', false),
  ('matheus', 1, 3, '16:00', true),
  ('matheus', 2, 3, '16:00', true),
  ('matheus', 3, 3, '16:00', true),
  ('matheus', 4, 3, '16:00', true),
  ('matheus', 5, 2, '15:00', true),
  ('matheus', 6, 0, '00:00', false)
ON CONFLICT (profissional, dia_semana) DO NOTHING;

-- ============================================================
-- RLS — leitura pública, escrita autenticada
-- ============================================================
ALTER TABLE public.disponibilidade_padrao  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disponibilidade_override ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_disp_padrao"  ON public.disponibilidade_padrao;
DROP POLICY IF EXISTS "all_disp_padrao"     ON public.disponibilidade_padrao;
DROP POLICY IF EXISTS "select_disp_override" ON public.disponibilidade_override;
DROP POLICY IF EXISTS "all_disp_override"   ON public.disponibilidade_override;

CREATE POLICY "select_disp_padrao"
  ON public.disponibilidade_padrao FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "all_disp_padrao"
  ON public.disponibilidade_padrao FOR ALL
  TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "select_disp_override"
  ON public.disponibilidade_override FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "all_disp_override"
  ON public.disponibilidade_override FOR ALL
  TO anon
  USING (true) WITH CHECK (true);

-- ============================================================
-- Permitir hora_agendamento como '00:00' (horário a combinar)
-- O campo já é NOT NULL — usamos '00:00' como sentinela.
-- ============================================================
-- Nenhuma alteração de schema necessária.
