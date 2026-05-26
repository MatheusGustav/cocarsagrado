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

-- ============================================================
-- 1) TIPOS DE LEITURA (catálogo de serviços)
-- ============================================================
CREATE TABLE public.tipos_leitura (
  id              BIGSERIAL PRIMARY KEY,
  nome            TEXT    NOT NULL,
  descricao       TEXT,
  preco_original  NUMERIC(10,2) NOT NULL CHECK (preco_original >= 0),
  duracao_minutos INTEGER NOT NULL CHECK (duracao_minutos > 0),
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
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_tipos_leitura_slug ON public.tipos_leitura (slug) WHERE slug IS NOT NULL;

INSERT INTO public.tipos_leitura (nome, descricao, preco_original, duracao_minutos) VALUES
  ('Conselho',                          'Conselho geral em relação aos caminhos do consulente com aprofundamento breve.',                                     20.00, 20),
  ('Amarração de Igbo – 1 pergunta',    'Jogo de búzios focado em uma questão específica para cada pergunta, com orientação direta e precisa dos orixás.', 30.00, 20),
  ('Amarração de Igbo – 2 perguntas',   'Jogo de búzios focado em uma questão específica para cada pergunta, com orientação direta e precisa dos orixás.', 50.00, 30),
  ('Amarração de Igbo – 3 perguntas',   'Jogo de búzios focado em uma questão específica para cada pergunta, com orientação direta e precisa dos orixás.', 70.00, 40),
  ('Combo + 10',                        'Leitura feita com aprofundamento máximo nas questões apresentadas pelo consulente.',                                150.00, 60),
  ('Mesa Cigana Avulsa – 1 pergunta',  'Consulta pelo baralho cigano, com respostas e orientação para determinadas questões de sua vida.',                  30.00, 20),
  ('Mesa Cigana Avulsa – 2 perguntas', 'Consulta pelo baralho cigano, com respostas e orientação para determinadas questões de sua vida.',                  50.00, 30),
  ('Mesa Cigana Avulsa – 3 perguntas', 'Consulta pelo baralho cigano, com respostas e orientação para determinadas questões de sua vida.',                  70.00, 40),
  ('Consulta Ao Vivo',                 'Sessão ao vivo por videochamada com duração de uma hora. Espaço aberto para o consulente explorar todas as questões em tempo real.', 200.00, 60),
  ('Mesa Cigana Completa',             'Consulta feita através do baralho cigano te orientando em todos as áreas da sua vida.',                             150.00, 60),
  ('Confirmação de Orixás',            'Identificação de seus orixás + explicação detalhada sobre os conceitos e como cada orixá age em sua vida.',         50.00, 20),
  ('Confirmação de Exu',               'Confirmação de Exu ou pombagira, com orientação detalhada por escrito atraves de documento + audio explicativo. Atenção: caso a entidade não queira responder o valor é extronado.', 70.00, 40),
  ('Cabala de Odu',                    'Leitura cabalística dos odus vão falar sobre sua personalidade, pontos de atenção na area da saude, por onde ganha na vida, por onde perde, quais condutas evitar, quizilias e assim por diante.', 50.00, 30),
  ('Águas de Oxum',                    'Leitura com enfoque completo no amoroso. São vistos: pensamentos, sentimentos, intenções e caminhos.',              50.00, 30),
  ('Rosa de Vênus',                    'Leitura com enfoque no autoconhecimento. São vistos: caminhos de forma ampla e como melhora-los.',                  55.00, 30),
  ('Leitura dos Mentores',             'Descrição do guia mais próximo de você e dos seus caminhos com mensagens dele(a).',                                 50.00, 30),
  ('Mesa Mediúnica',                   'Leitura do seu campo espiritual, apontando suas mediunidade e parapsiquismos.',                                     70.00, 30),
  ('Mesa Radiônica',                   'Leitura do seu campo espiritual completa. Utilização de ressonâncias para fins de equilibrio dos campos sutis. Esta leitura conta com documento com orientações por escrito + audio explicativo.', 222.00, 210),
  ('Registros Akáshicos',              'Acesso aos registros da alma para compreender padrões, missão de vida e bloqueios energéticos profundos.',          188.00, 120),
  ('Theta Healing',                    'Técnica de meditação profunda para reprogramar crenças limitantes e acessar o estado theta de cura.',               150.00, 120);

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
  status              TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','pago','cancelado')),
  metodo_pagamento    TEXT,
  payment_id          TEXT,
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
  duracao_minutos     INTEGER NOT NULL CHECK (duracao_minutos > 0),
  valor_original      NUMERIC(10,2) NOT NULL CHECK (valor_original >= 0),
  desconto_aplicado   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (desconto_aplicado >= 0),
  valor_final         NUMERIC(10,2) NOT NULL CHECK (valor_final >= 0),
  aceitou_desconto_10 BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','pago','confirmado','atendido','cancelado')),
  payment_id          TEXT,
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

-- ============================================================
-- 4) TRIGGER: bloqueia desconto 10% para clientes recorrentes
--    Bloqueia o INSERT com exceção; o frontend deve pré-validar
--    via cliente_elegivel_desconto para evitar o erro.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validar_desconto_primeiro_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.aceitou_desconto_10 = TRUE AND EXISTS (
    SELECT 1 FROM public.agendamentos
    WHERE regexp_replace(cliente_whatsapp, '\D', '', 'g')
        = regexp_replace(NEW.cliente_whatsapp, '\D', '', 'g')
      AND status IN ('pago', 'confirmado', 'atendido')
  ) THEN
    RAISE EXCEPTION 'desconto_novo_cliente_invalido: este WhatsApp já possui agendamento — o desconto de novo cliente não se aplica';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_desconto_primeiro_cliente
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_desconto_primeiro_cliente();

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

