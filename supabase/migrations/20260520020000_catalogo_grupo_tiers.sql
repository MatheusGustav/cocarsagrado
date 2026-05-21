-- ============================================================
-- Migration: Suportar agrupamento de leituras em tiers
-- ============================================================

alter table public.tipos_leitura
  add column if not exists grupo_slug  text,
  add column if not exists tier_label  text;

-- Amarração de Igbo
update public.tipos_leitura set grupo_slug='amarracao',        tier_label='1 pergunta'  where slug='amarracao-1';
update public.tipos_leitura set grupo_slug='amarracao',        tier_label='2 perguntas' where slug='amarracao-2';
update public.tipos_leitura set grupo_slug='amarracao',        tier_label='3 perguntas' where slug='amarracao-3';

-- Mesa Cigana Avulsa
update public.tipos_leitura set grupo_slug='mesa-cigana-avulsa', tier_label='1 pergunta'  where slug='mesa-cigana-avulsa-1';
update public.tipos_leitura set grupo_slug='mesa-cigana-avulsa', tier_label='2 perguntas' where slug='mesa-cigana-avulsa-2';
update public.tipos_leitura set grupo_slug='mesa-cigana-avulsa', tier_label='3 perguntas' where slug='mesa-cigana-avulsa-3';
