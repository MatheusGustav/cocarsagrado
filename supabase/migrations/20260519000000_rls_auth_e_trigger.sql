-- ============================================================
-- Migration: RLS Policies com Supabase Auth + Trigger updated_at
-- ============================================================

-- 1. Função auxiliar para updated_at automático
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 2. Trigger updated_at nas tabelas que possuem a coluna
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array['disponibilidade_especial', 'disponibilidade_padrao', 'disponibilidade_override'])
  loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = tbl and column_name = 'updated_at') then
      execute format(
        'create trigger trg_%s_updated_at before update on %s
         for each row execute function public.set_updated_at()',
        tbl, tbl
      );
    end if;
  end loop;
end;
$$;

-- 3. Função para decrementar vagas_restantes (usada pelo frontend)
create or replace function public.decrementar_vagas_restantes(
  p_profissional text,
  p_data date
)
returns void as $$
begin
  update public.disponibilidade_especial
  set vagas_restantes = vagas_restantes - 1
  where profissional = p_profissional
    and data = p_data
    and vagas_restantes > 0;
end;
$$ language plpgsql;

-- 4. RLS — Remover políticas antigas (totalmente abertas)

-- tipos_leitura
drop policy if exists anon_select_tipos on public.tipos_leitura;

-- horarios_disponiveis
drop policy if exists anon_all_horarios on public.horarios_disponiveis;

-- agendamentos
drop policy if exists anon_select_agend on public.agendamentos;
drop policy if exists anon_insert_agend on public.agendamentos;
drop policy if exists anon_update_agend on public.agendamentos;
drop policy if exists anon_delete_agend on public.agendamentos;

-- disponibilidade_especial
drop policy if exists select_disp_especial on public.disponibilidade_especial;
drop policy if exists all_disp_especial on public.disponibilidade_especial;

-- disponibilidade_padrao
drop policy if exists select_disp_padrao on public.disponibilidade_padrao;
drop policy if exists all_disp_padrao on public.disponibilidade_padrao;

-- disponibilidade_override
drop policy if exists select_disp_override on public.disponibilidade_override;
drop policy if exists all_disp_override on public.disponibilidade_override;

-- configuracoes
drop policy if exists leitura_publica on public.configuracoes;
drop policy if exists escrita_admin on public.configuracoes;

-- ============================================================
-- 5. Novas Políticas — anon (público)
-- ============================================================

-- tipos_leitura: leitura pública
create policy "anon_select_tipos"
  on public.tipos_leitura for select
  to anon
  using (true);

-- horarios_disponiveis: leitura pública
create policy "anon_select_horarios"
  on public.horarios_disponiveis for select
  to anon
  using (true);

-- disponibilidade_especial: leitura pública
create policy "anon_select_disp_especial"
  on public.disponibilidade_especial for select
  to anon
  using (true);

-- disponibilidade_padrao: leitura pública
create policy "anon_select_disp_padrao"
  on public.disponibilidade_padrao for select
  to anon
  using (true);

-- disponibilidade_override: leitura pública
create policy "anon_select_disp_override"
  on public.disponibilidade_override for select
  to anon
  using (true);

-- configuracoes: leitura pública (o frontend lê descontos)
create policy "anon_select_configuracoes"
  on public.configuracoes for select
  to anon
  using (true);

-- agendamentos: INSERT (cliente agenda) e SELECT (verificar chave)
create policy "anon_insert_agendamentos"
  on public.agendamentos for insert
  to anon
  with check (true);

create policy "anon_select_agendamentos"
  on public.agendamentos for select
  to anon
  using (true);

-- ============================================================
-- 6. Novas Políticas — authenticated (admin)
-- ============================================================

-- tipos_leitura: CRUD
create policy "auth_all_tipos"
  on public.tipos_leitura for all
  to authenticated
  using (true)
  with check (true);

-- horarios_disponiveis: CRUD
create policy "auth_all_horarios"
  on public.horarios_disponiveis for all
  to authenticated
  using (true)
  with check (true);

-- agendamentos: CRUD
create policy "auth_all_agendamentos"
  on public.agendamentos for all
  to authenticated
  using (true)
  with check (true);

-- disponibilidade_especial: CRUD
create policy "auth_all_disp_especial"
  on public.disponibilidade_especial for all
  to authenticated
  using (true)
  with check (true);

-- disponibilidade_padrao: CRUD
create policy "auth_all_disp_padrao"
  on public.disponibilidade_padrao for all
  to authenticated
  using (true)
  with check (true);

-- disponibilidade_override: CRUD
create policy "auth_all_disp_override"
  on public.disponibilidade_override for all
  to authenticated
  using (true)
  with check (true);

-- configuracoes: CRUD
create policy "auth_all_configuracoes"
  on public.configuracoes for all
  to authenticated
  using (true)
  with check (true);

-- Execute a função decrementar_vagas_restantes
grant execute on function public.decrementar_vagas_restantes to anon;
