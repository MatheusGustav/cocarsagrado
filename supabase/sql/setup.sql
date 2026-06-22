-- ============================================================
-- COCAR SAGRADO — Setup completo do banco (Supabase)
-- Reset total + criação. Rode no SQL Editor.
-- ============================================================

-- Extensões usadas pelas tabelas de disponibilidade
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- DROP em ordem (respeita FKs)
DROP TRIGGER IF EXISTS trg_desconto_primeiro_cliente ON public.agendamentos;
DROP FUNCTION IF EXISTS public.validar_desconto_primeiro_cliente();
DROP TABLE IF EXISTS public.agendamentos             CASCADE;
DROP TABLE IF EXISTS public.pedidos                  CASCADE;
DROP TABLE IF EXISTS public.bloqueios_horario        CASCADE;
DROP TABLE IF EXISTS public.disponibilidade_especial CASCADE;
DROP TABLE IF EXISTS public.disponibilidade_override CASCADE;
DROP TABLE IF EXISTS public.horarios_disponiveis     CASCADE;
DROP TABLE IF EXISTS public.tipos_leitura            CASCADE;

-- ============================================================
-- 0) FUNÇÕES BASE (usadas por policies e triggers abaixo)
-- ============================================================

-- Define quem é admin: a RLS de authenticated em todas as tabelas
-- usa is_admin(). Apenas estes e-mails têm acesso pleno ao painel.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.email() IN (
    'cocarsagrado@gmail.com'
    -- adicione outros e-mails de admin aqui se necessário
  );
$$;

-- Só authenticated executa (policies RLS rodam como o role consultante)
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Atualiza updated_at em UPDATE (disponibilidade_especial/override).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 1) TIPOS DE LEITURA (catálogo de serviços)
-- ============================================================
CREATE TABLE public.tipos_leitura (
  id              BIGSERIAL PRIMARY KEY,
  nome            TEXT    NOT NULL,
  descricao       TEXT,
  preco_original  NUMERIC(10,2) NOT NULL CHECK (preco_original >= 0),
  imagem_url      TEXT,
  slug            TEXT,
  grupo_slug      TEXT,
  tier_label      TEXT,
  terapeuta       TEXT    CHECK (terapeuta IN ('matheus','camila')),
  ordem           INTEGER NOT NULL DEFAULT 100,
  requer_pergunta BOOLEAN NOT NULL DEFAULT FALSE,
  num_perguntas   INTEGER NOT NULL DEFAULT 0 CHECK (num_perguntas >= 0 AND num_perguntas <= 20),
  especial        BOOLEAN NOT NULL DEFAULT FALSE,
  badge           TEXT    CHECK (badge IS NULL OR badge IN ('buzios', 'cartas', 'radiestesia')),
  modalidade      TEXT    NOT NULL DEFAULT 'mensagem' CHECK (modalidade IN ('mensagem', 'video', 'audio')),
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_tipos_leitura_slug ON public.tipos_leitura (slug) WHERE slug IS NOT NULL;

INSERT INTO public.tipos_leitura (nome, descricao, preco_original) VALUES
  ('Conselho',                          'Conselho geral em relação aos caminhos do consulente com aprofundamento breve.',                                     20.00),
  ('Amarração de Igbo – 1 pergunta',    'Jogo de búzios focado em uma questão específica para cada pergunta, com orientação direta e precisa dos orixás.', 30.00),
  ('Amarração de Igbo – 2 perguntas',   'Jogo de búzios focado em uma questão específica para cada pergunta, com orientação direta e precisa dos orixás.', 50.00),
  ('Amarração de Igbo – 3 perguntas',   'Jogo de búzios focado em uma questão específica para cada pergunta, com orientação direta e precisa dos orixás.', 70.00),
  ('Combo + 10',                        'Leitura feita com aprofundamento máximo nas questões apresentadas pelo consulente.',                                150.00),
  ('Mesa Cigana Avulsa – 1 pergunta',  'Consulta pelo baralho cigano, com respostas e orientação para determinadas questões de sua vida.',                  30.00),
  ('Mesa Cigana Avulsa – 2 perguntas', 'Consulta pelo baralho cigano, com respostas e orientação para determinadas questões de sua vida.',                  50.00),
  ('Mesa Cigana Avulsa – 3 perguntas', 'Consulta pelo baralho cigano, com respostas e orientação para determinadas questões de sua vida.',                  70.00),
  ('Consulta Ao Vivo',                 'Sessão ao vivo por videochamada com duração de uma hora. Espaço aberto para o consulente explorar todas as questões em tempo real.', 200.00),
  ('Mesa Cigana Completa',             'Consulta feita através do baralho cigano te orientando em todos as áreas da sua vida.',                             150.00),
  ('Confirmação de Orixás',            'Identificação de seus orixás + explicação detalhada sobre os conceitos e como cada orixá age em sua vida.',         50.00),
  ('Confirmação de Exu',               'Confirmação de Exu ou pombagira, com orientação detalhada por escrito através de documento + áudio explicativo. Atenção: caso a entidade não queira responder o valor é estornado.', 70.00),
  ('Cabala de Odu',                    'Leitura cabalística dos odus vão falar sobre sua personalidade, pontos de atenção na area da saude, por onde ganha na vida, por onde perde, quais condutas evitar, quizilias e assim por diante.', 50.00),
  ('Águas de Oxum',                    'Leitura com enfoque completo no amoroso. São vistos: pensamentos, sentimentos, intenções e caminhos.',              50.00),
  ('Rosa de Vênus',                    'Leitura com enfoque no autoconhecimento. São vistos: caminhos de forma ampla e como melhora-los.',                  55.00),
  ('Leitura dos Mentores',             'Descrição do guia mais próximo de você e dos seus caminhos com mensagens dele(a).',                                 50.00),
  ('Mesa Mediúnica',                   'Leitura do seu campo espiritual, apontando suas mediunidade e parapsiquismos.',                                     70.00),
  ('Mesa Radiônica',                   'Leitura do seu campo espiritual completa. Utilização de ressonâncias para fins de equilibrio dos campos sutis. Esta leitura conta com documento com orientações por escrito + audio explicativo.', 222.00),
  ('Registros Akáshicos',              'Acesso aos registros da alma para compreender padrões, missão de vida e bloqueios energéticos profundos.',          188.00),
  ('Theta Healing',                    'Técnica de meditação profunda para reprogramar crenças limitantes e acessar o estado theta de cura.',               150.00);

-- ============================================================
-- 2) HORÁRIOS DISPONÍVEIS (agenda por terapeuta + dia da semana)
-- ============================================================
CREATE TABLE public.horarios_disponiveis (
  id          BIGSERIAL PRIMARY KEY,
  terapeuta   TEXT    NOT NULL CHECK (terapeuta IN ('matheus', 'camila')),
  dia_semana  INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0=Dom ... 6=Sáb
  hora_inicio TIME    NOT NULL,
  hora_fim    TIME    NOT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hora_inicio < hora_fim)
);
CREATE INDEX idx_horarios_terapeuta_dia
  ON public.horarios_disponiveis (terapeuta, dia_semana);

