-- ============================================================
-- Migration: Tornar catálogo do site dinâmico
-- Adiciona colunas para classificar leituras e popula registros existentes
-- ============================================================

alter table public.tipos_leitura
  add column if not exists slug             text,
  add column if not exists terapeuta        text,
  add column if not exists ordem            integer not null default 100,
  add column if not exists requer_pergunta  boolean not null default false,
  add column if not exists especial         boolean not null default false;

-- Constraints
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tipos_leitura_terapeuta_check') then
    alter table public.tipos_leitura
      add constraint tipos_leitura_terapeuta_check check (terapeuta in ('matheus','camila'));
  end if;
end $$;

create unique index if not exists idx_tipos_leitura_slug
  on public.tipos_leitura (slug)
  where slug is not null;

-- ============================================================
-- Popular slug / terapeuta / ordem / flags dos registros existentes
-- ============================================================
update public.tipos_leitura set slug = 'conselho',                terapeuta='matheus', ordem=10  where nome = 'Conselho';
update public.tipos_leitura set slug = 'amarracao-1',             terapeuta='matheus', ordem=20, requer_pergunta=true where nome = 'Amarração de Igbo – 1 pergunta';
update public.tipos_leitura set slug = 'amarracao-2',             terapeuta='matheus', ordem=21, requer_pergunta=true where nome = 'Amarração de Igbo – 2 perguntas';
update public.tipos_leitura set slug = 'amarracao-3',             terapeuta='matheus', ordem=22, requer_pergunta=true where nome = 'Amarração de Igbo – 3 perguntas';
update public.tipos_leitura set slug = 'combo-10',                terapeuta='matheus', ordem=30, especial=true where nome = 'Combo + 10';
update public.tipos_leitura set slug = 'consulta-ao-vivo',        terapeuta='matheus', ordem=40, especial=true where nome = 'Consulta Ao Vivo';
update public.tipos_leitura set slug = 'confirmacao-orixas',      terapeuta='matheus', ordem=50  where nome = 'Confirmação de Orixás';
update public.tipos_leitura set slug = 'cabala-odu',              terapeuta='matheus', ordem=60  where nome = 'Cabala de Odu';
update public.tipos_leitura set slug = 'confirmacao-exu',         terapeuta='matheus', ordem=70  where nome = 'Confirmação de Exu';

update public.tipos_leitura set slug = 'mesa-cigana-avulsa-1',    terapeuta='camila',  ordem=110, requer_pergunta=true where nome = 'Mesa Cigana Avulsa – 1 pergunta';
update public.tipos_leitura set slug = 'mesa-cigana-avulsa-2',    terapeuta='camila',  ordem=111, requer_pergunta=true where nome = 'Mesa Cigana Avulsa – 2 perguntas';
update public.tipos_leitura set slug = 'mesa-cigana-avulsa-3',    terapeuta='camila',  ordem=112, requer_pergunta=true where nome = 'Mesa Cigana Avulsa – 3 perguntas';
update public.tipos_leitura set slug = 'mesa-cigana-completa',    terapeuta='camila',  ordem=120, especial=true where nome = 'Mesa Cigana Completa';
update public.tipos_leitura set slug = 'aguas-oxum',              terapeuta='camila',  ordem=130 where nome = 'Águas de Oxum';
update public.tipos_leitura set slug = 'rosa-venus',              terapeuta='camila',  ordem=140 where nome = 'Rosa de Vênus';
update public.tipos_leitura set slug = 'leitura-mentores',        terapeuta='camila',  ordem=150 where nome = 'Leitura dos Mentores';
update public.tipos_leitura set slug = 'mesa-mediunica',          terapeuta='camila',  ordem=160 where nome = 'Mesa Mediúnica';
update public.tipos_leitura set slug = 'mesa-radionica',          terapeuta='camila',  ordem=170, especial=true where nome = 'Mesa Radiônica';
update public.tipos_leitura set slug = 'registros-akashicos',     terapeuta='camila',  ordem=180, especial=true where nome = 'Registros Akáshicos';
update public.tipos_leitura set slug = 'theta-healing',           terapeuta='camila',  ordem=190, especial=true where nome = 'Theta Healing';

-- ============================================================
-- Mapear imagens públicas existentes para imagem_url
-- (usa caminho relativo; quando trocado pelo admin, vai pra Storage)
-- ============================================================
update public.tipos_leitura set imagem_url = 'images/conselho.webp'              where slug = 'conselho'              and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/buzios-avulso.webp'         where slug in ('amarracao-1','amarracao-2','amarracao-3') and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/combo10.webp'               where slug = 'combo-10'              and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/buzios-completo.webp'       where slug = 'consulta-ao-vivo'      and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/confirmacao-de-orixas.webp' where slug = 'confirmacao-orixas'    and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/cabala-de-odu.webp'         where slug = 'cabala-odu'            and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/confirmacao-de-exu.webp'    where slug = 'confirmacao-exu'       and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/mesa-cigana-avulsa.webp'    where slug in ('mesa-cigana-avulsa-1','mesa-cigana-avulsa-2','mesa-cigana-avulsa-3') and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/mesa-cigana-completa.webp'  where slug = 'mesa-cigana-completa'  and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/aguas-de-oxum.webp'         where slug = 'aguas-oxum'            and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/rosa-de-venus.webp'         where slug = 'rosa-venus'            and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/leitura-dos-mentores.webp'  where slug = 'leitura-mentores'      and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/mesa-mediunica.webp'        where slug = 'mesa-mediunica'        and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/mesa-radionica.webp'        where slug = 'mesa-radionica'        and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/registros-akashicos.webp'   where slug = 'registros-akashicos'   and imagem_url is null;
update public.tipos_leitura set imagem_url = 'images/theta-healing.webp'         where slug = 'theta-healing'         and imagem_url is null;