-- RPC consultada pelo frontend antes do INSERT
CREATE OR REPLACE FUNCTION public.cliente_elegivel_desconto(p_whatsapp text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.agendamentos
    WHERE regexp_replace(cliente_whatsapp, '\D', '', 'g')
        = regexp_replace(p_whatsapp, '\D', '', 'g')
      AND status IN ('pago', 'confirmado', 'atendido')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cliente_elegivel_desconto(text) TO anon;

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

GRANT EXECUTE ON FUNCTION public.chave_pedido_existe(text) TO anon;
GRANT EXECUTE ON FUNCTION public.pedido_status(text) TO anon;
GRANT EXECUTE ON FUNCTION public.contar_agendamentos_por_data(text, date, date) TO anon;

-- confirmar_pedido_pago: atualização atômica (pai + filhos) chamada pelo
-- webhook da InfinitePay (service_role). NUNCA exposta ao anon.
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
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_pago(text, text) TO service_role;

-- criar_pedido: cria pedido pai + N agendamentos filhos numa transação só.
-- SECURITY DEFINER porque anon não tem SELECT/DELETE em pedidos (LGPD).
-- Triggers BEFORE INSERT de agendamentos rodam por linha; se algum RAISE,
-- a transação inteira faz rollback.
CREATE OR REPLACE FUNCTION public.criar_pedido(
  p_chave               text,
  p_nome                text,
  p_nascimento          date,
  p_whatsapp            text,
  p_email               text,
  p_valor_total         numeric,
  p_aceitou_desconto_10 boolean,
  p_itens               jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id bigint;
  v_item      jsonb;
BEGIN
  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, aceitou_desconto_10, status
  ) VALUES (
    p_chave, p_nome, p_nascimento, p_whatsapp,
    p_email, p_valor_total, p_aceitou_desconto_10, 'pendente'
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    INSERT INTO public.agendamentos (
      chave_pedido, pedido_id, tipo_leitura_id, terapeuta,
      cliente_nome, cliente_nascimento, cliente_whatsapp, cliente_email,
      cliente_observacoes, data_agendamento, hora_agendamento, duracao_minutos,
      valor_original, desconto_aplicado, valor_final,
      aceitou_desconto_10, agendamento_especial, status
    ) VALUES (
      p_chave,
      v_pedido_id,
      (v_item->>'tipo_leitura_id')::bigint,
      v_item->>'terapeuta',
      p_nome, p_nascimento, p_whatsapp, p_email,
      v_item->>'observacoes',
      (v_item->>'data')::date,
      (v_item->>'horario')::time,
      (v_item->>'duracao_minutos')::int,
      (v_item->>'valor_original')::numeric,
      (v_item->>'desconto_aplicado')::numeric,
      (v_item->>'valor_final')::numeric,
      COALESCE((v_item->>'aceitou_novo_cliente')::boolean, FALSE),
      COALESCE((v_item->>'agendamento_especial')::boolean, FALSE),
      'pendente'
    );
  END LOOP;

  RETURN p_chave;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_pedido(text, text, date, text, text, numeric, boolean, jsonb) TO anon;

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
-- 9) REALTIME — dashboard escuta as tabelas agendamentos e pedidos
--    Quando o webhook da InfinitePay muda pendente -> pago,
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
