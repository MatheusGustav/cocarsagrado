# Cocar Sagrado — Site Completo
**Matheus & Camila | cocarsagrado.com.br**

---

## Arquivos entregues

| Arquivo | Tamanho | Descrição |
|---|---|---|
| `index.html` | 26 KB | Estrutura completa da página |
| `style.css` | 28 KB | Todo o visual, cores e responsividade |
| `script.js` | 13 KB | Interatividade, overlay e filtros |

---

## Como usar

1. Faça upload dos 3 arquivos para o seu servidor/hospedagem na mesma pasta.
2. Acesse `index.html` no navegador — o site já funciona.
3. Nenhuma dependência externa além das fontes do Google (carregadas automaticamente).

---

## Personalização rápida

### Trocar foto de Camila e Matheus
No `index.html`, localize o bloco:
```html
<div class="hero-photo-placeholder">
  <div class="photo-circle"></div>
  <p class="photo-caption">Camila & Matheus</p>
</div>
```
Substitua por:
```html
<img src="foto-camila-matheus.jpg" alt="Camila e Matheus" class="hero-photo" />
```
E no `style.css`, troque `.hero-photo-placeholder` por:
```css
.hero-photo {
  width: 100%;
  border-radius: 16px;
  object-fit: cover;
}
```

### Ativar feed real do Instagram
No `index.html`, localize o comentário `<!-- Preview simulado do Instagram -->` e substitua o bloco `.ig-posts-grid` pelo código de embed do **Behold.so** ou **Elfsight** (gerado no site de cada serviço).

### Ativar desconto automático
No `script.js`, localize o bloco `DESCONTO_CONFIG` e altere:
```js
const DESCONTO_CONFIG = {
  ATIVO: true,           // ← mude para true
  PERCENTUAL: 15,        // ← valor do desconto
  MENSAGEM: "Aproveite 15% de desconto esta semana!",
  CODIGO: "SAGRADO15",
  VALIDADE: "Apenas esta semana"
};
```

### Adicionar depoimentos reais
No `index.html`, localize a seção `<!-- SEÇÃO DEPOIMENTOS -->` e edite os três blocos `.depo-card` com os textos reais dos consulentes.

---

## Testar o overlay de primeira visita novamente
Abra o console do navegador (F12) e execute:
```js
localStorage.removeItem('cocarsagrado_visitou')
```
Depois recarregue a página — o overlay aparecerá novamente.

---

## Cores do site (para usar em outros materiais)

| Nome | Hex | Uso |
|---|---|---|
| Roxo profundo | `#26215C` | Títulos principais |
| Roxo principal | `#3C3489` | Botões, destaques |
| Roxo médio | `#534AB7` | Textos de apoio |
| Roxo claro | `#EEEDFE` | Fundos suaves |
| Teal | `#1D9E75` | Cor do Matheus |
| Âmbar | `#BA7517` | Estrelas, destaques |

---

## Fontes

- **Cormorant Garamond** — títulos e citações (espiritual, elegante)
- **DM Sans** — corpo, botões, labels (limpo, legível)

Carregadas via Google Fonts, sem necessidade de instalação.

---

*Gerado por Claude — Anthropic | Cocar Sagrado © 2026*