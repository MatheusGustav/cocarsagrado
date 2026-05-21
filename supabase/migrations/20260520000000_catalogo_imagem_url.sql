-- ============================================================
-- Migration: Catálogo de leituras — coluna imagem_url + bucket Storage
-- ============================================================

-- 1) Coluna imagem_url em tipos_leitura
alter table public.tipos_leitura
  add column if not exists imagem_url text;

-- 2) Bucket público "catalogo" no Storage
insert into storage.buckets (id, name, public)
values ('catalogo', 'catalogo', true)
on conflict (id) do update set public = true;

-- 3) Policies do bucket
drop policy if exists "catalogo_select_public"  on storage.objects;
drop policy if exists "catalogo_insert_admin"   on storage.objects;
drop policy if exists "catalogo_update_admin"   on storage.objects;
drop policy if exists "catalogo_delete_admin"   on storage.objects;

-- Leitura pública (anon e authenticated)
create policy "catalogo_select_public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'catalogo');

-- Upload restrito a admin autenticado
create policy "catalogo_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'catalogo' and public.is_admin());

create policy "catalogo_update_admin"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'catalogo' and public.is_admin())
  with check (bucket_id = 'catalogo' and public.is_admin());

create policy "catalogo_delete_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'catalogo' and public.is_admin());
