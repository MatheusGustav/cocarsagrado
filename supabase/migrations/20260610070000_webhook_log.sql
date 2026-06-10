-- Log de webhooks de pagamento: cada chamada da InfinitePay fica
-- registrada com o resultado — diagnóstico de pedidos presos em
-- "pendente". Escrita só via service_role (edge function); leitura
-- só para admin autenticado.
CREATE TABLE IF NOT EXISTS public.webhook_log (
  id        BIGSERIAL PRIMARY KEY,
  chave     TEXT,
  resultado TEXT NOT NULL,   -- confirmado | rejeitado | ignorado | erro
  detalhe   TEXT,
  payload   JSONB,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_chave ON public.webhook_log (chave);
CREATE INDEX IF NOT EXISTS idx_webhook_log_criado ON public.webhook_log (criado_em DESC);

ALTER TABLE public.webhook_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_le_webhook_log" ON public.webhook_log;
CREATE POLICY "admin_le_webhook_log" ON public.webhook_log
  FOR SELECT TO authenticated USING (is_admin());
