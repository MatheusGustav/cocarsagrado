-- Modalidade ganha terceira opção: áudio gravado.
-- Selecionável no admin ao cadastrar/editar leituras.
ALTER TABLE public.tipos_leitura
  DROP CONSTRAINT IF EXISTS tipos_leitura_modalidade_check;

ALTER TABLE public.tipos_leitura
  ADD CONSTRAINT tipos_leitura_modalidade_check
  CHECK (modalidade IN ('mensagem', 'video', 'audio'));
