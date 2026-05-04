/* ============================================================
   SISTEMA DE DESCONTOS — COCAR SAGRADO
   Gerencia desconto de 10% para novos clientes e promoções
   configuráveis via /data/promocoes.json
   ============================================================

   PRIORIDADE:
   1. Usuário aceitou 10% → mostra 10% em TUDO, ignora JSON
   2. Usuário recusou (ou visitante antigo) → verifica JSON
   3. Sem promoção no JSON → preço normal
   ============================================================ */

const DESCONTO_10_KEY = 'aceitouDesconto10';

let _promocoesCache = null;

async function carregarPromocoes() {
  if (_promocoesCache !== null) return _promocoesCache;
  try {
    const r = await fetch('data/promocoes.json');
    if (!r.ok) throw new Error('fetch failed');
    const data = await r.json();
    _promocoesCache = data.promocoes || [];
  } catch {
    _promocoesCache = [];
  }
  return _promocoesCache;
}

function verificarStatusDesconto10() {
  return localStorage.getItem(DESCONTO_10_KEY) === 'true';
}

function calcularResultado(servico, aceitou10) {
  if (aceitou10) {
    return { tipo: '10off', percentual: 10, badge: '10% OFF' };
  }
  if (servico && servico.descontoAtivo && servico.percentualDesconto > 0) {
    return {
      tipo: 'promocao',
      percentual: servico.percentualDesconto,
      badge: servico.badge || ''
    };
  }
  return { tipo: 'normal' };
}

// Arredonda para o centavo. Mesma fórmula usada em agendamento-system.js
// para que o preço exibido no catálogo bata com o cobrado no checkout.
function aplicarDesconto(valor, percentual) {
  return Math.round(valor * (100 - percentual)) / 100;
}

// "R$ 199,80" — sem casas decimais quando o valor é inteiro.
function formatarMoeda(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n)
    ? `R$&nbsp;${n}`
    : `R$&nbsp;${n.toFixed(2).replace('.', ',')}`;
}

function renderizarPrecoSimples(footer, preco, resultado) {
  const btn = footer.querySelector('.cat-btn');
  const jaTemDesconto = !!footer.querySelector('.cat-price-wrapper');

  if (resultado.tipo === 'normal') {
    if (!jaTemDesconto) return; // DOM já está correto, sem desconto
    footer.querySelector('.cat-price-wrapper').remove();
    const span = document.createElement('span');
    span.className = 'cat-footer-price';
    span.innerHTML = formatarMoeda(preco);
    footer.insertBefore(span, btn);
    return;
  }

  // Remove markup anterior (seja preço original ou desconto anterior)
  footer.querySelectorAll('.cat-footer-price, .cat-price-wrapper').forEach(el => el.remove());

  const precoDesc = aplicarDesconto(preco, resultado.percentual);
  const badgeClass = resultado.tipo === '10off' ? 'cat-badge--10off' : 'cat-badge--promo';

  const wrapper = document.createElement('div');
  wrapper.className = 'cat-price-wrapper';
  wrapper.innerHTML = `${resultado.badge
    ? `<span class="cat-badge ${badgeClass}">${resultado.badge}</span>`
    : ''}
    <div class="cat-price-group">
      <span class="cat-price-original" aria-hidden="true">${formatarMoeda(preco)}</span>
      <span class="cat-price-desconto"
        aria-label="Preço original R$ ${preco}, com desconto de ${resultado.percentual}% por R$ ${precoDesc}">
        ${formatarMoeda(precoDesc)}
      </span>
    </div>`;
  footer.insertBefore(wrapper, btn);
}

function renderizarPrecoTiers(footer, tiers, resultado) {
  const tiersEl = footer.querySelector('.cat-footer-tiers');
  if (!tiersEl) return;

  const jaTemDesconto = !!tiersEl.querySelector('.cat-badge-tier');

  if (resultado.tipo === 'normal') {
    if (!jaTemDesconto) return; // DOM já está correto
    tiersEl.innerHTML = tiers
      .map(t => `<span><span>${t.label}</span><strong>${formatarMoeda(t.preco)}</strong></span>`)
      .join('');
    return;
  }

  // Reconstrói do zero com desconto
  tiersEl.innerHTML = '';

  if (resultado.badge) {
    const badgeEl = document.createElement('div');
    badgeEl.className = `cat-badge-tier cat-badge ${resultado.tipo === '10off' ? 'cat-badge--10off' : 'cat-badge--promo'}`;
    badgeEl.textContent = resultado.badge;
    tiersEl.appendChild(badgeEl);
  }

  tiers.forEach(t => {
    const precoDesc = aplicarDesconto(t.preco, resultado.percentual);
    const row = document.createElement('span');
    row.innerHTML = `<span>${t.label}</span>
      <span class="cat-tier-prices">
        <span class="cat-price-original-small" aria-hidden="true">${formatarMoeda(t.preco)}</span>
        <strong class="cat-price-desconto-small">${formatarMoeda(precoDesc)}</strong>
      </span>`;
    tiersEl.appendChild(row);
  });
}

async function renderizarDescontos() {
  const aceitou10 = verificarStatusDesconto10();
  const promocoes = await carregarPromocoes();

  document.querySelectorAll('.cat-card[data-service-id]').forEach(card => {
    const serviceId = card.dataset.serviceId;
    const servico = promocoes.find(p => p.id === serviceId) || null;
    const resultado = calcularResultado(servico, aceitou10);
    const footer = card.querySelector('.cat-footer');
    if (!footer) return;

    if (servico && servico.tipo === 'tiers') {
      renderizarPrecoTiers(footer, servico.tiers, resultado);
    } else if (servico && servico.tipo === 'simples') {
      renderizarPrecoSimples(footer, servico.preco, resultado);
    }
  });
}
