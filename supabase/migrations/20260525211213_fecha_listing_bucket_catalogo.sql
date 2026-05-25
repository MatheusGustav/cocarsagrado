-- ============================================================
-- Fecha a LISTAGEM anônima do bucket público "catalogo".
-- Advisor: public_bucket_allows_listing.
--
-- As imagens continuam servidas via URL pública
-- (/storage/v1/object/public/catalogo/...), que NÃO passa por RLS —
-- então a exibição no site não é afetada. O painel admin só faz
-- upload()/remove()/getPublicUrl(), nunca list(). Logo, restringir o
-- SELECT (enumeração de arquivos) ao admin não quebra nada e impede
-- que anon liste todos os arquivos do bucket.
-- ============================================================

DROP POLICY IF EXISTS "catalogo_select_public" ON storage.objects;
DROP POLICY IF EXISTS "catalogo_select_admin"  ON storage.objects;
CREATE POLICY "catalogo_select_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'catalogo' AND public.is_admin());
