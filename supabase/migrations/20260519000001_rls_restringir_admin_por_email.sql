-- ============================================================
-- Migration: Restringir políticas de admin por email
-- Aplicado manualmente via painel Supabase.
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select auth.email() in (
    'matheusgustav.dev@gmail.com'
    -- adicione outros emails de admin aqui se necessário
  )
$$;

-- tipos_leitura
drop policy if exists "auth_all_tipos" on public.tipos_leitura;
create policy "auth_all_tipos"
  on public.tipos_leitura for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- horarios_disponiveis
drop policy if exists "auth_all_horarios" on public.horarios_disponiveis;
create policy "auth_all_horarios"
  on public.horarios_disponiveis for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- agendamentos
drop policy if exists "auth_all_agendamentos" on public.agendamentos;
create policy "auth_all_agendamentos"
  on public.agendamentos for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- disponibilidade_especial
drop policy if exists "auth_all_disp_especial" on public.disponibilidade_especial;
create policy "auth_all_disp_especial"
  on public.disponibilidade_especial for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- disponibilidade_override
drop policy if exists "auth_all_disp_override" on public.disponibilidade_override;
create policy "auth_all_disp_override"
  on public.disponibilidade_override for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- configuracoes
drop policy if exists "auth_all_configuracoes" on public.configuracoes;
create policy "auth_all_configuracoes"
  on public.configuracoes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
