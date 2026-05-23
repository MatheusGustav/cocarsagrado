-- ============================================================
-- Coluna num_perguntas em tipos_leitura
--
-- Antes: número de caixas de pergunta era extraído via regex
-- do nome ("3 perguntas"). Frágil — depende de convenção textual
-- e não cobre casos como "Combo + 10" (10 perguntas implícitas).
--
-- Agora: campo explícito no admin, fonte única de verdade.
-- ============================================================

ALTER TABLE public.tipos_leitura
  ADD COLUMN IF NOT EXISTS num_perguntas INTEGER NOT NULL DEFAULT 0
  CHECK (num_perguntas >= 0 AND num_perguntas <= 20);

-- Backfill: extrai N do nome para tipos que já têm o padrão "N pergunta(s)"
UPDATE public.tipos_leitura
SET num_perguntas = COALESCE(
  (regexp_match(nome, '(\d+)\s*pergunta', 'i'))[1]::int,
  1
)
WHERE requer_pergunta = TRUE
  AND num_perguntas = 0;

-- Combo + 10 — exceção sem o padrão "N perguntas" no nome
UPDATE public.tipos_leitura
SET num_perguntas = 10
WHERE nome = 'Combo + 10';

-- Garante consistência: tipos sem requer_pergunta têm 0
UPDATE public.tipos_leitura
SET num_perguntas = 0
WHERE requer_pergunta = FALSE
  AND num_perguntas > 0;
