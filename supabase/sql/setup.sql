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
-- Exige AAL2 (senha + TOTP): sem o 2º fator o RLS não reconhece admin,
-- então quem tiver só a senha não bate na API REST direto (sessão aal1).
-- IMPORTANTE: só funciona depois de inscrever o TOTP no /admin e logar
-- até aal2; senão o painel fica sem ler/gravar (login/enroll seguem ok).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT auth.email() IN (
           'cocarsagrado@gmail.com'
           -- adicione outros e-mails de admin aqui se necessário
         )
     AND COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
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
  FOR SELECT TO anon, authenticated USING (TRUE);

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
  FOR SELECT TO anon, authenticated USING (TRUE);

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
  -- Prova de aceite dos Termos NO ATO do pedido: logado herda a versão do
  -- perfil (fonte da verdade), guest leva o que o checkout coletou.
  -- NULL = sem registro (pedidos anteriores a 14/07/2026 ficam NULL —
  -- não se inventa aceite retroativo).
  termos_versao       TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- vínculo com a conta logada (auth.uid() na criar_pedido); NULL = guest.
  -- Base do histórico de leituras do cliente (RPC minhas_leituras).
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_pedidos_chave     ON public.pedidos (chave_pedido);
CREATE INDEX idx_pedidos_status    ON public.pedidos (status);
CREATE INDEX idx_pedidos_whatsapp  ON public.pedidos (regexp_replace(cliente_whatsapp, '\D', '', 'g'));
CREATE INDEX idx_pedidos_user      ON public.pedidos (user_id) WHERE user_id IS NOT NULL;

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
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- qtd de perguntas do item (naipe: declarada; demais: do catálogo).
  -- Antes só existia no payload da RPC — necessária p/ complemento.
  num_perguntas       INTEGER NOT NULL DEFAULT 0
                      CHECK (num_perguntas >= 0 AND num_perguntas <= 20),
  -- complemento ("pergunta adicional"): aponta a leitura original.
  -- Linhas com leitura_origem_id NÃO consomem vaga (ver triggers abaixo).
  leitura_origem_id   BIGINT REFERENCES public.agendamentos(id) ON DELETE SET NULL
);
CREATE INDEX idx_agend_data_hora     ON public.agendamentos (data_agendamento, hora_agendamento);
CREATE INDEX idx_agend_status        ON public.agendamentos (status);
CREATE INDEX idx_agend_terapeuta     ON public.agendamentos (terapeuta);
CREATE INDEX idx_agend_chave         ON public.agendamentos (chave_pedido);
CREATE INDEX idx_agend_pedido_id     ON public.agendamentos (pedido_id);
CREATE INDEX idx_agend_whatsapp_norm ON public.agendamentos (regexp_replace(cliente_whatsapp, '\D', '', 'g'));
CREATE INDEX idx_agend_origem        ON public.agendamentos (leitura_origem_id) WHERE leitura_origem_id IS NOT NULL;

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
  IF NEW.leitura_origem_id IS NOT NULL THEN
    RETURN NEW; -- complemento: não consome vaga
  END IF;

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
  IF NEW.leitura_origem_id IS NOT NULL THEN
    RETURN NEW; -- complemento: não consome vaga
  END IF;

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
    AND leitura_origem_id IS NULL
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
  FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS "auth_admin_tipos" ON public.tipos_leitura;
CREATE POLICY "auth_admin_tipos" ON public.tipos_leitura
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- horarios_disponiveis (anon SÓ lê a disponibilidade; admin gerencia)
DROP POLICY IF EXISTS "anon_select_horarios" ON public.horarios_disponiveis;
CREATE POLICY "anon_select_horarios" ON public.horarios_disponiveis
  FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS "auth_admin_horarios" ON public.horarios_disponiveis;
CREATE POLICY "auth_admin_horarios" ON public.horarios_disponiveis
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- agendamentos — anon NÃO tem acesso direto. Toda criação passa pela
-- RPC criar_pedido (SECURITY DEFINER, valida preço/desconto). Deixar
-- anon dar INSERT direto (WITH CHECK TRUE) furava essa validação —
-- dava POST /rest/v1/agendamentos com status='pago'/valor=0. Por isso
-- não há policy de INSERT para anon + REVOKE INSERT (defesa em profund.).
-- SELECT via RPCs security definer (chave_pedido_existe, contar_...).
-- Admin = is_admin().
DROP POLICY IF EXISTS "anon_select_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_insert_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_update_agend" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_delete_agend" ON public.agendamentos;

REVOKE INSERT ON public.agendamentos FROM anon;

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
  v_id    bigint;
  v_cupom text;
  v_uso   boolean;
  v_ativo boolean;
  v_reuso boolean := FALSE;
