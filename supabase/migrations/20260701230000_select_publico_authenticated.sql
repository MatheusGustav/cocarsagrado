-- ============================================================
-- Leitura pública também para cliente LOGADO (authenticated)
-- ------------------------------------------------------------
-- As policies de SELECT das tabelas públicas eram só TO anon.
-- Com o login de cliente (Supabase Auth OTP), quem loga vira role
-- authenticated e perdia o catálogo/agenda/promoções — site vazio.
-- Mesmo dado público, mesma exposição: só adiciona a role.
-- Escritas seguem admin-only (is_admin()).
-- ============================================================

DROP POLICY IF EXISTS "anon_select_tipos" ON public.tipos_leitura;
CREATE POLICY "anon_select_tipos" ON public.tipos_leitura
  FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS "anon_select_horarios" ON public.horarios_disponiveis;
CREATE POLICY "anon_select_horarios" ON public.horarios_disponiveis
  FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS "anon_select_disp_especial" ON public.disponibilidade_especial;
CREATE POLICY "anon_select_disp_especial" ON public.disponibilidade_especial
  FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS "anon_select_disp_override" ON public.disponibilidade_override;
CREATE POLICY "anon_select_disp_override" ON public.disponibilidade_override
  FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS "anon_select_config" ON public.configuracoes;
CREATE POLICY "anon_select_config" ON public.configuracoes
  FOR SELECT TO anon, authenticated USING (TRUE);
