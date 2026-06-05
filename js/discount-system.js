/* ============================================================
   SISTEMA DE DESCONTOS — COCAR SAGRADO
   Prioridade:
   1. Usuário aceitou 10% → mostra 10% em TUDO (ignora promoções)
   2. Usuário recusou → verifica promoções por serviço
   3. Sem promoção → preço normal
   ============================================================ */

const DESCONTO_10_KEY = 'aceitouDesconto10';

let _configCache = null;

async function carregarConfig() {
  if (_configCache !== null) return _configCache;
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('valor')
      .eq('chave', 'descontos')
      .single();
    if (error) throw error;
    _configCache = {
      desconto10Habilitado: data.valor.desconto10Habilitado ?? true,
      promocoes:            data.valor.promocoes            || [],
    };
  } catch {
    _configCache = { desconto10Habilitado: true, promocoes: [] };
  }
  return _configCache;
}

async function carregarPromocoes() {
  const cfg = await carregarConfig();
  return cfg.promocoes;
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
      tipo:       'promocao',
      percentual: servico.percentualDesconto,
      badge:      servico.badge || '',
    };
  }
  return { tipo: 'normal' };
}

function aplicarDesconto(valor, percentual) {
  return Math.round(valor * (100 - percentual)) / 100;
}

function formatarMoeda(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n)
    ? `R$&nbsp;${n}`
    : `R$&nbsp;${n.toFixed(2).replace('.', ',')}`;
}

function inserirBadgeNoIcone(card, resultado) {
  const imgEl = card && card.querySelector('.cat-card-img');
  if (!imgEl) return;
  imgEl.querySelector('.cat-badge-img')?.remove();
  if (!resultado.badge) return;
  const badgeClass = resultado.tipo === '10off' ? 'cat-badge--10off' : 'cat-badge--promo';
  const badgeEl = document.createElement('span');
  badgeEl.className = `cat-badge cat-badge-img ${badgeClass}`;
  badgeEl.textContent = resultado.badge;
  imgEl.appendChild(badgeEl);
}

function renderizarPrecoSimples(footer, preco, resultado) {
  const btn = footer.querySelector('.cat-btn');
  const card = footer.closest('.cat-card');
  const jaTemDesconto = !!footer.querySelector('.cat-price-wrapper');

  inserirBadgeNoIcone(card, resultado);

  if (resultado.tipo === 'normal') {
    if (!jaTemDesconto) return;
    footer.querySelector('.cat-price-wrapper').remove();
    const span = document.createElement('span');
    span.className = 'cat-footer-price';
    span.innerHTML = formatarMoeda(preco);
    footer.insertBefore(span, btn);
    return;
  }

  footer.querySelectorAll('.cat-footer-price, .cat-price-wrapper').forEach(el => el.remove());

  const precoDesc = aplicarDesconto(preco, resultado.percentual);
  const wrapper = document.createElement('div');
  wrapper.className = 'cat-price-wrapper';
  wrapper.innerHTML = `<div class="cat-price-group">
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
  const card = footer.closest('.cat-card');
  const jaTemDesconto = !!tiersEl.querySelector('.cat-badge-tier');

  inserirBadgeNoIcone(card, resultado);

  if (resultado.tipo === 'normal') {
    if (!jaTemDesconto) return;
    tiersEl.innerHTML = tiers
      .map(t => `<span><span>${t.label}</span><strong>${formatarMoeda(t.preco)}</strong></span>`)
      .join('');
    return;
  }

  tiersEl.innerHTML = '';
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
    // Grupos: o admin salva o id sem prefixo ('amarracao'); o card usa 'grupo:amarracao'
    const servico   = promocoes.find(p => p.id === serviceId || `grupo:${p.id}` === serviceId) || null;
    const resultado = calcularResultado(servico, aceitou10);
    const footer    = card.querySelector('.cat-footer');
    if (!footer) return;

    if (servico && servico.tipo === 'tiers') {
      renderizarPrecoTiers(footer, servico.tiers, resultado);
    } else if (servico && servico.tipo === 'simples') {
      renderizarPrecoSimples(footer, servico.preco, resultado);
    }
  });
}
