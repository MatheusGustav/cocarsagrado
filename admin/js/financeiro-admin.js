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
  const inicioISO = _dataLocalISO(inicio);

  const [{ data, error }, { data: lanc, error: lancErr }] = await Promise.all([
    supabase
      .from('agendamentos')
      .select('valor_final, data_agendamento, terapeuta, metodo_pagamento, status, tipos_leitura(nome)')
      .in('status', FIN_STATUS_PAGOS)
      .gte('data_agendamento', inicioISO),
    supabase
      .from('lancamentos_financeiros')
      .select('*')
      .gte('data', inicioISO)
      .order('data', { ascending: false }),
  ]);

  _finCarregando = false;

  if (error) {
    container.innerHTML = '<div class="ag-empty">Erro ao carregar o financeiro.</div>';
    console.error(error);
    return;
  }
  if (lancErr) console.error('lancamentos_financeiros:', lancErr);

  _finCache   = { registros: data || [], lancamentos: lanc || [] };
  _finCacheEm = Date.now();
  _renderFinanceiro(_finCache, container);
}

function _renderFinanceiro(cache, container) {
  const registros   = Array.isArray(cache) ? cache : (cache.registros || []);
  const lancamentos = Array.isArray(cache) ? [] : (cache.lancamentos || []);
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
      totalLeituras: 0,
      totalLanc: 0,
      qtd:   0,
    });
  }
  const porMes = new Map(meses.map(m => [m.key, m]));

  registros.forEach(r => {
    const m = porMes.get(_finMesKey(r.data_agendamento));
    if (!m) return;
    m.total         += Number(r.valor_final || 0);
    m.totalLeituras += Number(r.valor_final || 0);
    m.qtd           += 1;
  });

  // Lançamentos manuais (trabalhos espirituais e avulsos) entram no total
  lancamentos.forEach(l => {
    const m = porMes.get(_finMesKey(l.data));
    if (!m) return;
    m.total     += Number(l.valor || 0);
    m.totalLanc += Number(l.valor || 0);
  });

  const atual    = meses[meses.length - 1];
  const anterior = meses[meses.length - 2];
  const total12  = meses.reduce((s, m) => s + m.total, 0);
  const ticket   = atual.qtd ? atual.totalLeituras / atual.qtd : 0;

  let deltaHtml = '<span class="fin-card-delta">— sem base de comparação</span>';
  if (anterior.total > 0) {
    const pct = ((atual.total - anterior.total) / anterior.total) * 100;
    const up  = pct >= 0;
    deltaHtml = `<span class="fin-card-delta ${up ? 'fin-card-delta--up' : 'fin-card-delta--down'}">
      ${up ? '<svg class="ico" aria-hidden="true"><use href="#ico-subiu"></use></svg>' : '<svg class="ico" aria-hidden="true"><use href="#ico-desceu"></use></svg>'} ${Math.abs(pct).toFixed(0)}% vs. mês anterior</span>`;
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

  // Por terapeuta: leituras + lançamentos manuais do mês (NULL = Geral).
  // Mantém a quebra reconciliando com o card "Faturado este mês".
  const lancMesTerap = lancamentos.filter(l => _finMesKey(l.data) === mesAtual);
  const terapMap = new Map();
  const _addTerap = (chave, rotulo, valor) => {
    const item = terapMap.get(chave) || { rotulo, total: 0, qtd: 0 };
    item.total += Number(valor || 0);
    item.qtd   += 1;
    terapMap.set(chave, item);
  };
  doMes.forEach(r => _addTerap(
    r.terapeuta || '—',
    (typeof terapeutaNome === 'function' && r.terapeuta) ? terapeutaNome(r.terapeuta) : (r.terapeuta || '—'),
    r.valor_final));
  lancMesTerap.forEach(l => _addTerap(
    l.terapeuta || 'geral',
    l.terapeuta ? (typeof terapeutaNome === 'function' ? terapeutaNome(l.terapeuta) : l.terapeuta) : 'Geral / avulsos',
    l.valor));
  const porTerapeuta = [...terapMap.values()].sort((a, b) => b.total - a.total);
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

  // ---- Lançamentos do mês atual (lista com excluir) ----
  const lancDoMes = lancamentos.filter(l => _finMesKey(l.data) === mesAtual);
  const rotuloCat = { trabalho: 'Trabalho espiritual', outro: 'Outro', despesa: 'Despesa' };
  const lancHtml = `
    <div class="fin-break">
      <h3>Lançamentos manuais (mês atual)</h3>
      ${lancDoMes.length
        ? lancDoMes.map(l => `<div class="fin-break-row">
            <span class="fin-break-nome">${_esc(l.descricao)} <em class="fin-lanc-cat">${rotuloCat[l.categoria] || l.categoria}${l.terapeuta ? ' · ' + _esc(typeof terapeutaNome === 'function' ? terapeutaNome(l.terapeuta) : l.terapeuta) : ''}</em></span>
            <span class="fin-break-valor${Number(l.valor) < 0 ? ' fin-break-valor--neg' : ''}">${_esc(_finBRL(l.valor))}</span>
            <button class="fin-lanc-del" onclick="fin_excluirLancamento(${l.id})" aria-label="Excluir lançamento"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg></button>
          </div>`).join('')
        : '<div class="fin-break-row"><span class="fin-break-nome">Nenhum lançamento neste mês.</span></div>'}
    </div>`;

  const entradas = lancDoMes.filter(l => Number(l.valor) > 0).reduce((s, l) => s + Number(l.valor), 0);
  const despesas = lancDoMes.filter(l => Number(l.valor) < 0).reduce((s, l) => s + Number(l.valor), 0);
  const splitHtml = atual.totalLanc !== 0
    ? `<span class="fin-card-delta">leituras ${_esc(_finBRL(atual.totalLeituras))} · avulsos ${_esc(_finBRL(entradas))}${despesas !== 0 ? ` · despesas −${_esc(_finBRL(Math.abs(despesas)))}` : ''}</span>`
    : '';

  container.innerHTML = `
    <div class="fin-topbar">
      <button class="ag-btn ag-btn-primary ag-btn-sm" onclick="fin_abrirLancamento()">+ Lançamento</button>
    </div>
    <div class="fin-cards">
      <div class="fin-card">
        <div class="fin-card-label">Faturado este mês</div>
        <div class="fin-card-valor">${_esc(_finBRL(atual.total))}</div>
        ${deltaHtml}
        ${splitHtml}
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
      ${lancHtml}
    </div>`;
}

