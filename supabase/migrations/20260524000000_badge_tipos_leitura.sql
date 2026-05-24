-- Adiciona coluna badge em tipos_leitura
ALTER TABLE public.tipos_leitura
  ADD COLUMN IF NOT EXISTS badge TEXT
    CHECK (badge IS NULL OR badge IN ('buzios', 'cartas', 'radiestesia'));
