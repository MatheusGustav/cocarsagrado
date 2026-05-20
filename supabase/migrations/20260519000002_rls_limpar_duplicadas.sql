-- ============================================================
-- Migration: Remove todas as políticas authenticated duplicadas
-- e recria apenas as restritas por is_admin()
-- ============================================================

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and 'authenticated'::name = any(roles)
      and tablename in (
        'tipos_leitura',
        'horarios_disponiveis',
        'agendamentos',
        'disponibilidade_especial',
        'disponibilidade_override',
        'configuracoes'
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

create policy "auth_all_tipos"
  on public.tipos_leitura for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "auth_all_horarios"
  on public.horarios_disponiveis for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "auth_all_agendamentos"
  on public.agendamentos for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "auth_all_disp_especial"
  on public.disponibilidade_especial for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "auth_all_disp_override"
  on public.disponibilidade_override for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "auth_all_configuracoes"
  on public.configuracoes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
