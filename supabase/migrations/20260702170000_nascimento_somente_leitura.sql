-- ============================================================
-- Nascimento somente leitura pro cliente (decisão: opção A).
--
-- Editável, permitia "antecipar" o cupom de aniversário (setar o
-- nascimento pra amanhã). Travar só na tela não basta — dava pra
-- editar pelo console. Aqui o GRANT de UPDATE em perfis passa a ser
-- POR COLUNA: authenticated só atualiza nome/whatsapp/termos/opt-in.
-- nascimento e criado_em ficam de fora; correção de typo = admin.
-- (INSERT segue com todas as colunas: 1º login grava o nascimento.)
-- ============================================================

REVOKE UPDATE ON public.perfis FROM authenticated;
GRANT UPDATE (nome, whatsapp, termos_versao, termos_aceitos_em, aceita_emails, aceita_emails_em)
  ON public.perfis TO authenticated;
