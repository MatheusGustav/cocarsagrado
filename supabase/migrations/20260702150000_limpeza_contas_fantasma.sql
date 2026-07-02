-- ============================================================
-- Limpeza de contas fantasma
-- ------------------------------------------------------------
-- O Supabase cria o usuário quando o código OTP é PEDIDO, não
-- quando é confirmado — e-mail digitado errado virava conta morta.
-- O front agora confirma antes de criar conta nova; esta vassoura
-- pega o que ainda escapar: apaga contas que NUNCA confirmaram o
-- código e têm mais de 7 dias. Quem nunca confirmou nunca logou —
-- não tem perfil, pedido nem nada pendurado.
-- Cron diário 'limpar-contas-fantasma' às 00:35 SP.
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
    -- cinto e suspensório: nunca-confirmado não tem perfil nem pedido,
    -- mas se um dia tiver, não apaga.
    AND NOT EXISTS (SELECT 1 FROM public.perfis  p WHERE p.id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.pedidos o WHERE o.user_id = u.id);

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
