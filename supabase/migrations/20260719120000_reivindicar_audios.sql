-- ============================================================
-- Áudios acompanham a reivindicação de pedidos guest
-- ------------------------------------------------------------
-- Bug: audios_cliente.user_id é snapshot no INSERT (trigger
-- audio_seta_user_id). Áudio gravado enquanto o pedido era guest
-- fica com user_id NULL pra sempre — reivindicar_pedidos() só
-- atualizava pedidos.user_id, então meus_audios() e a policy do
-- storage (ambas casam por ac.user_id) nunca mostravam o áudio.
--
-- Correção:
--   1. reivindicar_pedidos() ganha 2º UPDATE que propaga a adoção
--      para audios_cliente (via agendamentos → pedidos). Cobre
--      também pedidos adotados em execuções anteriores (self-heal).
--   2. Backfill único dos áudios já órfãos de pedidos com dono.
-- ============================================================

-- 1) reivindicar_pedidos: pedidos + áudios ----------------------------
CREATE OR REPLACE FUNCTION public.reivindicar_pedidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_n     integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  v_email := lower(NULLIF(trim(auth.jwt()->>'email'), ''));
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.pedidos
  SET user_id = auth.uid()
  WHERE user_id IS NULL
    AND lower(trim(cliente_email)) = v_email;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Áudios gravados enquanto o pedido era guest ficaram com
  -- user_id NULL (trigger é snapshot no INSERT). Propaga a adoção.
  UPDATE public.audios_cliente ac
  SET user_id = auth.uid()
  FROM public.agendamentos a
  JOIN public.pedidos p ON p.id = a.pedido_id
  WHERE a.id = ac.agendamento_id
    AND ac.user_id IS NULL
    AND p.user_id = auth.uid();

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.reivindicar_pedidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reivindicar_pedidos() TO authenticated;

-- 2) Backfill único: áudios órfãos cujo pedido já tem dono ------------
UPDATE public.audios_cliente ac
SET user_id = p.user_id
FROM public.agendamentos a
JOIN public.pedidos p ON p.id = a.pedido_id
WHERE a.id = ac.agendamento_id
  AND ac.user_id IS NULL
  AND p.user_id IS NOT NULL;
