# Sistema de Agendamento — Cocar Sagrado

## Visão Geral

Sistema de agendamento para leituras espirituais integrado ao Supabase (PostgreSQL cloud). O cliente escolhe a leitura, data e horário, preenche seus dados e é redirecionado para a página de pagamento. O administrador gerencia tudo pelo painel `/admin/dashboard.html`.

---

## Fluxo Completo

### Fluxo do Cliente
1. Acessa `/agendar.html`
2. Escolhe o tipo de leitura (com desconto de 10% se elegível)
3. Seleciona a data (próximos 30 dias com atendimento configurado)
4. Seleciona o horário (slots de 30 min, sem conflito com existentes)
5. Preenche nome, e-mail e WhatsApp
6. É redirecionado para `/pagamento.html` com a chave do pedido
7. Paga via PIX, Cartão ou Wise e avisa via WhatsApp

### Fluxo do Administrador
1. Acessa `/admin/dashboard.html`
2. Visualiza estatísticas do dia e do mês
3. Filtra agendamentos por status ou data
4. Marca como **Pago** ao confirmar recebimento
5. Marca como **Atendido** após realizar a leitura
6. Envia mensagem de confirmação via WhatsApp com um clique
7. Exporta relatório em CSV quando necessário

---

## Estrutura do Banco de Dados

### `tipos_leitura`
| Campo | Tipo | Descrição |
|---|---|---|
| id | UUID | Chave primária |
| nome | TEXT | Ex: "Tarot Completo" |
| descricao | TEXT | Texto exibido no card |
| preco_original | DECIMAL | Preço sem desconto |
| duracao_minutos | INTEGER | Duração do atendimento |
| ativo | BOOLEAN | Ocultar sem deletar |
| created_at | TIMESTAMPTZ | Data de criação |

### `horarios_disponiveis`
| Campo | Tipo | Descrição |
|---|---|---|
| id | UUID | Chave primária |
| dia_semana | INTEGER | 0=Dom, 1=Seg, ..., 6=Sáb |
| hora_inicio | TIME | Ex: "09:00" |
| hora_fim | TIME | Ex: "18:00" |
| ativo | BOOLEAN | Habilitar/desabilitar |

### `agendamentos`
| Campo | Tipo | Descrição |
|---|---|---|
| id | UUID | Chave primária |
| chave_pedido | TEXT UNIQUE | Formato CS-XXXX-XXXX-XXXX |
| tipo_leitura_id | UUID FK | Referência tipos_leitura |
| cliente_nome | TEXT | Nome completo |
| cliente_email | TEXT | E-mail |
| cliente_whatsapp | TEXT | Telefone |
| cliente_observacoes | TEXT | Opcional |
| data_agendamento | DATE | Data escolhida |
| hora_agendamento | TIME | Horário escolhido |
| duracao_minutos | INTEGER | Copiado do tipo |
| valor_original | DECIMAL | Preço sem desconto |
| desconto_aplicado | DECIMAL | Valor abatido |
| valor_final | DECIMAL | Valor a pagar |
| metodo_pagamento | TEXT | pix / cartao / wise |
| status | TEXT | pendente→pago→atendido |
| aceitou_desconto_10 | BOOLEAN | Flag do localStorage |
| pago_em | TIMESTAMPTZ | Timestamp do pagamento |
| atendido_em | TIMESTAMPTZ | Timestamp do atendimento |
| created_at | TIMESTAMPTZ | Criação do registro |
| updated_at | TIMESTAMPTZ | Última atualização |

### `bloqueios_horario`
| Campo | Tipo | Descrição |
|---|---|---|
| id | UUID | Chave primária |
| data_bloqueio | DATE | Dia bloqueado |
| hora_inicio | TIME | Início do bloqueio |
| hora_fim | TIME | Fim do bloqueio |
| motivo | TEXT | Motivo (opcional) |

---

## Configuração do Supabase

### 1. Criar projeto
- Acesse [supabase.com](https://supabase.com) → New Project
- Escolha região: South America (São Paulo)

### 2. Executar SQL
- Menu: SQL Editor → New query
- Cole o conteúdo de `supabase-setup.sql`
- Execute (Run)

### 3. Obter credenciais
- Menu: Settings → API
- Copie **Project URL** e **anon public key**

### 4. Editar `js/supabase-config.js`
```js
const SUPABASE_CONFIG = {
  url: 'https://xxxxxxxxxxxx.supabase.co',
  anonKey: 'eyJ...'
};
```

---

## Segurança e RLS

As políticas Row Level Security configuradas:

| Tabela | Operação | Política |
|---|---|---|
| tipos_leitura | SELECT | `ativo = TRUE` |
| horarios_disponiveis | SELECT | `ativo = TRUE` |
| agendamentos | INSERT | Público |
| agendamentos | SELECT | Público (verificar disponibilidade) |
| agendamentos | UPDATE | Público (admin atualiza status) |
| bloqueios_horario | SELECT | Público |

> **Melhoria futura:** Proteger UPDATE de agendamentos com autenticação Supabase Auth para o admin.

---

## Queries Úteis

### Agendamentos pendentes de hoje
```sql
SELECT a.*, t.nome AS tipo
FROM agendamentos a
LEFT JOIN tipos_leitura t ON t.id = a.tipo_leitura_id
WHERE a.data_agendamento = CURRENT_DATE
  AND a.status = 'pendente'
ORDER BY a.hora_agendamento;
```

### Total faturado no mês
```sql
SELECT SUM(valor_final) AS total
FROM agendamentos
WHERE date_trunc('month', data_agendamento) = date_trunc('month', CURRENT_DATE)
  AND status IN ('pago', 'confirmado', 'atendido');
```

### Bloquear um dia inteiro
```sql
INSERT INTO bloqueios_horario (data_bloqueio, hora_inicio, hora_fim, motivo)
VALUES ('2025-12-25', '00:00', '23:59', 'Natal');
```

---

## Integração com Sistema de Descontos

O sistema lê `localStorage.getItem('aceitouDesconto10')`:
- `'true'` → aplica 10% em todos os tipos de leitura
- outro valor → preço normal

O campo `aceitou_desconto_10` é salvo em cada agendamento para auditoria.

---

## Changelog

### v1.0.0
- Sistema de agendamento em 4 passos
- Página de pagamento com PIX, Cartão e Wise
- Painel admin com estatísticas, filtros e ações
- Integração com desconto de 10%
- Prevenção de double-booking
- Exportação CSV