-- Faixas iniciais (Seg–Sex 09:00–18:00 para ambos terapeutas)
INSERT INTO public.horarios_disponiveis (terapeuta, dia_semana, hora_inicio, hora_fim) VALUES
  ('matheus', 1, '09:00', '18:00'),
  ('matheus', 2, '09:00', '18:00'),
  ('matheus', 3, '09:00', '18:00'),
  ('matheus', 4, '09:00', '18:00'),
  ('matheus', 5, '09:00', '18:00'),
  ('camila',  1, '09:00', '18:00'),
  ('camila',  2, '09:00', '18:00'),
  ('camila',  3, '09:00', '18:00'),
  ('camila',  4, '09:00', '18:00'),
  ('camila',  5, '09:00', '18:00');

-- ============================================================
-- 2.1) BLOQUEIOS DE HORÁRIO
--      Faixas pontuais bloqueadas na agenda (folga, evento, etc).
-- ============================================================
CREATE TABLE public.bloqueios_horario (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  data_bloqueio DATE NOT NULL,
  hora_inicio   TIME NOT NULL,
  hora_fim      TIME NOT NULL,
  motivo        TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Não exposta ao público (anon). Admin gerencia pelo painel.
ALTER TABLE public.bloqueios_horario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_admin_bloqueios" ON public.bloqueios_horario;
CREATE POLICY "auth_admin_bloqueios" ON public.bloqueios_horario
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- 2.2) DISPONIBILIDADE ESPECIAL (vagas extras por data/profissional)
--      Datas avulsas com nº de vagas; vagas_restantes decrementa a
--      cada agendamento especial (trigger em agendamentos) e é
--      devolvida no cancelamento (RPC incrementar_vagas_restantes).
-- ============================================================
CREATE TABLE public.disponibilidade_especial (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional    TEXT NOT NULL CHECK (profissional IN ('camila','matheus')),
  data            DATE NOT NULL,
  vagas_total     INTEGER NOT NULL DEFAULT 1 CHECK (vagas_total >= 0),
  vagas_restantes INTEGER NOT NULL CHECK (vagas_restantes >= 0),
  ate_horario     TIME NOT NULL DEFAULT '18:00:00',
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profissional, data),
  CHECK (vagas_restantes <= vagas_total)
);
CREATE INDEX idx_disp_especial_prof ON public.disponibilidade_especial (profissional);
CREATE INDEX idx_disp_especial_data ON public.disponibilidade_especial (data);

