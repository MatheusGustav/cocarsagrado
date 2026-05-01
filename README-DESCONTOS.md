# Sistema de Descontos — Cocar Sagrado

## Como funciona

### Desconto de 10% (Novos Clientes)
- Aparece no modal de boas-vindas na primeira visita
- Se **aceito**: usuário vê 10% de desconto em **todos** os atendimentos, sempre
- Se **recusado** (ou fechado com X / ESC): usuário pode ver promoções específicas abaixo

### Promoções Específicas (`/data/promocoes.json`)
- Cada leitura tem sua própria configuração de desconto
- Promoções **só aparecem** para quem **não aceitou** os 10%
- Visitantes antigos (sem localStorage) também podem ver promoções

### Prioridade
```
Aceitou 10%? → mostra 10% em tudo (ignora JSON)
      ↓ não
Há promoção ativa no JSON? → mostra promoção
      ↓ não
Mostra preço normal
```

---

## Como ativar uma promoção

1. Abrir `/data/promocoes.json`
2. Localizar a leitura desejada pelo `"id"`
3. Alterar `"descontoAtivo"` para `true`
4. Definir `"percentualDesconto"` (ex: `25` para 25%)
5. Configurar `"badge"` (texto que aparece no card) e `"mensagemPromocional"` (opcional)
6. Salvar o arquivo — a mudança reflete imediatamente ao carregar a página

**Exemplo:**
```json
{
  "id": "buzios-completo",
  "nome": "Búzios Completo",
  "tipo": "simples",
  "preco": 150,
  "descontoAtivo": true,
  "percentualDesconto": 20,
  "badge": "PROMOÇÃO",
  "mensagemPromocional": "20% de desconto por tempo limitado!"
}
```

## Como desativar uma promoção

Alterar `"descontoAtivo"` para `false`. Pronto.

---

## Serviços disponíveis e seus IDs

| ID | Nome | Tipo | Preço base |
|----|------|------|------------|
| `buzios-avulso` | Búzios Avulso | tiers (3 faixas) | R$ 30 / 50 / 70 |
| `buzios-completo` | Búzios Completo | simples | R$ 150 |
| `confirmacao-orixas` | Confirmação de Orixás | simples | R$ 50 |
| `cabala-odu` | Cabala de Odu | simples | R$ 50 |
| `confirmacao-exu` | Confirmação de Exu | simples | R$ 70 |
| `mesa-cigana-avulsa` | Mesa Cigana Avulsa | tiers (3 faixas) | R$ 30 / 50 / 70 |
| `mesa-cigana-completa` | Mesa Cigana Completa | simples | R$ 150 |
| `aguas-oxum` | Águas de Oxum | simples | R$ 50 |
| `rosa-venus` | Rosa de Vênus | simples | R$ 55 |
| `leitura-mentores` | Leitura dos Mentores | simples | R$ 50 |
| `mesa-mediunica` | Mesa Mediúnica | simples | R$ 70 |
| `mesa-radionica` | Mesa Radiônica | simples | R$ 222 |
| `registros-akashicos` | Registros Akáshicos | simples | R$ 188 |
| `theta-healing` | Theta Healing | simples | R$ 150 |

---

## Chaves de localStorage

| Chave | Valores | Descrição |
|-------|---------|-----------|
| `cocarsagrado_visitou` | `"true"` | Usuário já viu o modal |
| `aceitouDesconto10` | `"true"` / `"false"` | Escolha do desconto de 10% |

**Para testar novamente o modal** (console do navegador):
```js
localStorage.removeItem('cocarsagrado_visitou')
localStorage.removeItem('aceitouDesconto10')
location.reload()
```

**Para simular usuário que aceitou o desconto:**
```js
localStorage.setItem('aceitouDesconto10', 'true')
location.reload()
```

---

## Arquivos do sistema

| Arquivo | Função |
|---------|--------|
| `/data/promocoes.json` | Configuração de promoções — edite aqui |
| `/js/discount-system.js` | Lógica de descontos (não editar) |
| `/script.js` | Integração com o modal |
| `/style.css` | Estilos dos badges e preços riscados |
