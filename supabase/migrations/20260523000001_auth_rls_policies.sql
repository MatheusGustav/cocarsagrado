-- ============================================================
-- Migration: RLS para role authenticated + GRANTs + configuracoes
-- 2026-05-23
-- ============================================================

-- 1. tipos_leitura — autenticado pode tudo (admin gerencia)
DROP POLICY IF EXISTS "auth_all_tipos" ON public.tipos_leitura;
CREATE POLICY "auth_all_tipos" ON public.tipos_leitura
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- 2. horarios_disponiveis — autenticado pode tudo
DROP POLICY IF EXISTS "auth_all_horarios" ON public.horarios_disponiveis;
CREATE POLICY "auth_all_horarios" ON public.horarios_disponiveis
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- 3. agendamentos — autenticado pode SELECT, UPDATE, DELETE
DROP POLICY IF EXISTS "auth_select_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "auth_update_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "auth_delete_agend" ON public.agendamentos;

CREATE POLICY "auth_select_agend" ON public.agendamentos
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "auth_update_agend" ON public.agendamentos
  FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "auth_delete_agend" ON public.agendamentos
  FOR DELETE TO authenticated USING (TRUE);

-- 4. disponibilidade_override — autenticado pode tudo
DROP POLICY IF EXISTS "auth_all_disp_override" ON public.disponibilidade_override;
CREATE POLICY "auth_all_disp_override"
  ON public.disponibilidade_override FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. disponibilidade_especial — autenticado pode tudo
DROP POLICY IF EXISTS "auth_all_disp_especial" ON public.disponibilidade_especial;
CREATE POLICY "auth_all_disp_especial"
  ON public.disponibilidade_especial FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. configuracoes — autenticado pode tudo (admin gerencia descontos)
DROP POLICY IF EXISTS "auth_all_config" ON public.configuracoes;
CREATE POLICY "auth_all_config" ON public.configuracoes
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- 7. GRANTs para RPCs de vagas — autenticado também precisa
GRANT EXECUTE ON FUNCTION public.incrementar_vagas_restantes TO authenticated;