CREATE TRIGGER trg_disp_especial_updated
  BEFORE UPDATE ON public.disponibilidade_especial
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.disponibilidade_especial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_disp_especial" ON public.disponibilidade_especial;
CREATE POLICY "anon_select_disp_especial" ON public.disponibilidade_especial
  FOR SELECT TO anon USING (TRUE);

DROP POLICY IF EXISTS "auth_admin_disp_especial" ON public.disponibilidade_especial;
CREATE POLICY "auth_admin_disp_especial" ON public.disponibilidade_especial
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Devolve 1 vaga (até o total) ao cancelar/apagar um agendamento
-- especial. Chamada pelo painel admin (admin-system.js).
-- Só authenticated executa (anon revogado — segurança).
CREATE OR REPLACE FUNCTION public.incrementar_vagas_restantes(p_profissional text, p_data date)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.disponibilidade_especial
  SET vagas_restantes = least(vagas_restantes + 1, vagas_total)
  WHERE profissional = p_profissional
    AND data = p_data;
END;
$$;

REVOKE ALL ON FUNCTION public.incrementar_vagas_restantes(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.incrementar_vagas_restantes(text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.incrementar_vagas_restantes(text, date) TO authenticated;

-- ============================================================
-- 2.3) DISPONIBILIDADE OVERRIDE (ajuste de vagas que sobrepõe o padrão)
-- ============================================================
CREATE TABLE public.disponibilidade_override (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional    TEXT NOT NULL CHECK (profissional IN ('camila','matheus')),
  data            DATE NOT NULL,
  vagas_total     INTEGER NOT NULL CHECK (vagas_total >= 0),
  vagas_restantes INTEGER NOT NULL CHECK (vagas_restantes >= 0),
  ate_horario     TIME NOT NULL,
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profissional, data),
  CHECK (vagas_restantes <= vagas_total)
);
CREATE INDEX idx_disp_override_prof ON public.disponibilidade_override (profissional);
CREATE INDEX idx_disp_override_data ON public.disponibilidade_override (data);

CREATE TRIGGER trg_disp_override_updated
  BEFORE UPDATE ON public.disponibilidade_override
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.disponibilidade_override ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_disp_override" ON public.disponibilidade_override;
CREATE POLICY "anon_select_disp_override" ON public.disponibilidade_override
  FOR SELECT TO anon USING (TRUE);

DROP POLICY IF EXISTS "auth_admin_disp_override" ON public.disponibilidade_override;
CREATE POLICY "auth_admin_disp_override" ON public.disponibilidade_override
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- 3) PEDIDOS (pai — 1 pedido pode ter 1 a 4 leituras)
-- ============================================================
CREATE TABLE public.pedidos (
  id                  BIGSERIAL PRIMARY KEY,
  chave_pedido        TEXT NOT NULL UNIQUE,
  cliente_nome        TEXT NOT NULL,
  cliente_nascimento  DATE,
  cliente_whatsapp    TEXT NOT NULL,
  cliente_email       TEXT,
  valor_total         NUMERIC(10,2) NOT NULL CHECK (valor_total >= 0),
  aceitou_desconto_10 BOOLEAN NOT NULL DEFAULT FALSE,
  cupom_codigo        TEXT,
  cupom_desconto      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cupom_desconto >= 0),
  status              TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','pago','cancelado')),
  metodo_pagamento    TEXT,
  txid                TEXT,
  pago_em             TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pedidos_chave     ON public.pedidos (chave_pedido);
CREATE INDEX idx_pedidos_status    ON public.pedidos (status);
CREATE INDEX idx_pedidos_whatsapp  ON public.pedidos (regexp_replace(cliente_whatsapp, '\D', '', 'g'));

