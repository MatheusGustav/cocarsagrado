# Instalação Rápida — Sistema de Agendamento

Tempo estimado: **15 minutos**

---

## Passo 1 — Criar projeto no Supabase (3 min)

1. Acesse [supabase.com](https://supabase.com) e faça login (ou crie conta grátis)
2. Clique em **New Project**
3. Preencha:
   - **Name:** cocarsagrado (ou qualquer nome)
   - **Database Password:** escolha uma senha forte e guarde
   - **Region:** South America (São Paulo)
4. Clique em **Create new project** e aguarde ~2 minutos

---

## Passo 2 — Executar o SQL (2 min)

1. No painel do projeto, clique em **SQL Editor** (menu lateral)
2. Clique em **New query**
3. Abra o arquivo `supabase-setup.sql` deste projeto e copie todo o conteúdo
4. Cole no editor e clique em **Run** (▶)
5. Deve aparecer "Success" — as tabelas e dados foram criados ✅

---

## Passo 3 — Copiar credenciais (1 min)

1. No menu lateral, clique em **Settings** → **API**
2. Copie dois valores:
   - **Project URL** → ex: `https://abcdefghij.supabase.co`
   - **anon public** (em Project API keys) → começa com `eyJ...`

---

## Passo 4 — Editar `js/supabase-config.js` (1 min)

Abra o arquivo `js/supabase-config.js` e substitua:

```js
const SUPABASE_CONFIG = {
  url: 'https://SEU-PROJETO.supabase.co',  // ← cole o Project URL
  anonKey: 'SUA-ANON-KEY-AQUI'            // ← cole a anon public key
};
```

---

## Passo 5 — Personalizar informações de contato (2 min)

### Em `pagamento.html` (linhas no `<script>` ao final):
```js
const WHATSAPP_NUMERO = '5527999999999'; // ← seu número com DDI (55) + DDD + número
const CHAVE_PIX       = 'chave-pix@email.com'; // ← sua chave PIX
const EMAIL_WISE      = 'pagamentos@cocarsagrado.com'; // ← seu e-mail Wise
```

### Em `admin/js/admin-system.js` (linha 1):
```js
const WHATSAPP_ADMIN = '5527999999999'; // ← mesmo número
```

**Formato do WhatsApp:** código do país + DDD + número, sem espaços ou símbolos.
- Brasil (27) 99876-5432 → `5527998765432`

---

## Passo 6 — Upload dos arquivos (3 min)

Faça upload de **todos** os arquivos para o seu servidor/hospedagem mantendo a estrutura de pastas:

```
/
├── agendar.html
├── pagamento.html
├── css/agendamento-styles.css
├── js/supabase-config.js
├── js/agendamento-system.js
└── admin/
    ├── dashboard.html
    └── js/admin-system.js
```

> Se usar GitHub Pages, Netlify ou Vercel, basta fazer push/deploy normalmente.

---

## Passo 7 — Testar (3 min)

1. Acesse `/agendar.html` no seu site
2. Escolha uma leitura → data → horário → preencha dados fictícios → submeta
3. Você deve ser redirecionado para `/pagamento.html` com a chave do pedido
4. Acesse `/admin/dashboard.html` e verifique se o agendamento aparece
5. Clique em "Marcar como Pago" e confirme a mudança de status ✅

---

## Personalizar tipos de leitura

No Supabase → **Table Editor** → `tipos_leitura`:
- Edite preços, nomes e descrições
- Desative registros com `ativo = false` para ocultá-los sem deletar
- Adicione novos tipos diretamente pela interface

---

## Personalizar horários

No Supabase → **Table Editor** → `horarios_disponiveis`:
- Altere `hora_inicio` e `hora_fim`
- Adicione sábado: `dia_semana = 6, hora_inicio = '09:00', hora_fim = '13:00'`
- Desative dias com `ativo = false`

---

## Bloquear datas/horários específicos

No Supabase → SQL Editor:
```sql
-- Bloquear um dia inteiro
INSERT INTO bloqueios_horario (data_bloqueio, hora_inicio, hora_fim, motivo)
VALUES ('2025-12-25', '00:00', '23:59', 'Férias');

-- Bloquear horário específico
INSERT INTO bloqueios_horario (data_bloqueio, hora_inicio, hora_fim, motivo)
VALUES ('2025-06-10', '14:00', '16:00', 'Compromisso pessoal');
```

> **Nota:** os bloqueios são consultados na página de agendamento, mas a lógica de exclusão por bloqueio deve ser adicionada em `gerarSlots()` no `agendamento-system.js` se necessário.

---

## Troubleshooting

### "Erro ao conectar Supabase" no console
- Verifique se URL e anonKey estão corretos em `supabase-config.js`
- Certifique-se de que o script do Supabase CDN carregou (verifique DevTools → Network)

### Nenhum tipo de leitura aparece
- Verifique se executou o `supabase-setup.sql` corretamente
- Confirme no Supabase → Table Editor → `tipos_leitura` que há registros com `ativo = true`
- Verifique se as políticas RLS foram criadas (SQL Editor → execute o SQL novamente se necessário)

### Nenhum horário aparece no calendário
- Confirme que a tabela `horarios_disponiveis` tem registros com `ativo = true`
- Os dias configurados por padrão são Segunda a Sexta (dia_semana 1–5)

### Double-booking ainda acontece
- É improvável, mas em caso de concorrência extrema pode ocorrer
- Para proteção extra, adicione um UNIQUE constraint no Supabase:
  ```sql
  ALTER TABLE agendamentos ADD CONSTRAINT unique_horario
    UNIQUE (data_agendamento, hora_agendamento, tipo_leitura_id);
  ```

### Painel admin não atualiza após ação
- As funções `marcarComoPago`, `marcarComoAtendido` e `cancelarAgendamento` chamam `carregarAgendamentos()` automaticamente
- Se não atualizar, verifique erros no console do navegador (F12)
