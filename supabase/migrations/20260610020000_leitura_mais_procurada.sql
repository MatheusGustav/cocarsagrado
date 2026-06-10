-- ============================================================
-- 1) Corrige typo na descrição de Confirmação de Exu
--    ("extronado" -> "estornado", "atraves" -> "através",
--     "audio" -> "áudio")
-- ============================================================
UPDATE public.tipos_leitura
SET descricao = 'Confirmação de Exu ou pombagira, com orientação detalhada por escrito através de documento + áudio explicativo. Atenção: caso a entidade não queira responder o valor é estornado.'
WHERE nome = 'Confirmação de Exu'
  AND descricao LIKE '%extronado%';

-- ============================================================
-- 2) leitura_mais_procurada: devolve o service_id (mesmo formato
--    do data-service-id dos cards: 'grupo:<slug>' | slug | 'id-<id>')
--    da leitura com mais agendamentos pagos nos últimos 180 dias.
--    Usada pelo site para destacar o card "Mais procurada".
--    SECURITY DEFINER: anon não tem SELECT em agendamentos; a
--    função expõe só um identificador agregado (sem dados de cliente).
-- ============================================================
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

REVOKE ALL ON FUNCTION public.leitura_mais_procurada() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leitura_mais_procurada() TO anon, authenticated;