-- ============================================================
-- 4) AGENDAMENTOS (filho — N por pedido)
-- ============================================================
CREATE TABLE public.agendamentos (
  id                  BIGSERIAL PRIMARY KEY,
  chave_pedido        TEXT NOT NULL,
  pedido_id           BIGINT REFERENCES public.pedidos(id) ON DELETE CASCADE,
  tipo_leitura_id     BIGINT NOT NULL REFERENCES public.tipos_leitura(id) ON DELETE RESTRICT,
  terapeuta           TEXT CHECK (terapeuta IN ('matheus', 'camila')),
  cliente_nome        TEXT NOT NULL,
  cliente_nascimento  DATE,
  cliente_whatsapp    TEXT NOT NULL,
  cliente_email       TEXT,
  cliente_observacoes TEXT,
  data_agendamento    DATE NOT NULL,
  hora_agendamento    TIME NOT NULL,
  valor_original      NUMERIC(10,2) NOT NULL CHECK (valor_original >= 0),
  desconto_aplicado   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (desconto_aplicado >= 0),
  valor_final         NUMERIC(10,2) NOT NULL CHECK (valor_final >= 0),
  aceitou_desconto_10 BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','pago','confirmado','atendido','cancelado')),
  txid                TEXT,
  metodo_pagamento    TEXT,
  agendamento_especial BOOLEAN NOT NULL DEFAULT FALSE,
  pago_em             TIMESTAMPTZ,
  atendido_em         TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agend_data_hora     ON public.agendamentos (data_agendamento, hora_agendamento);
CREATE INDEX idx_agend_status        ON public.agendamentos (status);
CREATE INDEX idx_agend_terapeuta     ON public.agendamentos (terapeuta);
CREATE INDEX idx_agend_chave         ON public.agendamentos (chave_pedido);
CREATE INDEX idx_agend_pedido_id     ON public.agendamentos (pedido_id);
CREATE INDEX idx_agend_whatsapp_norm ON public.agendamentos (regexp_replace(cliente_whatsapp, '\D', '', 'g'));

-- Agendamento especial: decrementa vaga em disponibilidade_especial de
-- forma atômica (FOR UPDATE) e bloqueia o INSERT se não houver vaga.
CREATE OR REPLACE FUNCTION public.decrementar_vaga_especial_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restantes INTEGER;
BEGIN
  IF NEW.agendamento_especial IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.terapeuta IS NULL OR NEW.data_agendamento IS NULL THEN
    RAISE EXCEPTION 'Agendamento especial exige terapeuta e data';
  END IF;

  SELECT vagas_restantes INTO v_restantes
  FROM public.disponibilidade_especial
  WHERE profissional = NEW.terapeuta
    AND data = NEW.data_agendamento
  FOR UPDATE;

  IF v_restantes IS NULL THEN
    RAISE EXCEPTION 'Disponibilidade especial não encontrada para % em %',
      NEW.terapeuta, NEW.data_agendamento;
  END IF;

  IF v_restantes <= 0 THEN
    RAISE EXCEPTION 'Sem vagas disponíveis para % em %',
      NEW.terapeuta, NEW.data_agendamento;
  END IF;

  UPDATE public.disponibilidade_especial
  SET vagas_restantes = vagas_restantes - 1
  WHERE profissional = NEW.terapeuta
    AND data = NEW.data_agendamento;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_decrementar_vaga_especial
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.decrementar_vaga_especial_trigger();

REVOKE ALL ON FUNCTION public.decrementar_vaga_especial_trigger() FROM PUBLIC, anon, authenticated;

-- Agendamento normal (não especial): valida vagas de disponibilidade_override
-- de forma atômica (FOR UPDATE serializa INSERTs concorrentes) — anti-overbooking.
CREATE OR REPLACE FUNCTION public.validar_vaga_normal_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total  INTEGER;
  v_ativo  BOOLEAN;
  v_usadas INTEGER;
BEGIN
  IF NEW.agendamento_especial IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.terapeuta IS NULL OR NEW.data_agendamento IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT vagas_total, ativo INTO v_total, v_ativo
  FROM public.disponibilidade_override
  WHERE profissional = NEW.terapeuta
    AND data = NEW.data_agendamento
  FOR UPDATE;

  IF v_total IS NULL OR v_ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem vagas disponíveis para % em %',
      NEW.terapeuta, NEW.data_agendamento;
  END IF;

  SELECT count(*) INTO v_usadas
  FROM public.agendamentos
  WHERE terapeuta = NEW.terapeuta
    AND data_agendamento = NEW.data_agendamento
    AND agendamento_especial IS NOT TRUE
    AND status IN ('pendente', 'pago', 'confirmado', 'atendido');

  IF v_usadas >= v_total THEN
    RAISE EXCEPTION 'Sem vagas disponíveis para % em %',
      NEW.terapeuta, NEW.data_agendamento;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_vaga_normal
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_vaga_normal_trigger();

REVOKE ALL ON FUNCTION public.validar_vaga_normal_trigger() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5) RLS — modelo limpo
--    anon  -> SELECT no catálogo/disponibilidade + INSERT agendamentos.
--             Mutações sensíveis só via RPC security definer.
--    admin -> authenticated ALL via is_admin() (e-mail do painel).
-- ============================================================
ALTER TABLE public.pedidos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_leitura         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horarios_disponiveis  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agendamentos          ENABLE ROW LEVEL SECURITY;