BEGIN
  SELECT id, cupom_codigo INTO v_id, v_cupom
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

  -- Cupom de uso único: morre após o pagamento confirmado. Se JÁ estava
  -- morto (outro pedido queimou antes), o desconto deste pedido já foi
  -- dado no link — confirma mesmo assim, mas retorna 2 pro webhook
  -- alertar no Telegram (desconto saiu em dobro).
  IF v_cupom IS NOT NULL THEN
    SELECT uso_unico, ativo INTO v_uso, v_ativo
    FROM public.cupons
    WHERE upper(codigo) = upper(v_cupom);
    IF COALESCE(v_uso, FALSE) AND v_ativo IS FALSE THEN
      v_reuso := TRUE;
    END IF;
    UPDATE public.cupons
    SET ativo = FALSE
    WHERE upper(codigo) = upper(v_cupom)
      AND uso_unico = TRUE;
  END IF;

  RETURN CASE WHEN v_reuso THEN 2 ELSE 1 END;
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
  p_chave         text,
  p_nome          text,
  p_nascimento    date,
  p_whatsapp      text,
  p_email         text,
  p_valor_total   numeric,
  p_itens         jsonb,
  p_cupom_codigo  text DEFAULT NULL,
  p_termos_versao text DEFAULT NULL
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
  v_num_perg       integer;   -- naipe: qtd de perguntas declarada (1..4)
  v_esperado_naipe numeric;   -- preço acumulado esperado para v_num_perg
  v_soma           numeric := 0;
  v_soma_elig      numeric := 0;   -- soma das leituras elegíveis a cupom (não-naipe)
  v_cfg            jsonb;
  v_cupom_cod      text;
  v_cupom_val      numeric := 0;
  v_cupom_uso      boolean := FALSE;
  v_cupom_desc     numeric := 0;
  v_ag_id          bigint;
  v_ids            bigint[]  := '{}';
  v_vals           numeric[] := '{}';
  v_elig_ids       bigint[]  := '{}'; -- filhos que entram no rateio do cupom
  v_elig_vals      numeric[] := '{}';
  v_i              integer;
  v_share_cents    numeric;
  v_resto_cents    numeric;
  v_termos         text;
