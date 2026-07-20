-- ============================================================
-- leitura_mais_procurada: o vencedor do Matheus era "Conselho de
-- Exu" (id 28), que está INATIVO — sem card no catálogo, o badge
-- "Mais procurada" não tinha onde aparecer e o Matheus ficava sem
-- destaque. Passa a contar só leituras ativas, pra o selo sempre
-- cair num card que existe na página.
-- ============================================================
CREATE OR REPLACE FUNCTION public.leitura_mais_procurada()
RETURNS TABLE (terapeuta text, service_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT terapeuta, service_id
  FROM (
    SELECT
      t.terapeuta,
      CASE
        WHEN t.grupo_slug IS NOT NULL THEN 'grupo:' || t.grupo_slug
        WHEN t.slug IS NOT NULL THEN t.slug
        ELSE 'id-' || t.id::text
      END AS service_id,
      row_number() OVER (
        PARTITION BY t.terapeuta
        ORDER BY count(*) DESC, t.id
      ) AS rn
    FROM public.agendamentos a
    JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
    WHERE a.status IN ('pago', 'confirmado', 'atendido')
      AND a.criado_em >= now() - interval '180 days'
      AND t.terapeuta IS NOT NULL
      AND t.ativo IS TRUE
    GROUP BY t.terapeuta, service_id, t.id
  ) ranked
  WHERE rn = 1;
$$;

REVOKE ALL ON FUNCTION public.leitura_mais_procurada() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leitura_mais_procurada() TO anon, authenticated;