-- tipos_leitura (catálogo público; admin edita)
DROP POLICY IF EXISTS "anon_select_tipos" ON public.tipos_leitura;
CREATE POLICY "anon_select_tipos" ON public.tipos_leitura
  FOR SELECT TO anon USING (TRUE);

DROP POLICY IF EXISTS "auth_admin_tipos" ON public.tipos_leitura;
CREATE POLICY "auth_admin_tipos" ON public.tipos_leitura
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- horarios_disponiveis (anon SÓ lê a disponibilidade; admin gerencia)
DROP POLICY IF EXISTS "anon_select_horarios" ON public.horarios_disponiveis;
CREATE POLICY "anon_select_horarios" ON public.horarios_disponiveis
  FOR SELECT TO anon USING (TRUE);

DROP POLICY IF EXISTS "auth_admin_horarios" ON public.horarios_disponiveis;
CREATE POLICY "auth_admin_horarios" ON public.horarios_disponiveis
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- agendamentos — anon SÓ pode INSERT (criar agendamento novo).
-- SELECT/UPDATE/DELETE bloqueados: clientes não leem nem alteram
-- agendamentos de outras pessoas. Frontend usa RPCs security definer
-- (chave_pedido_existe, contar_agendamentos_por_data). Admin = is_admin().
DROP POLICY IF EXISTS "anon_select_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_insert_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_update_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_delete_agend" ON public.agendamentos;

CREATE POLICY "anon_insert_agend" ON public.agendamentos
  FOR INSERT TO anon WITH CHECK (TRUE);

DROP POLICY IF EXISTS "auth_admin_agend" ON public.agendamentos;
CREATE POLICY "auth_admin_agend" ON public.agendamentos
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- RPCs públicas que substituem o SELECT direto

-- chave_pedido_existe: verifica em pedidos (chave é gerada no pai)
CREATE OR REPLACE FUNCTION public.chave_pedido_existe(p_chave text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pedidos WHERE chave_pedido = p_chave
  );
$$;

