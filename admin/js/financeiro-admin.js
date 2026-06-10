/* ============================================================
   COCAR SAGRADO — Admin: Financeiro
   Faturamento mensal (12 meses), comparação com mês anterior e
   quebras por terapeuta / serviço / método de pagamento.
   Considera status pago, confirmado e atendido, agrupando pela
   data do agendamento (mesma regra do card "Faturado no mês").
   ============================================================ */

const MESES_FIN = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const FIN_STATUS_PAGOS = ['pago', 'confirmado', 'atendido'];
const FIN_CACHE_MS = 2 * 60 * 1000;

let _finCache      = null;
let _finCacheEm    = 0;
let _finCarregando = false;

function _finBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function _finMesKey(iso) {
  return (iso || '').slice(0, 7); // 'YYYY-MM'
}

async function inicializarFinanceiro(forcar = false) {
  if (!_admAutenticado) return;
  const container = document.getElementById('financeiro-container');
  if (!container || _finCarregando) return;

  if (!forcar && _finCache && Date.now() - _finCacheEm < FIN_CACHE_MS) {
    _renderFinanceiro(_finCache, container);
    return;
  }

  _finCarregando = true;
  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const inicio = new Date();
  inicio.setDate(1);
  inicio.setMonth(inicio.getMonth() - 11);

  const { data, error } = await supabase
    .from('agendamentos')
    .select('valor_final, data_agendamento, terapeuta, metodo_pagamento, status, tipos_leitura(nome)')
    .in('status', FIN_STATUS_PAGOS)
    .gte('data_agendamento', _dataLocalISO(inicio));

  _finCarregando = false;

  if (error) {
    container.innerHTML = '<div class="ag-empty">Erro ao carregar o financeiro.</div>';
    console.error(error);
    return;
  }

  _finCache   = data || [];
  _finCacheEm = Date.now();
  _renderFinanceiro(_finCache, container);
}

function _renderFinanceiro(registros, container) {
  const hoje     = new Date();
  const mesAtual = _finMesKey(_dataLocalISO(hoje));

  // ---- Série mensal (12 meses, incluindo meses zerados) ----
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    meses.push({
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      rotulo: `${MESES_FIN[d.getMonth()]}${d.getMonth() === 0 || i === 11 ? '/' + String(d.getFullYear()).slice(2) : ''}`,
      total: 0,
      qtd:   0,
    });
  }
  const porMes = new Map(meses.map(m => [m.key, m]));

  registros.forEach(r => {
    const m = porMes.get(_finMesKey(r.data_agendamento));
    if (!m) return;
    m.total += Number(r.valor_final || 0);
    m.qtd   += 1;
  });

  const atual    = meses[meses.length - 1];
  const anterior = meses[meses.length - 2];
  const total12  = meses.reduce((s, m) => s + m.total, 0);
  const ticket   = atual.qtd ? atual.total / atual.qtd : 0;

  let deltaHtml = '<span class="fin-card-delta">— sem base de comparação</span>';
  if (anterior.total > 0) {
    const pct = ((atual.total - anterior.total) / anterior.total) * 100;
    const up  = pct >= 0;
    deltaHtml = `<span class="fin-card-delta ${up ? 'fin-card-delta--up' : 'fin-card-delta--down'}">
      ${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs. mês anterior</span>`;
  }

  // ---- Quebras do mês atual ----
  const doMes = registros.filter(r => _finMesKey(r.data_agendamento) === mesAtual);

  const agrupar = (lista, chaveFn, rotuloFn) => {
    const mapa = new Map();
    lista.forEach(r => {
      const k = chaveFn(r);
      const item = mapa.get(k) || { rotulo: rotuloFn(r), total: 0, qtd: 0 };
      item.total += Number(r.valor_final || 0);
      item.qtd   += 1;
      mapa.set(k, item);
    });
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  };

  const porTerapeuta = agrupar(doMes,
    r => r.terapeuta || '—',
    r => (typeof terapeutaNome === 'function' && r.terapeuta) ? terapeutaNome(r.terapeuta) : (r.terapeuta || '—'));
  const porServico = agrupar(doMes,
    r => r.tipos_leitura?.nome || '—',
    r => r.tipos_leitura?.nome || '—').slice(0, 8);
  const rotuloMetodo = { pix: 'PIX', cartao: 'Cartão', wise: 'Wise' };
  const porMetodo = agrupar(doMes,
    r => r.metodo_pagamento || '—',
    r => rotuloMetodo[r.metodo_pagamento] || r.metodo_pagamento || 'Não registrado');

  // ---- Render ----
  const maxMes = Math.max(...meses.map(m => m.total), 1);
  const barras = meses.map(m => `
    <div class="fin-bar-col" title="${_esc(m.rotulo)}: ${_esc(_finBRL(m.total))} (${m.qtd} leitura${m.qtd === 1 ? '' : 's'})">
      <span class="fin-bar-valor">${m.total > 0 ? _esc(_finBRL(m.total).replace(',00', '')) : ''}</span>
      <div class="fin-bar ${m.key === mesAtual ? 'fin-bar--atual' : ''}" style="height:${Math.max(2, Math.round((m.total / maxMes) * 100))}%"></div>
      <span class="fin-bar-mes">${_esc(m.rotulo)}</span>
    </div>`).join('');

  const breakHtml = (titulo, itens) => `
    <div class="fin-break">
      <h3>${titulo}</h3>
      ${itens.length
        ? itens.map(i => `<div class="fin-break-row">
            <span class="fin-break-nome">${_esc(i.rotulo)}</span>
            <span class="fin-break-qtd">${i.qtd}×</span>
            <span class="fin-break-valor">${_esc(_finBRL(i.total))}</span>
          </div>`).join('')
        : '<div class="fin-break-row"><span class="fin-break-nome">Sem registros neste mês.</span></div>'}
    </div>`;

  container.innerHTML = `
    <div class="fin-cards">
      <div class="fin-card">
        <div class="fin-card-label">Faturado este mês</div>
        <div class="fin-card-valor">${_esc(_finBRL(atual.total))}</div>
        ${deltaHtml}
      </div>
      <div class="fin-card">
        <div class="fin-card-label">Mês anterior</div>
        <div class="fin-card-valor">${_esc(_finBRL(anterior.total))}</div>
      </div>
      <div class="fin-card">
        <div class="fin-card-label">Leituras pagas no mês</div>
        <div class="fin-card-valor">${atual.qtd}</div>
        <span class="fin-card-delta">ticket médio ${_esc(_finBRL(ticket))}</span>
      </div>
      <div class="fin-card">
        <div class="fin-card-label">Últimos 12 meses</div>
        <div class="fin-card-valor">${_esc(_finBRL(total12))}</div>
      </div>
    </div>

    <div class="fin-grafico-wrap">
      <div class="fin-grafico-titulo">Faturamento mensal (12 meses)</div>
      <div class="fin-grafico">${barras}</div>
    </div>

    <div class="fin-breakdowns">
      ${breakHtml('Por terapeuta (mês atual)', porTerapeuta)}
      ${breakHtml('Por serviço (mês atual)', porServico)}
      ${breakHtml('Por método de pagamento (mês atual)', porMetodo)}
    </div>`;
}
