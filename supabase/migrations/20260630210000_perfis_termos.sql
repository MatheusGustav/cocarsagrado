-- ============================================================
-- Aceite de termos no perfil de cliente.
--
-- Quem tem conta aceita os termos UMA vez (ao completar o perfil
-- no 1º login). Guardamos QUAL versão foi aceita e QUANDO: se os
-- termos mudarem, o login compara a versão e pede re-aceite.
--
-- Guests (sem conta) aceitam a cada pedido — isso é só trava de
-- UI no checkout, não tem linha aqui pra gravar.
-- ============================================================

ALTER TABLE public.perfis
  ADD COLUMN termos_versao    text,
  ADD COLUMN termos_aceitos_em timestamptz;
