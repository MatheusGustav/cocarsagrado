-- ============================================================
-- Trigger atômico para decremento de vagas especiais
-- Previne overbooking em condição de corrida (2 clientes
-- pegando a última vaga simultaneamente).
--
-- O FOR UPDATE bloqueia a linha de disponibilidade_especial:
-- o segundo INSERT concorrente espera o primeiro commitar e
-- então lê o vagas_restantes já atualizado.
-- ============================================================

CREATE OR REPLACE FUNCTION public.decrementar_vaga_especial_trigger()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decrementar_vaga_especial ON public.agendamentos;

CREATE TRIGGER trg_decrementar_vaga_especial
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.decrementar_vaga_especial_trigger();
