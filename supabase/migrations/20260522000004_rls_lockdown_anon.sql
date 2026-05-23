-- ============================================================
-- LOCKDOWN das policies anon
--
-- Bugs corrigidos:
--   F) anon podia UPDATE/DELETE em agendamentos (gravíssimo)
--   G) anon podia SELECT em agendamentos (vazamento LGPD)
--   +) anon tinha ALL em disponibilidade_* e configuracoes
--
-- Solução:
--   - anon mantém: INSERT em agendamentos + SELECT em tabelas
--     de catálogo/agenda/configurações (necessário pro site)
--   - SELECT direto em agendamentos é bloqueado
--   - 2 RPCs (security definer) substituem o SELECT no frontend:
--       * chave_pedido_existe(text)
--       * contar_agendamentos_por_data(text, date, date)
-- ============================================================

-- ---------- 1. Novas RPCs ----------
CREATE OR REPLACE FUNCTION public.chave_pedido_existe(p_chave text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agendamentos WHERE chave_pedido = p_chave
  );
$$;

GRANT EXECUTE ON FUNCTION public.chave_pedido_existe(text) TO anon;

-- Retorna a contagem de agendamentos ocupados por data dentro do range,
-- restrito a um terapeuta e aos status que ocupam vaga.
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

GRANT EXECUTE ON FUNCTION public.contar_agendamentos_por_data(text, date, date) TO anon;

-- ---------- 2. Lockdown: agendamentos ----------
DROP POLICY IF EXISTS "anon_select_agend"        ON public.agendamentos;
DROP POLICY IF EXISTS "anon_update_agend"        ON public.agendamentos;
DROP POLICY IF EXISTS "anon_delete_agend"        ON public.agendamentos;
DROP POLICY IF EXISTS "anon_select_agendamentos" ON public.agendamentos;
DROP POLICY IF EXISTS "anon_all_agend"           ON public.agendamentos;
-- Mantém apenas anon_insert_agend (cliente precisa criar agendamento)

-- ---------- 3. Lockdown: disponibilidade_especial ----------
DROP POLICY IF EXISTS "all_disp_especial" ON public.disponibilidade_especial;

CREATE POLICY "anon_select_disp_especial"
  ON public.disponibilidade_especial FOR SELECT
  TO anon
  USING (true);

-- ---------- 4. Lockdown: disponibilidade_override ----------
DROP POLICY IF EXISTS "all_disp_override" ON public.disponibilidade_override;

CREATE POLICY "anon_select_disp_override"
  ON public.disponibilidade_override FOR SELECT
  TO anon
  USING (true);

-- ---------- 5. Lockdown: configuracoes ----------
DROP POLICY IF EXISTS "escrita_admin"    ON public.configuracoes;
DROP POLICY IF EXISTS "leitura_publica"  ON public.configuracoes;

CREATE POLICY "anon_select_configuracoes"
  ON public.configuracoes FOR SELECT
  TO anon
  USING (true);

-- ---------- 6. Triggers: SECURITY DEFINER ----------
-- Sem SECURITY DEFINER, os triggers rodam com permissões do INSERT
-- (anon) e falham porque anon perdeu SELECT/UPDATE nessas tabelas.

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

-- A RPC cliente_elegivel_desconto também faz SELECT em agendamentos
-- e deve rodar com privilégios elevados.
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