// ============================================================
// Lançamentos manuais (trabalhos espirituais e avulsos)
// ============================================================
function fin_abrirLancamento() {
  document.getElementById('fin-lanc-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'fin-lanc-modal';
  overlay.className = 'agenda-modal-overlay';
  overlay.innerHTML = `
    <div class="agenda-modal-container" role="dialog" aria-modal="true" aria-labelledby="fin-lanc-titulo">
      <div class="agenda-modal-header">
        <h3 class="agenda-modal-titulo" id="fin-lanc-titulo">Novo Lançamento</h3>
        <button class="agenda-modal-fechar" type="button" onclick="fin_fecharLancamento()" aria-label="Fechar"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg></button>
      </div>
      <div class="agenda-modal-body">
        <div class="ag-form-group">
          <label for="fin-lanc-desc">Descrição</label>
          <input type="text" id="fin-lanc-desc" maxlength="120" placeholder="Ex.: Trabalho de abertura de caminhos…">
        </div>
        <div class="cat-form-row">
          <div class="ag-form-group">
            <label for="fin-lanc-valor">Valor (R$)</label>
            <input type="number" id="fin-lanc-valor" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00">
          </div>
          <div class="ag-form-group">
            <label for="fin-lanc-data">Data</label>
            <input type="date" id="fin-lanc-data" value="${_dataLocalISO()}">
          </div>
        </div>
        <div class="cat-form-row">
          <div class="ag-form-group">
            <label for="fin-lanc-cat">Categoria</label>
            <select id="fin-lanc-cat">
              <option value="trabalho">Trabalho espiritual (entrada)</option>
              <option value="outro">Outro (entrada)</option>
              <option value="despesa">Despesa (sai do total)</option>
            </select>
          </div>
          <div class="ag-form-group">
            <label for="fin-lanc-terapeuta">Terapeuta</label>
            <select id="fin-lanc-terapeuta">
              ${(typeof listaTerapeutas === 'function' ? listaTerapeutas() : [{id:'matheus',nome:'Matheus'},{id:'camila',nome:'Camila'}])
                .map(t => `<option value="${_esc(t.id)}">${_esc(t.nome)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="cat-form-actions">
        <button class="ag-btn ag-btn-outline ag-btn-sm" type="button" onclick="fin_fecharLancamento()">Cancelar</button>
        <button class="ag-btn ag-btn-primary ag-btn-sm" id="fin-lanc-salvar" type="button" onclick="fin_salvarLancamento()">Salvar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  setTimeout(() => document.getElementById('fin-lanc-desc')?.focus(), 320);
}

function fin_fecharLancamento() {
  const overlay = document.getElementById('fin-lanc-modal');
  overlay?.classList.remove('open');
  setTimeout(() => overlay?.remove(), 320);
}

async function fin_salvarLancamento() {
  const descricao = document.getElementById('fin-lanc-desc')?.value?.trim();
  const valor     = parseFloat(document.getElementById('fin-lanc-valor')?.value);
  const data      = document.getElementById('fin-lanc-data')?.value;
  const categoria = document.getElementById('fin-lanc-cat')?.value || 'trabalho';
  const terapeuta = document.getElementById('fin-lanc-terapeuta')?.value || '';

  if (!descricao)               { _toastAdmin('Informe a descrição.', 'erro'); return; }
  if (isNaN(valor) || valor <= 0) { _toastAdmin('Valor inválido.', 'erro'); return; }
  if (!data)                    { _toastAdmin('Informe a data.', 'erro'); return; }
  if (!terapeuta)               { _toastAdmin('Selecione o terapeuta.', 'erro'); return; }

  const btn = document.getElementById('fin-lanc-salvar');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

  // Despesa entra negativa: subtrai do faturamento automaticamente
  const valorFinal = categoria === 'despesa' ? -valor : valor;

  const { error } = await supabase
    .from('lancamentos_financeiros')
    .insert({ descricao, valor: valorFinal, data, categoria, terapeuta });

  if (error) {
    _toastAdmin('Erro ao salvar: ' + error.message, 'erro');
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
    return;
  }

  _toastAdmin('Lançamento registrado!', 'ok');
  fin_fecharLancamento();
  inicializarFinanceiro(true);
}

async function fin_excluirLancamento(id) {
  if (!confirm('Excluir este lançamento?')) return;
  const { error } = await supabase
    .from('lancamentos_financeiros')
    .delete()
    .eq('id', id);
  if (error) { _toastAdmin('Erro ao excluir: ' + error.message, 'erro'); return; }
  _toastAdmin('Lançamento excluído.', 'ok');
  inicializarFinanceiro(true);
}
