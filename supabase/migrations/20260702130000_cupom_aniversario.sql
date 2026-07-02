-- ============================================================
-- Cupom de aniversário
-- ------------------------------------------------------------
-- No dia do aniversário (fuso SP), todo cliente com conta ganha
-- automaticamente 1 cupom pessoal de USO ÚNICO de R$ 15, válido
-- por 15 dias. O cupom aparece no drawer pra todo mundo; o e-mail
-- de parabéns só sai pra quem ligou o opt-in (e em horário humano).
--
-- Peças:
--   1. gerar_cupons_aniversario() — roda todo dia 00:05 SP via
--      pg_cron (job 'cupons-aniversario'). Código determinístico
--      NIVERaa-XXXXXX (user+ano) + ON CONFLICT = idempotente.
--   2. emails_pendentes() v2 — cupom NIVER% vira tipo 'aniversario'
--      (template próprio na edge function) e respeita 9h–20h.
-- ============================================================

-- 1) gerar_cupons_aniversario ----------------------------------------
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
    -- fim do 15º dia após o aniversário, horário de SP
    ((v_hoje + 16)::timestamp AT TIME ZONE 'America/Sao_Paulo')
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

-- 2) emails_pendentes v2: tipo 'aniversario' + horário humano ---------
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

-- 3) Cron diário: gera os cupons às 00:05 de SP (03:05 UTC) -----------
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
