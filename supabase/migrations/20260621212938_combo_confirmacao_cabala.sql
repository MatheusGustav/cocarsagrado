-- Substitui "Combo + 10" pelo combo Confirmação de Orixás + Cabala de Odu.
-- O card do catálogo mostra as duas fotos na diagonal: imagem_url guarda as
-- duas URLs separadas por "|" (a primeira fica na frente). O front detecta o
-- "|" em _catImg() (js/agendamento-system.js) e empilha os dois círculos.
-- Preço e descrição ficam para ajuste posterior no painel admin.
UPDATE public.tipos_leitura
SET nome = 'Combo',
    imagem_url = 'https://cdn.cocarsagrado.com.br/3468a514-574a-46bb-a93a-271a8db42317.webp|https://cdn.cocarsagrado.com.br/df88dd1d-0634-4789-baac-48823fe7c1a2.webp'
WHERE slug = 'combo-10';
