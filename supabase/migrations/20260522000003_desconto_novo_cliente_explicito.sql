-- ============================================================
-- Bloqueio explícito do desconto de novo cliente para recorrentes
--
-- Antes: trigger zerava silenciosamente o desconto se cliente já
-- tinha agendamento pago/confirmado/atendido. Problema: cliente
-- pagava (externamente) o valor descontado, mas o registro ficava
-- com valor cheio, causando discrepância.
--
-- Agora:
--   1. RPC cliente_elegivel_desconto: o frontend consulta antes
--      do INSERT e ajusta a UI se necessário (sem cobrar valor errado)
--   2. Trigger: bloqueia o INSERT com exceção em vez de mutar
-- ============================================================

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