BEGIN
  v_n := COALESCE(jsonb_array_length(p_itens), 0);
  IF v_n < 1 OR v_n > 4 THEN
    RAISE EXCEPTION 'pedido_invalido: o pedido deve ter entre 1 e 4 leituras';
  END IF;

  SELECT valor INTO v_cfg FROM public.configuracoes WHERE chave = 'descontos';

  -- Cupom (R$ fixo no total). Valida cedo pra falhar antes de inserir.
  -- Cupom pessoal só vale pro dono logado; expirado não passa.
  v_cupom_cod := NULLIF(upper(trim(COALESCE(p_cupom_codigo, ''))), '');
  IF v_cupom_cod IS NOT NULL THEN
    SELECT valor_desconto, uso_unico INTO v_cupom_val, v_cupom_uso
    FROM public.cupons
    WHERE upper(codigo) = v_cupom_cod
      AND ativo = TRUE
      AND (expira_em IS NULL OR expira_em > now())
      AND (user_id IS NULL OR user_id = auth.uid());
    IF v_cupom_val IS NULL THEN
      RAISE EXCEPTION 'pedido_invalido: cupom inválido ou inativo';
    END IF;

    -- Uso único: o desconto entra no link de pagamento ANTES do webhook
    -- queimar o cupom — sem esta trava, 2 pedidos pendentes gastariam o
    -- mesmo cupom. Pago trava sempre; pendente trava por 24h (carrinho
    -- abandonado não prende o cupom pra sempre).
    IF v_cupom_uso AND EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE upper(p.cupom_codigo) = v_cupom_cod
        AND (p.status = 'pago'
             OR (p.status = 'pendente' AND p.criado_em > now() - interval '24 hours'))
    ) THEN
      RAISE EXCEPTION 'pedido_invalido: cupom já está em uso em outro pedido';
    END IF;
  END IF;

  -- Aceite dos Termos gravado no pedido (prova por transação). Logado usa
  -- a versão do PERFIL (aceita no cadastro/re-aceite — o front nem envia);
  -- guest e logado-sem-perfil usam o que o checkbox do checkout coletou.
  -- NULL = nenhum aceite registrado (fica visível, não se mascara).
  SELECT termos_versao INTO v_termos FROM public.perfis WHERE id = auth.uid();
  v_termos := COALESCE(v_termos, NULLIF(trim(p_termos_versao), ''));

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, status, cupom_codigo, user_id, termos_versao
  ) VALUES (
    p_chave, p_nome, p_nascimento, p_whatsapp,
    p_email, p_valor_total, 'pendente', v_cupom_cod,
    auth.uid(),  -- NULL para guest; base do histórico do cliente logado
    v_termos
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

    IF v_tipo.slug = 'naipes-da-pombo-gira' THEN
      -- Naipes da Pomba Gira: preço progressivo por qtd de perguntas, amarrado
      -- ao num_perguntas declarado (1→30, 2→56, 3→78, 4→96). Sem desconto.
      v_num_perg := COALESCE((v_item->>'num_perguntas')::integer, 0);
      IF v_num_perg < 1 OR v_num_perg > 4 THEN
        RAISE EXCEPTION 'pedido_invalido: qtd de perguntas do naipe inválida';
      END IF;
      v_esperado_naipe := CASE v_num_perg
                            WHEN 1 THEN 30
                            WHEN 2 THEN 56
                            WHEN 3 THEN 78
                            WHEN 4 THEN 96
                          END;
      IF v_valor_original <> v_esperado_naipe THEN
        RAISE EXCEPTION 'pedido_invalido: valor do naipe não confere com a qtd de perguntas';
      END IF;
      v_min_final := v_valor_original; -- força valor_final = valor_original
    ELSE
      -- valor_original deve ser múltiplo do preço do catálogo (qty 1–5; especial = 1)
      v_num_perg := v_tipo.num_perguntas;
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
    END IF;

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
      agendamento_especial, status, num_perguntas
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
      'pendente',
      COALESCE(v_num_perg, 0)
    )
    RETURNING id INTO v_ag_id;

    v_ids  := array_append(v_ids, v_ag_id);
    v_vals := array_append(v_vals, v_valor_final);
    -- Naipes da Pomba Gira não entram em cupom (leitura sem desconto).
    IF v_tipo.slug <> 'naipes-da-pombo-gira' THEN
      v_elig_ids  := array_append(v_elig_ids, v_ag_id);
      v_elig_vals := array_append(v_elig_vals, v_valor_final);
      v_soma_elig := v_soma_elig + v_valor_final;
    END IF;
  END LOOP;

  -- Cupom: incide só sobre as leituras elegíveis (nunca passa da base).
  v_cupom_desc := least(v_cupom_val, v_soma_elig);

  IF abs(p_valor_total - (v_soma - v_cupom_desc)) > 0.05 THEN
    RAISE EXCEPTION 'pedido_invalido: total não confere com a soma das leituras';
  END IF;

  -- Distribui o desconto do cupom entre os filhos ELEGÍVEIS (proporcional, em
  -- centavos), para que cada agendamento.valor_final reflita o valor REALMENTE
  -- cobrado. Mantém pedido.valor_total = soma(valor_final) e relatórios corretos.
  IF v_cupom_desc > 0 AND v_soma_elig > 0 THEN
    v_resto_cents := round(v_cupom_desc * 100);
    FOR v_i IN 1 .. array_length(v_elig_ids, 1) LOOP
      IF v_i = array_length(v_elig_ids, 1) THEN
        v_share_cents := least(v_resto_cents, round(v_elig_vals[v_i] * 100));
      ELSE
        v_share_cents := floor(round(v_cupom_desc * 100) * round(v_elig_vals[v_i] * 100)
                               / round(v_soma_elig * 100));
        v_resto_cents := v_resto_cents - v_share_cents;
      END IF;
      IF v_share_cents > 0 THEN
        UPDATE public.agendamentos
        SET desconto_aplicado = desconto_aplicado + v_share_cents / 100.0,
            valor_final       = valor_final       - v_share_cents / 100.0
        WHERE id = v_elig_ids[v_i];
      END IF;
    END LOOP;
  END IF;

  UPDATE public.pedidos
  SET cupom_desconto = v_cupom_desc
  WHERE id = v_pedido_id;

  RETURN p_chave;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_pedido(text, text, date, text, text, numeric, jsonb, text, text) TO anon;

-- pedidos — anon NÃO tem acesso direto. Criação só via RPC criar_pedido
-- (SECURITY DEFINER). INSERT direto de anon (WITH CHECK TRUE) permitia
-- gravar pedido com status='pago'/valor_total=0 furando a validação de
-- preço — por isso sem policy de INSERT + REVOKE. SELECT bloqueado (LGPD);
-- status do cliente via RPC pedido_status. Admin ALL via is_admin().
DROP POLICY IF EXISTS "anon_insert_pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "auth_admin_pedidos" ON public.pedidos;

