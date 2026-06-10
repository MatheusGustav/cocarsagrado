-- ============================================================
-- 1) modalidade de atendimento (vídeo-chamada ou por mensagem)
--    Usada nos badges e no filtro do catálogo. Default 'mensagem'
--    (a entrega padrão é por WhatsApp); só Consulta Ao Vivo é
--    vídeo hoje — demais podem ser marcados depois.
-- ============================================================
ALTER TABLE public.tipos_leitura
  ADD COLUMN IF NOT EXISTS modalidade TEXT NOT NULL DEFAULT 'mensagem'
  CHECK (modalidade IN ('mensagem', 'video'));

UPDATE public.tipos_leitura SET modalidade = 'video'
WHERE nome = 'Consulta Ao Vivo';

-- ============================================================
-- 2) catalogo_ranking: total de agendamentos pagos por serviço
--    (mesmo formato de service_id dos cards). Usado para ordenar
--    o catálogo por demanda e exibir prova social ("+N leituras").
--    Sem janela de tempo: contagem histórica. Só agregados.
-- ============================================================
CREATE OR REPLACE FUNCTION public.catalogo_ranking()
RETURNS TABLE (service_id text, total bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
           WHEN t.grupo_slug IS NOT NULL THEN 'grupo:' || t.grupo_slug
           WHEN t.slug IS NOT NULL THEN t.slug
           ELSE 'id-' || t.id::text
         END AS service_id,
         count(*)::bigint AS total
  FROM public.agendamentos a
  JOIN public.tipos_leitura t ON t.id = a.tipo_leitura_id
  WHERE a.status IN ('pago', 'confirmado', 'atendido')
  GROUP BY service_id;
$$;

REVOKE ALL ON FUNCTION public.catalogo_ranking() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalogo_ranking() TO anon, authenticated;
