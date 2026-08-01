-- Selinho "doc emitido" no painel: registra quando algum documento
-- (documento-verde.html, botão "Gerar PDF") foi gerado pro agendamento.
-- Nula e sem default → mudança só de metadado, sem rewrite da tabela.
-- Escrita: painel admin (authenticated + is_admin, política já existente).
ALTER TABLE public.agendamentos
  ADD COLUMN documento_gerado_em TIMESTAMPTZ;

COMMENT ON COLUMN public.agendamentos.documento_gerado_em IS
  'Última vez que um documento do cliente foi gerado (PDF) pelo painel. NULL = nunca.';
