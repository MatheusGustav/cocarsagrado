-- ============================================================
-- COCAR SAGRADO — Setup completo do banco (Supabase)
-- Reset total + criação. Rode no SQL Editor.
-- ============================================================

-- DROP em ordem (respeita FKs)
DROP TRIGGER IF EXISTS trg_desconto_primeiro_cliente ON public.agendamentos;
DROP FUNCTION IF EXISTS public.validar_desconto_primeiro_cliente();
DROP TABLE IF EXISTS public.agendamentos          CASCADE;
DROP TABLE IF EXISTS public.horarios_disponiveis  CASCADE;
DROP TABLE IF EXISTS public.tipos_leitura         CASCADE;

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
  especial        BOOLEAN NOT NULL DEFAULT FALSE,
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
-- 3) AGENDAMENTOS
-- ============================================================
CREATE TABLE public.agendamentos (
  id                  BIGSERIAL PRIMARY KEY,
  chave_pedido        TEXT NOT NULL UNIQUE,
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
  pago_em             TIMESTAMPTZ,
  atendido_em         TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agend_data_hora     ON public.agendamentos (data_agendamento, hora_agendamento);
CREATE INDEX idx_agend_status        ON public.agendamentos (status);
CREATE INDEX idx_agend_terapeuta     ON public.agendamentos (terapeuta);
CREATE INDEX idx_agend_chave         ON public.agendamentos (chave_pedido);
CREATE INDEX idx_agend_whatsapp_norm ON public.agendamentos (regexp_replace(cliente_whatsapp, '\D', '', 'g'));

-- ============================================================
-- 4) TRIGGER: bloqueia desconto 10% para clientes recorrentes
--    Bloqueia o INSERT com exceção; o frontend deve pré-validar
--    via cliente_elegivel_desconto para evitar o erro.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validar_desconto_primeiro_cliente()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_desconto_primeiro_cliente
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_desconto_primeiro_cliente();

-- RPC consultada pelo frontend antes do INSERT
CREATE OR REPLACE FUNCTION public.cliente_elegivel_desconto(p_whatsapp text)
RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.agendamentos
    WHERE regexp_replace(cliente_whatsapp, '\D', '', 'g')
        = regexp_replace(p_whatsapp, '\D', '', 'g')
      AND status IN ('pago', 'confirmado', 'atendido')
  );
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.cliente_elegivel_desconto(text) TO anon;

-- ============================================================
-- 5) RLS — anon tem acesso total (admin + checkout no front)
-- ============================================================
ALTER TABLE public.tipos_leitura         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horarios_disponiveis  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agendamentos          ENABLE ROW LEVEL SECURITY;

-- tipos_leitura
DROP POLICY IF EXISTS "anon_select_tipos" ON public.tipos_leitura;
CREATE POLICY "anon_select_tipos" ON public.tipos_leitura
  FOR SELECT TO anon USING (TRUE);

-- horarios_disponiveis (admin gerencia pelo painel anônimo)
DROP POLICY IF EXISTS "anon_all_horarios" ON public.horarios_disponiveis;
CREATE POLICY "anon_all_horarios" ON public.horarios_disponiveis
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- agendamentos
DROP POLICY IF EXISTS "anon_select_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_insert_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_update_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_delete_agend" ON public.agendamentos;

CREATE POLICY "anon_select_agend" ON public.agendamentos
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "anon_insert_agend" ON public.agendamentos
  FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "anon_update_agend" ON public.agendamentos
  FOR UPDATE TO anon USING (TRUE);
CREATE POLICY "anon_delete_agend" ON public.agendamentos
  FOR DELETE TO anon USING (TRUE);
