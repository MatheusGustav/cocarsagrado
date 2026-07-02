-- ============================================================
-- Cupom de aniversário: validade cai de 15 pra 7 dias.
-- (O e-mail sai no próprio dia, 9h–20h — na prática é "7 dias
-- depois do aviso". Ancorado no aniversário porque quem não tem
-- opt-in não recebe e-mail, mas vê o cupom no drawer.)
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
  v_n        integer;
BEGIN
  INSERT INTO public.cupons (codigo, valor_desconto, descricao, ativo, uso_unico, user_id, expira_em)
  SELECT
    'NIVER' || to_char(v_hoje, 'YY') || '-'
      || upper(substr(md5(p.id::text || v_ano::text), 1, 6)),
    15,
    'aniversário: ' || p.nome,
    TRUE,
    TRUE,
    p.id,
    -- fim do 7º dia após o aniversário, horário de SP
    ((v_hoje + 8)::timestamp AT TIME ZONE 'America/Sao_Paulo')
  FROM public.perfis p
  WHERE (
    (extract(month FROM p.nascimento) = extract(month FROM v_hoje)
     AND extract(day FROM p.nascimento) = extract(day FROM v_hoje))
    -- nascido em 29/02: em ano não-bissexto comemora em 28/02
    OR (to_char(p.nascimento, 'MM-DD') = '02-29'
        AND to_char(v_hoje, 'MM-DD') = '02-28'
        AND NOT v_bissexto)
  )
  ON CONFLICT (codigo) DO NOTHING;  -- idempotente: já ganhou este ano, pula

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_cupons_aniversario() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_cupons_aniversario() TO service_role;
