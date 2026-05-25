-- ============================================================
-- LIMPEZA DE RLS + HARDENING
-- Estado anterior: policies duplicadas de migrations antigas.
-- Em agendamentos/configuracoes convivia uma policy is_admin()
-- (intenção: só o admin) com policies "USING (true)" que, por serem
-- permissivas (OR), anulavam a restrição — qualquer conta autenticada
-- lia/editava todos os dados de clientes. Além disso anon_all_horarios
-- permitia anon ESCREVER horários.
--
-- Modelo final (limpo e consistente):
--   anon  -> SELECT no catálogo/disponibilidade/config + INSERT agendamentos
--            (mutações sensíveis só via RPC security definer)
--   admin -> authenticated ALL via is_admin() em todas as tabelas
-- ============================================================

-- ------------------------------------------------------------
-- 1) Hardening de funções (search_path fixo) — advisors
-- ------------------------------------------------------------
ALTER FUNCTION public.is_admin()                       SET search_path = public;
ALTER FUNCTION public.update_updated_at_column()       SET search_path = public;
ALTER FUNCTION public.incrementar_vagas_restantes(text, date) SET search_path = public;

-- ------------------------------------------------------------
-- 2) Triggers de updated_at (função existia mas estava órfã)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_disp_especial_updated ON public.disponibilidade_especial;
CREATE TRIGGER trg_disp_especial_updated
  BEFORE UPDATE ON public.disponibilidade_especial
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_disp_override_updated ON public.disponibilidade_override;
CREATE TRIGGER trg_disp_override_updated
  BEFORE UPDATE ON public.disponibilidade_override
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 3) RLS — derruba TODAS as policies antigas e recria o modelo limpo
-- ------------------------------------------------------------

-- tipos_leitura
DROP POLICY IF EXISTS "anon_select_tipos" ON public.tipos_leitura;
DROP POLICY IF EXISTS "auth_all_tipos"    ON public.tipos_leitura;
CREATE POLICY "anon_select_tipos" ON public.tipos_leitura
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "auth_admin_tipos" ON public.tipos_leitura
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- horarios_disponiveis (anon só lê; antes podia escrever)
DROP POLICY IF EXISTS "anon_all_horarios"  ON public.horarios_disponiveis;
DROP POLICY IF EXISTS "auth_all_horarios"  ON public.horarios_disponiveis;
CREATE POLICY "anon_select_horarios" ON public.horarios_disponiveis
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "auth_admin_horarios" ON public.horarios_disponiveis
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- disponibilidade_especial
DROP POLICY IF EXISTS "anon_select_disp_especial" ON public.disponibilidade_especial;
DROP POLICY IF EXISTS "auth_all_disp_especial"    ON public.disponibilidade_especial;
CREATE POLICY "anon_select_disp_especial" ON public.disponibilidade_especial
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "auth_admin_disp_especial" ON public.disponibilidade_especial
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- disponibilidade_override
DROP POLICY IF EXISTS "anon_select_disp_override" ON public.disponibilidade_override;
DROP POLICY IF EXISTS "auth_all_disp_override"    ON public.disponibilidade_override;
CREATE POLICY "anon_select_disp_override" ON public.disponibilidade_override
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "auth_admin_disp_override" ON public.disponibilidade_override
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- agendamentos (anon só INSERT; admin tudo via is_admin)
DROP POLICY IF EXISTS "anon_insert_agend"      ON public.agendamentos;
DROP POLICY IF EXISTS "auth_select_agend"      ON public.agendamentos;
DROP POLICY IF EXISTS "auth_update_agend"      ON public.agendamentos;
DROP POLICY IF EXISTS "auth_delete_agend"      ON public.agendamentos;
DROP POLICY IF EXISTS "auth_all_agendamentos"  ON public.agendamentos;
CREATE POLICY "anon_insert_agend" ON public.agendamentos
  FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "auth_admin_agend" ON public.agendamentos
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- configuracoes
DROP POLICY IF EXISTS "anon_select_config"        ON public.configuracoes;
DROP POLICY IF EXISTS "anon_select_configuracoes" ON public.configuracoes;
DROP POLICY IF EXISTS "anon_upsert_config"        ON public.configuracoes;
DROP POLICY IF EXISTS "auth_all_config"           ON public.configuracoes;
DROP POLICY IF EXISTS "auth_all_configuracoes"    ON public.configuracoes;
CREATE POLICY "anon_select_config" ON public.configuracoes
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "auth_admin_config" ON public.configuracoes
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- bloqueios_horario (não exposto a anon; admin gerencia)
DROP POLICY IF EXISTS "auth_admin_bloqueios" ON public.bloqueios_horario;
CREATE POLICY "auth_admin_bloqueios" ON public.bloqueios_horario
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
