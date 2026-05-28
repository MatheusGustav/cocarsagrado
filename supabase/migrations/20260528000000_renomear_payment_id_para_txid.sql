ALTER TABLE public.pedidos      RENAME COLUMN payment_id TO txid;
ALTER TABLE public.agendamentos RENAME COLUMN payment_id TO txid;
