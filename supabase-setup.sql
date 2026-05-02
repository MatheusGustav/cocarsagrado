-- ============================================================
-- COCAR SAGRADO — Setup do Banco de Dados (Supabase)
-- Execute este arquivo no SQL Editor do Supabase
-- ============================================================

-- Extensão para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELA: tipos_leitura
-- ============================================================
CREATE TABLE IF NOT EXISTS tipos_leitura (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  nome            TEXT NOT NULL,
  descricao       TEXT,
  preco_original  DECIMAL(10,2) NOT NULL,
  duracao_minutos INTEGER NOT NULL DEFAULT 60,
  ativo           BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: horarios_disponiveis
-- ============================================================
CREATE TABLE IF NOT EXISTS horarios_disponiveis (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  dia_semana   INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio  TIME NOT NULL,
  hora_fim     TIME NOT NULL,
  ativo        BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- TABELA: agendamentos
-- ============================================================
CREATE TABLE IF NOT EXISTS agendamentos (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  chave_pedido         TEXT UNIQUE NOT NULL,
  tipo_leitura_id      UUID REFERENCES tipos_leitura(id) ON DELETE SET NULL,
  cliente_nome         TEXT NOT NULL,
  cliente_email        TEXT NOT NULL,
  cliente_whatsapp     TEXT NOT NULL,
  cliente_observacoes  TEXT,
  data_agendamento     DATE NOT NULL,
  hora_agendamento     TIME NOT NULL,
  duracao_minutos      INTEGER NOT NULL,
  valor_original       DECIMAL(10,2) NOT NULL,
  desconto_aplicado    DECIMAL(10,2) DEFAULT 0,
  valor_final          DECIMAL(10,2) NOT NULL,
  metodo_pagamento     TEXT CHECK (metodo_pagamento IN ('pix', 'cartao', 'wise')),
  status               TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','pago','confirmado','atendido','cancelado')),
  aceitou_desconto_10  BOOLEAN DEFAULT FALSE,
  pago_em              TIMESTAMPTZ,
  atendido_em          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: bloqueios_horario
-- ============================================================
CREATE TABLE IF NOT EXISTS bloqueios_horario (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  data_bloqueio DATE NOT NULL,
  hora_inicio   TIME NOT NULL,
  hora_fim      TIME NOT NULL,
  motivo        TEXT
);

-- ============================================================
-- TRIGGER: atualiza updated_at em agendamentos
-- ============================================================
CREATE OR REPLACE FUNCTION atualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_agendamentos_updated_at
  BEFORE UPDATE ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION atualizar_updated_at();

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
ALTER TABLE tipos_leitura       ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios_disponiveis ENABLE ROW LEVEL SECURITY;
ALTER TABLE agendamentos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueios_horario    ENABLE ROW LEVEL SECURITY;

-- tipos_leitura: leitura pública (apenas ativos)
CREATE POLICY "leitura_publica_tipos"
  ON tipos_leitura FOR SELECT
  USING (ativo = TRUE);

-- horarios_disponiveis: leitura pública (apenas ativos)
CREATE POLICY "leitura_publica_horarios"
  ON horarios_disponiveis FOR SELECT
  USING (ativo = TRUE);

-- agendamentos: inserção pública
CREATE POLICY "insercao_publica_agendamentos"
  ON agendamentos FOR INSERT
  WITH CHECK (TRUE);

-- agendamentos: leitura pública (para verificar disponibilidade)
CREATE POLICY "leitura_publica_agendamentos"
  ON agendamentos FOR SELECT
  USING (TRUE);

-- agendamentos: update público (necessário para status)
-- Em produção, proteja esta policy com autenticação de admin
CREATE POLICY "update_agendamentos"
  ON agendamentos FOR UPDATE
  USING (TRUE);

-- bloqueios_horario: leitura pública
CREATE POLICY "leitura_publica_bloqueios"
  ON bloqueios_horario FOR SELECT
  USING (TRUE);

-- ============================================================
-- DADOS INICIAIS: tipos_leitura
-- ============================================================
INSERT INTO tipos_leitura (nome, descricao, preco_original, duracao_minutos) VALUES
  ('Tarot Completo',   'Leitura profunda com 21 cartas, cobrindo passado, presente e futuro. Ideal para questões de vida, amor e carreira.', 100.00, 60),
  ('Mapa Astral',      'Análise completa do seu mapa natal com interpretação dos planetas, casas e aspectos. Inclui relatório por escrito.', 150.00, 90),
  ('Leitura de Búzios','Jogo de búzios tradicional com consulta ao oráculo. Respostas diretas para suas questões mais urgentes.', 120.00, 75),
  ('Consulta Rápida',  'Tirada rápida de 3 cartas para uma questão específica. Perfeita para quem busca orientação pontual.', 50.00, 30);

-- ============================================================
-- DADOS INICIAIS: horarios_disponiveis (Seg–Sex, 9h–18h)
-- ============================================================
INSERT INTO horarios_disponiveis (dia_semana, hora_inicio, hora_fim) VALUES
  (1, '09:00', '18:00'),  -- Segunda
  (2, '09:00', '18:00'),  -- Terça
  (3, '09:00', '18:00'),  -- Quarta
  (4, '09:00', '18:00'),  -- Quinta
  (5, '09:00', '18:00');  -- Sexta