REVOKE INSERT ON public.pedidos FROM anon;

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
  FOR SELECT TO anon, authenticated USING (TRUE);

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
  uso_unico      BOOLEAN NOT NULL DEFAULT FALSE,        -- morre ao confirmar pagamento
  -- Cupom pessoal: só a conta dona usa (e vê no drawer via meus_cupons).
  -- NULL = global (comunidade). expira_em NULL = sem validade.
  user_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  expira_em      TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cupons_user
  ON public.cupons (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_admin_cupons" ON public.cupons;
CREATE POLICY "auth_admin_cupons" ON public.cupons
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- validar_cupom: anon checa um código e recebe {valido, valor_desconto,
-- precisa_login}. precisa_login = cupom pessoal digitado deslogado (dica
-- de entrar na conta); dono errado recebe o "inválido" genérico.
CREATE OR REPLACE FUNCTION public.validar_cupom(p_codigo text)
RETURNS TABLE(valido boolean, valor_desconto numeric, precisa_login boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cod  text;
  v_val  numeric;
  v_user uuid;
  v_uso  boolean;
BEGIN
  v_cod := upper(trim(COALESCE(p_codigo, '')));

  SELECT c.valor_desconto, c.user_id, c.uso_unico
  INTO v_val, v_user, v_uso
  FROM public.cupons c
  WHERE upper(c.codigo) = v_cod
    AND c.ativo = TRUE
    AND (c.expira_em IS NULL OR c.expira_em > now());

  IF v_val IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::numeric, FALSE; RETURN;
  END IF;

  IF v_user IS NOT NULL AND auth.uid() IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::numeric, TRUE; RETURN;
  END IF;
  IF v_user IS NOT NULL AND v_user <> auth.uid() THEN
    RETURN QUERY SELECT FALSE, 0::numeric, FALSE; RETURN;
  END IF;

  -- Uso único já preso em outro pedido (mesma regra da criar_pedido)
  IF v_uso AND EXISTS (
    SELECT 1 FROM public.pedidos p
    WHERE upper(p.cupom_codigo) = v_cod
      AND (p.status = 'pago'
           OR (p.status = 'pendente' AND p.criado_em > now() - interval '24 hours'))
  ) THEN
    RETURN QUERY SELECT FALSE, 0::numeric, FALSE; RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_val, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_cupom(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_cupom(text) TO anon, authenticated;

-- Índice p/ as checagens de cupom em uso (pedidos por código)
CREATE INDEX IF NOT EXISTS idx_pedidos_cupom
  ON public.pedidos (upper(cupom_codigo)) WHERE cupom_codigo IS NOT NULL;

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

-- ============================================================
-- 10) PERFIS de cliente (login via Supabase Auth OTP por e-mail).
--
-- id = auth.uid() (1:1 com auth.users). E-mail NÃO é duplicado
-- aqui: quando precisar, faça JOIN com auth.users.
--
-- RLS: cada pessoa só lê/edita o próprio perfil.
-- ============================================================

CREATE TABLE public.perfis (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  nascimento date NOT NULL,
  whatsapp   text NOT NULL,
  -- Aceite de termos: qual versão foi aceita e quando. Se os termos
  -- mudarem, o login compara a versão e pede re-aceite. Guests (sem
  -- conta) aceitam por pedido — trava de UI, não grava aqui.
  termos_versao     text,
  termos_aceitos_em timestamptz,
  -- Opt-in de e-mails (LGPD): desmarcado por padrão; cliente marca no
  -- cadastro ou liga/desliga na tela logada. Guarda quando consentiu.
  aceita_emails     boolean NOT NULL DEFAULT FALSE,
  aceita_emails_em  timestamptz,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_perfis_whatsapp_norm ON public.perfis (regexp_replace(whatsapp, '\D', '', 'g'));

ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfis_select_own" ON public.perfis
  FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "perfis_insert_own" ON public.perfis
  FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "perfis_update_own" ON public.perfis
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- UPDATE por coluna: cliente não altera o próprio nascimento (senão
-- "antecipa" o cupom de aniversário pelo console). Correção = admin.
REVOKE UPDATE ON public.perfis FROM authenticated;
GRANT UPDATE (nome, whatsapp, termos_versao, termos_aceitos_em, aceita_emails, aceita_emails_em)
  ON public.perfis TO authenticated;

-- ============================================================
-- 11) HISTÓRICO DE LEITURAS + PERGUNTA ADICIONAL (complemento)
--
-- Cliente logado vê suas leituras (só pedidos com user_id — guest
-- antigo fica de fora; casar por WhatsApp seria spoofável) e, nas
-- elegíveis (Naipes da Pomba Gira / Amarração de Igbo), adiciona
-- perguntas pagando só a diferença da tabela ATUAL, até o fim do
-- dia seguinte ao dia agendado (fuso São Paulo).
--
-- Complemento é pedido NORMAL (chave/order_nsu próprios): checkout
-- e webhook (confirmar_pedido_pago) funcionam sem mudança. A linha
-- filha leva leitura_origem_id e NÃO consome vaga (triggers pulam).
-- Admin não usa nada disso (só no drawer do cliente).
-- ============================================================

CREATE OR REPLACE FUNCTION public.minhas_leituras()
RETURNS TABLE (
  id                bigint,
  chave_pedido      text,
  tipo_nome         text,
  tipo_slug         text,
  grupo_slug        text,
  terapeuta         text,
  data_agendamento  date,
  status            text,
  valor_final       numeric,
  num_perguntas     integer,
  perguntas_total   integer,
  max_perguntas     integer,
  leitura_origem_id bigint,
  pode_complementar boolean,
  criado_em         timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH minhas AS (
    SELECT a.*,
           t.nome  AS t_nome,
           t.slug  AS t_slug,
           t.grupo_slug AS t_grupo,
           t.preco_original AS t_preco
    FROM public.agendamentos a
    JOIN public.pedidos p       ON p.id = a.pedido_id
    JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
    WHERE p.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ),
  com_totais AS (
    SELECT m.*,
           -- perguntas já garantidas: as da origem + complementos PAGOS
           m.num_perguntas + COALESCE((
             SELECT sum(c.num_perguntas)::integer
             FROM public.agendamentos c
             WHERE c.leitura_origem_id = m.id
               AND c.status IN ('pago','confirmado','atendido')
           ), 0) AS p_total,
           CASE
             WHEN m.t_slug = 'naipes-da-pombo-gira' THEN 4
             WHEN m.t_grupo IS NOT NULL THEN COALESCE((
               SELECT max(t2.num_perguntas)::integer
               FROM public.tipos_leitura t2
               WHERE t2.grupo_slug = m.t_grupo AND t2.ativo
             ), 0)
             ELSE 0
           END AS p_max
    FROM minhas m
  )
  SELECT
    ct.id,
    ct.chave_pedido,
    ct.t_nome,
    ct.t_slug,
    ct.t_grupo,
    ct.terapeuta,
    ct.data_agendamento,
    ct.status,
    ct.valor_final,
    ct.num_perguntas,
    ct.p_total,
    ct.p_max,
    ct.leitura_origem_id,
    (
      ct.leitura_origem_id IS NULL
      AND ct.status IN ('pago','confirmado','atendido')
      AND ct.num_perguntas >= 1
      AND (
        ct.t_slug = 'naipes-da-pombo-gira'
        OR (ct.t_grupo IS NOT NULL AND ct.valor_original = ct.t_preco)
      )
      AND (now() AT TIME ZONE 'America/Sao_Paulo')::date <= ct.data_agendamento + 1
      AND ct.p_total < ct.p_max
    ) AS pode_complementar,
    ct.criado_em
  FROM com_totais ct
  ORDER BY ct.criado_em DESC;
$$;

REVOKE ALL ON FUNCTION public.minhas_leituras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_leituras() TO authenticated;

-- criar_pedido_complemento: cria o pedido da DIFERENÇA. Valida dono/
-- janela/elegibilidade e calcula o delta 100% no servidor (tabela
-- atual, sem cupom/desconto). Front manda só chave nova + origem +
-- qtd extra + texto das perguntas.
CREATE OR REPLACE FUNCTION public.criar_pedido_complemento(
  p_chave             text,
  p_leitura_origem_id bigint,
  p_perguntas_extra   integer,
  p_observacoes       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_ag         public.agendamentos%ROWTYPE;
  v_tipo       public.tipos_leitura%ROWTYPE;
  v_user_ped   uuid;
  v_atuais     integer;
  v_novo_total integer;
  v_preco_de   numeric;
  v_preco_para numeric;
  v_delta      numeric;
  v_pedido_id  bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'complemento_invalido: é preciso estar logado';
  END IF;
  IF p_perguntas_extra IS NULL OR p_perguntas_extra < 1 OR p_perguntas_extra > 3 THEN
    RAISE EXCEPTION 'complemento_invalido: quantidade de perguntas inválida';
  END IF;
  IF p_chave IS NULL OR length(trim(p_chave)) < 6 THEN
    RAISE EXCEPTION 'complemento_invalido: chave inválida';
  END IF;

  -- FOR UPDATE na origem serializa complementos concorrentes da mesma leitura
  SELECT a.* INTO v_ag
  FROM public.agendamentos a
  WHERE a.id = p_leitura_origem_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'complemento_invalido: leitura não encontrada';
  END IF;

  SELECT p.user_id INTO v_user_ped
  FROM public.pedidos p WHERE p.id = v_ag.pedido_id;
  IF v_user_ped IS NULL OR v_user_ped <> v_uid THEN
    RAISE EXCEPTION 'complemento_invalido: leitura não pertence a esta conta';
  END IF;

  IF v_ag.leitura_origem_id IS NOT NULL THEN
    RAISE EXCEPTION 'complemento_invalido: complemento não pode ter complemento';
  END IF;
  IF v_ag.status NOT IN ('pago','confirmado','atendido') THEN
    RAISE EXCEPTION 'complemento_invalido: a leitura original ainda não foi paga';
  END IF;

  -- Janela: até o fim do dia seguinte ao dia agendado (fuso São Paulo)
  IF (now() AT TIME ZONE 'America/Sao_Paulo')::date > v_ag.data_agendamento + 1 THEN
    RAISE EXCEPTION 'complemento_expirado: o prazo para adicionar perguntas terminou';
  END IF;

  SELECT * INTO v_tipo
  FROM public.tipos_leitura
  WHERE id = v_ag.tipo_leitura_id;

  -- perguntas já garantidas = origem + complementos pagos
  SELECT v_ag.num_perguntas + COALESCE(sum(c.num_perguntas)::integer, 0)
  INTO v_atuais
  FROM public.agendamentos c
  WHERE c.leitura_origem_id = v_ag.id
    AND c.status IN ('pago','confirmado','atendido');

  IF v_atuais < 1 THEN
    RAISE EXCEPTION 'complemento_invalido: leitura sem registro de perguntas';
  END IF;
  v_novo_total := v_atuais + p_perguntas_extra;

  IF v_tipo.slug = 'naipes-da-pombo-gira' THEN
    IF v_novo_total > 4 THEN
      RAISE EXCEPTION 'complemento_invalido: o naipe aceita no máximo 4 perguntas';
    END IF;
    -- Tabela progressiva atual do naipe (mesma da criar_pedido)
    v_preco_de   := CASE v_atuais     WHEN 1 THEN 30 WHEN 2 THEN 56 WHEN 3 THEN 78 WHEN 4 THEN 96 END;
    v_preco_para := CASE v_novo_total WHEN 1 THEN 30 WHEN 2 THEN 56 WHEN 3 THEN 78 WHEN 4 THEN 96 END;
  ELSIF v_tipo.grupo_slug IS NOT NULL THEN
    -- Qualquer grupo de tiers por nº de perguntas (amarração, mesa cigana
    -- avulsa, futuros). Tier atual e alvo pelo catálogo ATUAL (preço cheio).
    SELECT t.preco_original INTO v_preco_de
    FROM public.tipos_leitura t
    WHERE t.grupo_slug = v_tipo.grupo_slug AND t.ativo AND t.num_perguntas = v_atuais;
    SELECT t.preco_original INTO v_preco_para
    FROM public.tipos_leitura t
    WHERE t.grupo_slug = v_tipo.grupo_slug AND t.ativo AND t.num_perguntas = v_novo_total;
  ELSE
    RAISE EXCEPTION 'complemento_invalido: esta leitura não aceita perguntas adicionais';
  END IF;

  IF v_preco_de IS NULL OR v_preco_para IS NULL OR v_preco_para <= v_preco_de THEN
    RAISE EXCEPTION 'complemento_invalido: quantidade indisponível para esta leitura';
  END IF;
  v_delta := v_preco_para - v_preco_de;

  INSERT INTO public.pedidos (
    chave_pedido, cliente_nome, cliente_nascimento, cliente_whatsapp,
    cliente_email, valor_total, status, user_id, termos_versao
  ) VALUES (
    p_chave, v_ag.cliente_nome, v_ag.cliente_nascimento, v_ag.cliente_whatsapp,
    v_ag.cliente_email, v_delta, 'pendente', v_uid,
    -- complemento é sempre logado: prova de aceite vem do perfil
    (SELECT termos_versao FROM public.perfis WHERE id = v_uid)
  )
  RETURNING id INTO v_pedido_id;

  INSERT INTO public.agendamentos (
    chave_pedido, pedido_id, tipo_leitura_id, terapeuta,
    cliente_nome, cliente_nascimento, cliente_whatsapp, cliente_email,
    cliente_observacoes, data_agendamento, hora_agendamento,
    valor_original, desconto_aplicado, valor_final,
    agendamento_especial, status, num_perguntas, leitura_origem_id
  ) VALUES (
    p_chave, v_pedido_id, v_ag.tipo_leitura_id, v_ag.terapeuta,
    v_ag.cliente_nome, v_ag.cliente_nascimento, v_ag.cliente_whatsapp, v_ag.cliente_email,
    p_observacoes,
    v_ag.data_agendamento,  -- mesmo dia/contexto da leitura original
    v_ag.hora_agendamento,
    v_delta, 0, v_delta,
    FALSE, 'pendente', p_perguntas_extra, v_ag.id
  );

  RETURN jsonb_build_object('chave', p_chave, 'valor', v_delta);
END;
$$;

REVOKE ALL ON FUNCTION public.criar_pedido_complemento(text, bigint, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_pedido_complemento(text, bigint, integer, text) TO authenticated;

-- ============================================================
-- 12) E-MAILS AUTOMÁTICOS (cupom pessoal ganho + lembrete de recompra)
--
-- Só sai e-mail pra quem tem perfis.aceita_emails = TRUE (opt-in LGPD).
-- O pg_cron chama a edge function emails-cron a cada 15 min; ela pega a
-- fila em emails_pendentes(), envia via Resend e registra em
-- emails_enviados (UNIQUE tipo+ref = idempotência).
-- Secret do cron no Vault: 'cron_emails_secret' (= env CRON_SECRET da função).
-- ============================================================

-- Log/trava de reenvio — só service_role acessa.
CREATE TABLE IF NOT EXISTS public.emails_enviados (
  id         bigserial PRIMARY KEY,
  tipo       text NOT NULL,           -- 'cupom_ganho' | 'lembrete_recompra'
  ref        text NOT NULL,           -- 'cupom:CODIGO' | 'leitura:ID'
  user_id    uuid,
  email      text NOT NULL,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, ref)
);
ALTER TABLE public.emails_enviados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.emails_enviados FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.emails_enviados_id_seq FROM anon, authenticated;

-- meus_cupons: cupons pessoais da conta logada, com status calculado.
-- descricao fica de fora (nota interna do admin).
CREATE OR REPLACE FUNCTION public.meus_cupons()
RETURNS TABLE (
  codigo         text,
  valor_desconto numeric,
  expira_em      timestamptz,
  status         text,
  criado_em      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    c.codigo,
    c.valor_desconto,
    c.expira_em,
    CASE
      WHEN c.ativo AND (c.expira_em IS NULL OR c.expira_em > now()) THEN 'disponivel'
      WHEN c.uso_unico AND NOT c.ativo AND EXISTS (
        SELECT 1 FROM public.pedidos p
        WHERE upper(p.cupom_codigo) = upper(c.codigo) AND p.status = 'pago'
      ) THEN 'usado'
      WHEN c.expira_em IS NOT NULL AND c.expira_em <= now() THEN 'expirado'
      ELSE 'inativo'
    END AS status,
    c.criado_em
  FROM public.cupons c
  WHERE auth.uid() IS NOT NULL
    AND c.user_id = auth.uid()
  ORDER BY c.criado_em DESC;
$$;

REVOKE ALL ON FUNCTION public.meus_cupons() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meus_cupons() TO authenticated;

-- admin_user_por_email: admin resolve e-mail → conta (cupom pessoal).
CREATE OR REPLACE FUNCTION public.admin_user_por_email(p_email text)
RETURNS TABLE (user_id uuid, nome text, confirmado boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  RETURN QUERY
  SELECT u.id, pf.nome, (u.email_confirmed_at IS NOT NULL)
  FROM auth.users u
  LEFT JOIN public.perfis pf ON pf.id = u.id
  WHERE lower(u.email) = lower(trim(p_email));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_user_por_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_por_email(text) TO authenticated;

-- emails_pendentes: fila do cron (só service_role).
CREATE OR REPLACE FUNCTION public.emails_pendentes()
RETURNS TABLE (
  tipo    text,
  ref     text,
  user_id uuid,
  email   text,
  nome    text,
  payload jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH agora_sp AS (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date          AS hoje,
           extract(hour FROM now() AT TIME ZONE 'America/Sao_Paulo')::int AS hora
  ),
  -- Cupom pessoal ativo cujo dono optou por e-mails e ainda não foi avisado.
  -- NIVER% = cupom de aniversário: template próprio e só em horário humano.
  cupom AS (
    SELECT CASE WHEN c.codigo LIKE 'NIVER%' THEN 'aniversario'
                ELSE 'cupom_ganho' END     AS tipo,
           'cupom:' || c.codigo            AS ref,
           c.user_id,
           u.email::text                   AS email,
           pf.nome,
           jsonb_build_object(
             'codigo',    c.codigo,
             'valor',     c.valor_desconto,
             'expira_em', c.expira_em
           ) AS payload
    FROM public.cupons c
    CROSS JOIN agora_sp h
    JOIN public.perfis pf ON pf.id = c.user_id AND pf.aceita_emails
    JOIN auth.users u     ON u.id  = c.user_id
    WHERE c.user_id IS NOT NULL
      AND c.ativo
      AND (c.expira_em IS NULL OR c.expira_em > now())
      AND (c.codigo NOT LIKE 'NIVER%' OR h.hora BETWEEN 9 AND 20)
  ),
  -- Última leitura concluída de cada conta (complementos não contam)
  ultimas AS (
    SELECT DISTINCT ON (p.user_id)
           p.user_id, a.id AS ag_id, a.data_agendamento, t.nome AS tipo_nome
    FROM public.agendamentos a
    JOIN public.pedidos p       ON p.id = a.pedido_id
    JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
    WHERE p.user_id IS NOT NULL
      AND a.leitura_origem_id IS NULL
      AND a.status IN ('pago', 'confirmado', 'atendido')
    ORDER BY p.user_id, a.data_agendamento DESC, a.id DESC
  ),
  -- Lembrete de recompra: 30 dias após a última leitura. Janela fecha em
  -- 44 dias — no lançamento da feature, cliente antigo não é ressuscitado.
  -- Só em horário humano (9h–20h SP); o dedup fica no NOT EXISTS final.
  lembrete AS (
    SELECT 'lembrete_recompra'::text  AS tipo,
           'leitura:' || ul.ag_id     AS ref,
           ul.user_id,
           u.email::text              AS email,
           pf.nome,
           jsonb_build_object(
             'tipo_nome', ul.tipo_nome,
             'data',      ul.data_agendamento
           ) AS payload
    FROM ultimas ul
    CROSS JOIN agora_sp h
    JOIN public.perfis pf ON pf.id = ul.user_id AND pf.aceita_emails
    JOIN auth.users u     ON u.id  = ul.user_id
    WHERE (h.hoje - ul.data_agendamento) BETWEEN 30 AND 44
      AND h.hora BETWEEN 9 AND 20
      AND NOT EXISTS (              -- já tem coisa marcada pra frente? não lembra
        SELECT 1 FROM public.agendamentos a2
        JOIN public.pedidos p2 ON p2.id = a2.pedido_id
        WHERE p2.user_id = ul.user_id
          AND a2.data_agendamento > ul.data_agendamento
          AND a2.status IN ('pendente', 'pago', 'confirmado')
      )
  )
  SELECT q.*
  FROM (SELECT * FROM cupom UNION ALL SELECT * FROM lembrete) q
  WHERE NOT EXISTS (
    SELECT 1 FROM public.emails_enviados e
    WHERE e.tipo = q.tipo AND e.ref = q.ref
  );
$$;

REVOKE ALL ON FUNCTION public.emails_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emails_pendentes() TO service_role;

-- Cron: a cada 15 min chama a edge function emails-cron.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-cron') THEN
    PERFORM cron.unschedule('emails-cron');
  END IF;
  PERFORM cron.schedule(
    'emails-cron',
    '*/15 * * * *',
    $job$
    SELECT net.http_post(
      url     := 'https://demxedudbislzausvhwx.supabase.co/functions/v1/emails-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_emails_secret')
      ),
      body    := '{}'::jsonb
    );
    $job$
  );
END
$do$;

-- ============================================================
-- 13) CUPOM DE ANIVERSÁRIO
-- No dia do aniversário (SP), todo cliente com conta ganha 1 cupom
-- pessoal de uso único de R$ 15, válido por 15 dias. Cron diário
-- 'cupons-aniversario' às 00:05 SP; e-mail de parabéns via fluxo
-- de emails_pendentes (tipo 'aniversario', só com opt-in, 9h–20h).
-- ============================================================
CREATE OR REPLACE FUNCTION public.gerar_cupons_aniversario()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ano      integer := extract(year FROM v_hoje)::integer;
  v_bissexto boolean := (v_ano % 4 = 0 AND (v_ano % 100 <> 0 OR v_ano % 400 = 0));
  v_prefixo  text := 'NIVER' || to_char(v_hoje, 'YY') || '-';
  v_n        integer;
BEGIN
  INSERT INTO public.cupons (codigo, valor_desconto, descricao, ativo, uso_unico, user_id, expira_em)
  SELECT
    -- 8 chars de md5 (colisão ~1 em 4 bi); idempotência real é o
    -- NOT EXISTS por usuário/ano abaixo.
    v_prefixo || upper(substr(md5(p.id::text || v_ano::text), 1, 8)),
    15,
    'aniversário: ' || p.nome,
    TRUE,
    TRUE,
    p.id,
    -- 23:59:59 SP do 7º dia após o aniversário
    ((v_hoje + 8)::timestamp AT TIME ZONE 'America/Sao_Paulo') - interval '1 second'
  FROM public.perfis p
  WHERE (
    (extract(month FROM p.nascimento) = extract(month FROM v_hoje)
     AND extract(day FROM p.nascimento) = extract(day FROM v_hoje))
    -- nascido em 29/02: em ano não-bissexto comemora em 28/02
    OR (to_char(p.nascimento, 'MM-DD') = '02-29'
        AND to_char(v_hoje, 'MM-DD') = '02-28'
        AND NOT v_bissexto)
  )
  -- já ganhou este ano (mesmo que o admin tenha desativado)? pula.
  AND NOT EXISTS (
    SELECT 1 FROM public.cupons c
    WHERE c.user_id = p.id AND c.codigo LIKE v_prefixo || '%'
  )
  ON CONFLICT (codigo) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_cupons_aniversario() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_cupons_aniversario() TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cupons-aniversario') THEN
    PERFORM cron.unschedule('cupons-aniversario');
  END IF;
  PERFORM cron.schedule(
    'cupons-aniversario',
    '5 3 * * *',
    'SELECT public.gerar_cupons_aniversario();'
  );
END
$do$;

-- ============================================================
-- 14) LIMPEZA DE CONTAS FANTASMA
-- Usuário OTP nasce no PEDIDO do código; typo virava conta morta.
-- O front confirma antes de criar conta nova; a vassoura diária
-- ('limpar-contas-fantasma', 00:35 SP) apaga quem nunca confirmou
-- o código e tem +7 dias (sem perfil e sem pedido, por garantia).
-- ============================================================
CREATE OR REPLACE FUNCTION public.limpar_contas_fantasma()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM auth.users u
  WHERE u.email_confirmed_at IS NULL
    AND u.created_at < now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.perfis  p WHERE p.id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.pedidos o WHERE o.user_id = u.id)
    -- cupom pessoal criado pelo admin: apagar a conta levaria o cupom
    -- junto (CASCADE) sem aviso.
    AND NOT EXISTS (SELECT 1 FROM public.cupons  c WHERE c.user_id = u.id);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.limpar_contas_fantasma() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_contas_fantasma() TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpar-contas-fantasma') THEN
    PERFORM cron.unschedule('limpar-contas-fantasma');
  END IF;
  PERFORM cron.schedule(
    'limpar-contas-fantasma',
    '35 3 * * *',
    'SELECT public.limpar_contas_fantasma();'
  );
END
$do$;
