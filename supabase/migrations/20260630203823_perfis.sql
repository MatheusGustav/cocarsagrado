-- ============================================================
-- PERFIS de cliente (login via Supabase Auth OTP por e-mail).
--
-- id = auth.uid() (1:1 com auth.users). E-mail NÃO é duplicado
-- aqui: quando precisar, faça JOIN com auth.users.
--
-- RLS: cada pessoa só lê/edita o próprio perfil.
-- ============================================================

CREATE TABLE public.perfis (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  nascimento date NOT NULL,
  whatsapp   text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_perfis_whatsapp_norm ON public.perfis (regexp_replace(whatsapp, '\D', '', 'g'));

ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfis_select_own" ON public.perfis
  FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "perfis_insert_own" ON public.perfis
  FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "perfis_update_own" ON public.perfis
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
