create table if not exists configuracoes (
  chave         text        primary key,
  valor         jsonb       not null,
  atualizado_em timestamptz default now()
);

alter table configuracoes enable row level security;

-- Leitura pública (o site precisa ler os descontos via anon key)
create policy "leitura_publica"
  on configuracoes
  for select
  using (true);

-- Escrita aberta (dashboard usa anon key sem auth formal)
create policy "escrita_admin"
  on configuracoes
  for all
  using (true)
  with check (true);

-- Garante que o papel anon tem acesso à tabela via Data API
grant select, insert, update, delete on configuracoes to anon;
