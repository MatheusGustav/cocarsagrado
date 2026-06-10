-- Volume de vendas é dado interno: a RPC pública passa a devolver
-- só a ordem dos serviços por demanda, sem expor as contagens.
-- (Admin autenticado continua vendo totais direto em agendamentos.)
DROP FUNCTION IF EXISTS public.catalogo_ranking();

CREATE FUNCTION public.catalogo_ranking()
RETURNS TABLE (service_id text)
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
  GROUP BY service_id
  ORDER BY count(*) DESC, service_id;
$$;

REVOKE ALL ON FUNCTION public.catalogo_ranking() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalogo_ranking() TO anon, authenticated;
