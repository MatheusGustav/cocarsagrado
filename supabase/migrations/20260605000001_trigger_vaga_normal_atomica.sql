-- ============================================================
-- Anti-overbooking para leituras NORMAIS (não especiais).
-- Antes só as especiais tinham trava no banco; duas compras
-- simultâneas podiam ultrapassar as vagas do dia.
-- O FOR UPDATE na linha do override serializa INSERTs
-- concorrentes do mesmo dia/terapeuta (mesmo padrão do trigger
-- das especiais). A mensagem contém "Sem vagas" — o frontend
-- já traduz esse erro para o cliente.
-- ============================================================

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
  -- Especiais têm trigger próprio (trg_decrementar_vaga_especial)
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

DROP TRIGGER IF EXISTS trg_validar_vaga_normal ON public.agendamentos;

CREATE TRIGGER trg_validar_vaga_normal
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_vaga_normal_trigger();
