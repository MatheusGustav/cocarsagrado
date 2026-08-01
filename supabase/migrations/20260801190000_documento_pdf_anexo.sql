-- ============================================================
-- Documento do cliente vira ARQUIVO de verdade (PDF no Storage)
-- ------------------------------------------------------------
-- Antes: "Gerar PDF" só abria o diálogo de impressão — o arquivo
-- morria no computador de quem gerou e o e-mail do áudio ia sem ele.
-- Agora: o documento-verde.html rasteriza a página no navegador,
-- o painel sobe o PDF pro bucket privado "documentos" e guarda o
-- caminho em agendamentos.documento_pdf_path. A edge audio-email
-- anexa o PDF junto do áudio no MESMO e-mail; o compartilhar do
-- painel (WhatsApp) também leva os dois.
--
-- Regerar o documento substitui o arquivo (upsert no mesmo path
-- agendamento-<id>/documento.pdf) — o e-mail sempre anexa o atual.
-- Órfão no bucket após apagar agendamento é inofensivo (bucket
-- privado; mesma postura do bucket "audios").
-- ============================================================

-- Caminho do PDF no bucket "documentos". NULL = nunca salvou.
-- (documento_gerado_em segue como o carimbo de quando foi gerado.)
ALTER TABLE public.agendamentos
  ADD COLUMN documento_pdf_path TEXT;

COMMENT ON COLUMN public.agendamentos.documento_pdf_path IS
  'Caminho do PDF do documento no bucket privado "documentos". NULL = nunca salvo. O e-mail do áudio (edge audio-email) anexa quando presente.';

-- Bucket privado "documentos" (molde do bucket "audios") ---------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documentos', 'documentos', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 20971520,
      allowed_mime_types = ARRAY['application/pdf'];

-- Policies: só admin mexe (cliente recebe por e-mail/WhatsApp, não lê
-- o bucket). UPDATE é necessário pro upsert que substitui ao regerar.
DROP POLICY IF EXISTS "documentos_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "documentos_update_admin" ON storage.objects;
DROP POLICY IF EXISTS "documentos_delete_admin" ON storage.objects;
DROP POLICY IF EXISTS "documentos_select_admin" ON storage.objects;

CREATE POLICY "documentos_insert_admin"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documentos' AND public.is_admin());

CREATE POLICY "documentos_update_admin"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'documentos' AND public.is_admin())
  WITH CHECK (bucket_id = 'documentos' AND public.is_admin());

CREATE POLICY "documentos_delete_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documentos' AND public.is_admin());

-- SELECT também autoriza createSignedUrl (compartilhar no painel).
CREATE POLICY "documentos_select_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'documentos' AND public.is_admin());
