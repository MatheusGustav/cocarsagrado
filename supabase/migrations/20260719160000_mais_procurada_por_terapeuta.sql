-- ============================================================
-- leitura_mais_procurada: era um único vencedor GLOBAL (LIMIT 1),
-- então só um terapeuta do site ganhava o selo "Mais procurada" —
-- hoje sempre caía pra Camila por volume. Troca por um vencedor
-- POR TERAPEUTA (top-1 de cada), pra Matheus e Camila terem seu
-- próprio destaque no catálogo.
-- ============================================================
DROP FUNCTION IF EXISTS public.leitura_mais_procurada();

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
    GROUP BY t.terapeuta, service_id, t.id
  ) ranked
  WHERE rn = 1;
$$;

REVOKE ALL ON FUNCTION public.leitura_mais_procurada() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leitura_mais_procurada() TO anon, authenticated;
