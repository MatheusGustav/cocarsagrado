-- ============================================================
-- COCAR SAGRADO — Sistema de Vagas Flexível
-- Execute no SQL Editor do Supabase (separado do setup principal)
-- ============================================================

-- Override por data específica (única fonte de verdade da agenda)
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
-- RLS — leitura pública, escrita autenticada
-- ============================================================
ALTER TABLE public.disponibilidade_override ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_disp_override" ON public.disponibilidade_override;
DROP POLICY IF EXISTS "all_disp_override"   ON public.disponibilidade_override;
DROP POLICY IF EXISTS "anon_select_disp_override" ON public.disponibilidade_override;

-- anon só pode ler (cliente vê vagas). Escrita só pelo admin (auth_all_*).
CREATE POLICY "anon_select_disp_override"
  ON public.disponibilidade_override FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- Permitir hora_agendamento como '00:00' (horário a combinar)
-- O campo já é NOT NULL — usamos '00:00' como sentinela.
-- ============================================================
-- Nenhuma alteração de schema necessária.
