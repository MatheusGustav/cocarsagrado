-- ============================================================
-- Adiciona coluna metodo_pagamento em agendamentos.
-- O webhook da InfinitePay (infinitypay-webhook) grava o método
-- (pix/cartao) ao confirmar o pagamento, e o painel admin filtra
-- e exibe por esse campo. A coluna constava no setup.sql mas nunca
-- existiu no banco real, o que fazia o UPDATE do webhook falhar
-- silenciosamente — pendente nunca virava pago.
-- ============================================================

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS metodo_pagamento TEXT;
