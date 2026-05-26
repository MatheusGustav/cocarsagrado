-- ============================================================
-- Migration: cria_tabela_pedidos
-- Cria a tabela pai `pedidos` e adiciona `pedido_id` em
-- `agendamentos`, além de remover UNIQUE de chave_pedido
-- (agora 1 pedido pode ter N agendamentos).
-- ============================================================

-- 1) Tabela pai: pedidos
CREATE TABLE IF NOT EXISTS public.pedidos (
  id                  BIGSERIAL PRIMARY KEY,
  chave_pedido        TEXT NOT NULL UNIQUE,
  cliente_nome        TEXT NOT NULL,
  cliente_nascimento  DATE,
  cliente_whatsapp    TEXT NOT NULL,
  cliente_email       TEXT,
  valor_total         NUMERIC(10,2) NOT NULL CHECK (valor_total >= 0),
  aceitou_desconto_10 BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','pago','cancelado')),
  metodo_pagamento    TEXT,
  payment_id          TEXT,
  pago_em             TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pedidos_chave   ON public.pedidos (chave_pedido);
CREATE INDEX idx_pedidos_status  ON public.pedidos (status);
CREATE INDEX idx_pedidos_whatsapp ON public.pedidos (regexp_replace(cliente_whatsapp, '\D', '', 'g'));

-- 2) Adiciona pedido_id em agendamentos
--    Mantém chave_pedido no filho (denormalizado) para compatibilidade
--    com triggers, RPCs e admin dashboard.
--    Remove UNIQUE de chave_pedido (1 pedido = 1 chave → N agendamentos).
ALTER TABLE public.agendamentos
  ADD COLUMN pedido_id BIGINT REFERENCES public.pedidos(id) ON DELETE CASCADE;

-- Remove UNIQUE de chave_pedido (agora 1 pedido = 1 chave → N linhas)
ALTER TABLE public.agendamentos DROP CONSTRAINT IF EXISTS agendamentos_chave_pedido_key;

-- Recria o índice não único para performance
DROP INDEX IF EXISTS public.idx_agend_chave;
CREATE INDEX idx_agend_chave ON public.agendamentos (chave_pedido);

CREATE INDEX idx_agend_pedido_id ON public.agendamentos (pedido_id);