-- pedido_status: retorna o status do pedido (usado pelo polling do frontend)
CREATE OR REPLACE FUNCTION public.pedido_status(p_chave text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT status FROM public.pedidos WHERE chave_pedido = p_chave;
$$;

CREATE OR REPLACE FUNCTION public.contar_agendamentos_por_data(
  p_terapeuta text,
  p_inicio    date,
  p_fim       date
)
RETURNS TABLE (data_agendamento date, total bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT data_agendamento, count(*)::bigint AS total
  FROM public.agendamentos
  WHERE terapeuta = p_terapeuta
    AND data_agendamento BETWEEN p_inicio AND p_fim
    AND status IN ('pago','confirmado','atendido','pendente')
  GROUP BY data_agendamento;
$$;

-- leitura_mais_procurada: service_id ('grupo:<slug>' | slug | 'id-<id>') da
-- leitura com mais agendamentos pagos nos últimos 180 dias. Usada pelo site
-- para o destaque "Mais procurada" no catálogo (só identificador agregado).
CREATE OR REPLACE FUNCTION public.leitura_mais_procurada()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
           WHEN t.grupo_slug IS NOT NULL THEN 'grupo:' || t.grupo_slug
           WHEN t.slug IS NOT NULL THEN t.slug
           ELSE 'id-' || t.id::text
         END AS service_id
  FROM public.agendamentos a
  JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
  WHERE a.status IN ('pago', 'confirmado', 'atendido')
    AND a.criado_em >= now() - interval '180 days'
  GROUP BY service_id
  ORDER BY count(*) DESC, service_id
  LIMIT 1;
$$;

-- catalogo_ranking: ordem dos serviços por demanda (agendamentos pagos),
-- SEM totais — volume de vendas é dado interno; anon só vê a ordem.
CREATE OR REPLACE FUNCTION public.catalogo_ranking()
RETURNS TABLE (service_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
           WHEN t.grupo_slug IS NOT NULL THEN 'grupo:' || t.grupo_slug
           WHEN t.slug IS NOT NULL THEN t.slug
           ELSE 'id-' || t.id::text
         END AS service_id
  FROM public.agendamentos a
  JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
  WHERE a.status IN ('pago', 'confirmado', 'atendido')
  GROUP BY service_id
  ORDER BY count(*) DESC, service_id;
$$;

GRANT EXECUTE ON FUNCTION public.chave_pedido_existe(text) TO anon;
GRANT EXECUTE ON FUNCTION public.pedido_status(text) TO anon;
GRANT EXECUTE ON FUNCTION public.contar_agendamentos_por_data(text, date, date) TO anon;
GRANT EXECUTE ON FUNCTION public.leitura_mais_procurada() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_ranking() TO anon, authenticated;

-- confirmar_pedido_pago: atualização atômica (pai + filhos) chamada pelo
-- webhook do Mercado Pago (service_role). NUNCA exposta ao anon.
CREATE OR REPLACE FUNCTION public.confirmar_pedido_pago(p_chave text, p_metodo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  SELECT id INTO v_id
  FROM public.pedidos
  WHERE chave_pedido = p_chave
    AND status = 'pendente'
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.pedidos
  SET status = 'pago', pago_em = NOW(), metodo_pagamento = p_metodo
  WHERE id = v_id;

  UPDATE public.agendamentos
  SET status = 'pago', pago_em = NOW(), metodo_pagamento = p_metodo
  WHERE pedido_id = v_id
    AND status = 'pendente';

  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.confirmar_pedido_pago(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_pago(text, text) TO service_role;

-- criar_pedido: cria pedido pai + N agendamentos filhos numa transação só.
-- SECURITY DEFINER porque anon não tem SELECT/DELETE em pedidos (LGPD).
-- Triggers BEFORE INSERT de agendamentos rodam por linha; se algum RAISE,
-- a transação inteira faz rollback.
-- Validações server-side: 1–4 itens; tipo ativo + terapeuta confere;
-- valor_original = preco_original × qty (1–5; especial = 1); desconto
-- máximo = promoção ativa do serviço; valor_total = soma dos valor_final.
CREATE OR REPLACE FUNCTION public.criar_pedido(
  p_chave        text,
  p_nome         text,
  p_nascimento   date,
  p_whatsapp     text,
  p_email        text,
  p_valor_total  numeric,
  p_itens        jsonb,
  p_cupom_codigo text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id      bigint;
  v_item           jsonb;
  v_n              integer;
  v_tipo           public.tipos_leitura%ROWTYPE;
  v_valor_original numeric;
  v_desconto       numeric;
  v_valor_final    numeric;
  v_qty            numeric;
  v_promo_pct      numeric;
  v_min_final      numeric;
  v_soma           numeric := 0;
  v_cfg            jsonb;
  v_cupom_cod      text;
  v_cupom_val      numeric := 0;
  v_cupom_desc     numeric := 0;
  v_ag_id          bigint;
  v_ids            bigint[]  := '{}';
  v_vals           numeric[] := '{}';
  v_i              integer;
  v_share_cents    numeric;
  v_resto_cents    numeric;
BEGIN
  v_n := COALESCE(jsonb_array_length(p_itens), 0);
  IF v_n < 1 OR v_n > 4 THEN
    RAISE EXCEPTION 'pedido_invalido: o pedido deve ter entre 1 e 4 leituras';
  END IF;

  SELECT valor INTO v_cfg FROM public.configuracoes WHERE chave = 'descontos';

  -- Cupom (R$ fixo no total). Valida cedo pra falhar antes de inserir.
  v_cupom_cod := NULLIF(upper(trim(COALESCE(p_cupom_codigo, ''))), '');
  IF v_cupom_cod IS NOT NULL THEN
    SELECT valor_desconto INTO v_cupom_val
    FROM public.cupons
    WHERE upper(codigo) = v_cupom_cod
      AND ativo = TRUE;
    IF v_cupom_val IS NULL THEN
      RAISE EXCEPTION 'pedido_invalido: cupom inválido ou inativo';
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, status, cupom_codigo
  ) VALUES (
    p_chave, p_nome, p_nascimento, p_whatsapp,
    p_email, p_valor_total, 'pendente', v_cupom_cod
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    SELECT * INTO v_tipo
    FROM public.tipos_leitura
    WHERE id = (v_item->>'tipo_leitura_id')::bigint
      AND ativo = TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pedido_invalido: leitura inexistente ou inativa';
    END IF;
    IF v_tipo.terapeuta IS DISTINCT FROM (v_item->>'terapeuta') THEN
      RAISE EXCEPTION 'pedido_invalido: terapeuta não confere com o catálogo';
    END IF;

    v_valor_original := COALESCE((v_item->>'valor_original')::numeric, -1);
    v_desconto       := COALESCE((v_item->>'desconto_aplicado')::numeric, 0);
    v_valor_final    := COALESCE((v_item->>'valor_final')::numeric, -1);

    -- valor_original deve ser múltiplo do preço do catálogo (qty 1–5; especial = 1)
    IF v_tipo.preco_original = 0 THEN
      IF v_valor_original <> 0 THEN
        RAISE EXCEPTION 'pedido_invalido: valor não confere com o catálogo';
      END IF;
    ELSE
      v_qty := v_valor_original / v_tipo.preco_original;
      IF v_qty <> trunc(v_qty) OR v_qty < 1 OR v_qty > 5
         OR (v_tipo.especial AND v_qty <> 1) THEN
        RAISE EXCEPTION 'pedido_invalido: valor não confere com o catálogo';
      END IF;
    END IF;

    -- Percentual de promoção ativa do serviço (id salvo = slug ou grupo_slug)
    v_promo_pct := 0;
    IF v_cfg IS NOT NULL THEN
      SELECT COALESCE(max((p->>'percentualDesconto')::numeric), 0) INTO v_promo_pct
      FROM jsonb_array_elements(COALESCE(v_cfg->'promocoes', '[]'::jsonb)) AS p
      WHERE COALESCE((p->>'descontoAtivo')::boolean, FALSE)
        AND p->>'id' IN (v_tipo.slug, v_tipo.grupo_slug);
    END IF;

    -- Único desconto possível agora: promoção ativa do serviço.
    v_min_final := round(v_valor_original * (100 - v_promo_pct) / 100, 2);

    IF v_valor_final < v_min_final - 0.01
       OR v_valor_final > v_valor_original
       OR abs(v_valor_final - (v_valor_original - v_desconto)) > 0.01 THEN
      RAISE EXCEPTION 'pedido_invalido: desconto acima do permitido';
    END IF;

    v_soma := v_soma + v_valor_final;

    INSERT INTO public.agendamentos (
      chave_pedido, pedido_id, tipo_leitura_id, terapeuta,
      cliente_nome, cliente_nascimento, cliente_whatsapp, cliente_email,
      cliente_observacoes, data_agendamento, hora_agendamento,
      valor_original, desconto_aplicado, valor_final,
      agendamento_especial, status
    ) VALUES (
      p_chave,
      v_pedido_id,
      v_tipo.id,
      v_item->>'terapeuta',
      p_nome, p_nascimento, p_whatsapp, p_email,
      v_item->>'observacoes',
      (v_item->>'data')::date,
      (v_item->>'horario')::time,
      v_valor_original,
      v_desconto,
      v_valor_final,
      v_tipo.especial,  -- vem do catálogo, não do cliente (impede burlar a trava de vagas)
      'pendente'
    )
    RETURNING id INTO v_ag_id;

    v_ids  := array_append(v_ids, v_ag_id);
    v_vals := array_append(v_vals, v_valor_final);
  END LOOP;

  -- Cupom: nunca passa do total das leituras.
  v_cupom_desc := least(v_cupom_val, v_soma);

  IF abs(p_valor_total - (v_soma - v_cupom_desc)) > 0.05 THEN
    RAISE EXCEPTION 'pedido_invalido: total não confere com a soma das leituras';
  END IF;

  -- Distribui o desconto do cupom entre os filhos (proporcional, em centavos),
  -- para que cada agendamento.valor_final reflita o valor REALMENTE cobrado.
  -- Mantém pedido.valor_total = soma(valor_final) e os relatórios corretos.
  IF v_cupom_desc > 0 AND v_soma > 0 THEN
    v_resto_cents := round(v_cupom_desc * 100);
    FOR v_i IN 1 .. array_length(v_ids, 1) LOOP
      IF v_i = array_length(v_ids, 1) THEN
        v_share_cents := least(v_resto_cents, round(v_vals[v_i] * 100));
      ELSE
        v_share_cents := floor(round(v_cupom_desc * 100) * round(v_vals[v_i] * 100)
                               / round(v_soma * 100));
        v_resto_cents := v_resto_cents - v_share_cents;
      END IF;
      IF v_share_cents > 0 THEN
        UPDATE public.agendamentos
        SET desconto_aplicado = desconto_aplicado + v_share_cents / 100.0,
            valor_final       = valor_final       - v_share_cents / 100.0
        WHERE id = v_ids[v_i];
      END IF;
    END LOOP;
  END IF;

  UPDATE public.pedidos
  SET cupom_desconto = v_cupom_desc
  WHERE id = v_pedido_id;

  RETURN p_chave;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_pedido(text, text, date, text, text, numeric, jsonb, text) TO anon;

-- pedidos — anon SÓ INSERT (criar pedido). SELECT bloqueado (LGPD).
-- authenticated admin ALL via is_admin().
DROP POLICY IF EXISTS "anon_insert_pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "auth_admin_pedidos" ON public.pedidos;

CREATE POLICY "anon_insert_pedidos" ON public.pedidos
  FOR INSERT TO anon WITH CHECK (TRUE);

CREATE POLICY "auth_admin_pedidos" ON public.pedidos
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- 8) CONFIGURAÇÕES (descontos, flags, etc)
-- ============================================================
-- Log de webhooks de pagamento: cada chamada da InfinitePay registrada
-- com o resultado — diagnóstico de pedidos presos em "pendente".
-- Escrita só via service_role (edge function); leitura só admin.
CREATE TABLE IF NOT EXISTS public.webhook_log (
  id        BIGSERIAL PRIMARY KEY,
  chave     TEXT,
  resultado TEXT NOT NULL,   -- confirmado | rejeitado | ignorado | erro | telegram_erro
  detalhe   TEXT,
  payload   JSONB,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_chave ON public.webhook_log (chave);
CREATE INDEX IF NOT EXISTS idx_webhook_log_criado ON public.webhook_log (criado_em DESC);

ALTER TABLE public.webhook_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_le_webhook_log" ON public.webhook_log;
CREATE POLICY "admin_le_webhook_log" ON public.webhook_log
  FOR SELECT TO authenticated USING (is_admin());

-- Lançamentos financeiros manuais (trabalhos espirituais e avulsos):
-- somados ao faturamento do painel admin. Valor pode ser negativo
-- (despesa). Acesso restrito a admin autenticado.
CREATE TABLE IF NOT EXISTS public.lancamentos_financeiros (
  id        BIGSERIAL PRIMARY KEY,
  data      DATE NOT NULL DEFAULT CURRENT_DATE,
  descricao TEXT NOT NULL,
  valor     NUMERIC(10,2) NOT NULL CHECK (valor <> 0),
  categoria TEXT NOT NULL DEFAULT 'trabalho' CHECK (categoria IN ('trabalho', 'outro', 'despesa')),
  terapeuta TEXT CHECK (terapeuta IS NULL OR terapeuta IN ('matheus', 'camila')),  -- NULL = Geral
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lanc_fin_data ON public.lancamentos_financeiros (data);

ALTER TABLE public.lancamentos_financeiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_lancamentos" ON public.lancamentos_financeiros;
CREATE POLICY "admin_lancamentos" ON public.lancamentos_financeiros
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE TABLE IF NOT EXISTS public.configuracoes (
  chave       TEXT    PRIMARY KEY,
  valor       JSONB   NOT NULL DEFAULT '{}',
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_config" ON public.configuracoes;
DROP POLICY IF EXISTS "anon_upsert_config" ON public.configuracoes;
DROP POLICY IF EXISTS "auth_all_config" ON public.configuracoes;
DROP POLICY IF EXISTS "auth_admin_config" ON public.configuracoes;

CREATE POLICY "anon_select_config" ON public.configuracoes
  FOR SELECT TO anon USING (TRUE);

CREATE POLICY "auth_admin_config" ON public.configuracoes
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- 8b) CUPONS (desconto R$ fixo no total — comunidade do WhatsApp)
-- ============================================================
-- anon NÃO lê a tabela (evita enumerar códigos); valida via RPC validar_cupom.
-- criar_pedido revalida o cupom server-side. Não acumula com promoção.
CREATE TABLE IF NOT EXISTS public.cupons (
  codigo         TEXT PRIMARY KEY,                      -- sempre em CAIXA ALTA
  valor_desconto NUMERIC(10,2) NOT NULL CHECK (valor_desconto > 0),
  descricao      TEXT,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_admin_cupons" ON public.cupons;
CREATE POLICY "auth_admin_cupons" ON public.cupons
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- validar_cupom: anon checa um código e recebe só {valido, valor_desconto}.
CREATE OR REPLACE FUNCTION public.validar_cupom(p_codigo text)
RETURNS TABLE(valido boolean, valor_desconto numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v numeric;
BEGIN
  SELECT c.valor_desconto INTO v
  FROM public.cupons c
  WHERE upper(c.codigo) = upper(trim(p_codigo))
    AND c.ativo = TRUE;

  IF v IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::numeric;
  ELSE
    RETURN QUERY SELECT TRUE, v;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom(text) TO anon, authenticated;

-- ============================================================
-- 9) REALTIME — dashboard escuta as tabelas agendamentos e pedidos
--    Quando o webhook do Mercado Pago muda pendente -> pago,
--    o painel admin recebe o evento e atualiza na hora.
--    REPLICA IDENTITY FULL garante que payload.old traga o
--    status anterior (necessário para detectar pendente->pago).
--    A autorização do canal respeita a RLS: só authenticated
--    admin (auth_admin_agend / is_admin) recebe os eventos.
-- ============================================================
ALTER TABLE public.agendamentos REPLICA IDENTITY FULL;

ALTER TABLE public.pedidos REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agendamentos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agendamentos;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pedidos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos;
  END IF;
END $$;
