/* ============================================================
   COCAR SAGRADO — Sistema de Agendamento (Sistema de Vagas)
   ============================================================ */

const Estado = {
  tipoSelecionado: null,
  dataSelecionada: null,
  horarioSelecionado: null,
  serviceId: null,
  // Carrinho multi-leitura
  carrinho: [],
  dadosPessoais: { nome: '', nascimento: '', whatsapp: '', email: '' },
};

const DIAS_PT  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ============================================================
// SELETOR DE QUANTIDADE
// ============================================================

let _tiposCache    = null;
let _seletorTipo   = null;
let _seletorQty    = 1;

const WHATSAPP_TERAPEUTA = {
  matheus: '5528999476620',
  camila:  '5527998528483',
};

// Fecha o dia atual N minutos antes do ate_horario para dar tempo de processar/entregar
const CUTOFF_BUFFER_MIN = 60;

async function _garantirTipos(forcar) {
  if (_tiposCache && !forcar) return _tiposCache;
  if (typeof supabase === 'undefined' || !supabase) {
    console.error('Supabase não carregado — verifique a conexão com a CDN.');
    return [];
  }
  const { data, error } = await supabase
    .from('tipos_leitura')
    .select('*')
    .eq('ativo', true)
    .not('terapeuta', 'is', null)
    .order('ordem')
    .order('nome');
  if (error) {
    console.error('Erro ao carregar tipos:', error);
    return [];
  }
  _tiposCache = data || [];
  return _tiposCache;
}

function _tipoMaxQty(t) {
  return t.especial ? 1 : 5;
}

function _numeroDePerguntas(tipo) {
  if (!tipo?.requerPergunta && !tipo?.requer_pergunta) return 0;
  const n = parseInt(tipo.num_perguntas, 10);
  if (Number.isFinite(n) && n > 0) return Math.min(20, n);
  // Fallback (registros antigos sem a coluna): tenta extrair do nome
  const fonte = `${tipo.tier_label || ''} ${tipo.nome || ''}`;
  const m = fonte.match(/(\d+)\s*pergunta/i);
  return m ? Math.max(1, Math.min(20, parseInt(m[1], 10))) : 1;
}

function _coletarObservacoes(tipo) {
  const n = _numeroDePerguntas(tipo);
  if (n === 0) return null;
  const partes = [];
  for (let i = 1; i <= n; i++) {
    const v = document.getElementById(`f-obs-${i}`)?.value?.trim();
    if (v) partes.push(n === 1 ? v : `${i}. ${v}`);
  }
  return partes.length ? partes.join('\n') : null;
}

function _lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function _lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* private browsing */ }
}

function calcularPrecoFinal(precoOriginal) {
  const preco = parseFloat(precoOriginal) || 0;
  if (_lsGet('aceitouDesconto10') === 'true') {
    const final = Math.round(preco * 90) / 100;
    return { final, desconto: preco - final };
  }
  if (Estado.serviceId && typeof _configCache !== 'undefined' && _configCache?.promocoes) {
    const servico = _configCache.promocoes.find(p => p.id === Estado.serviceId);
    if (servico?.descontoAtivo && servico.percentualDesconto > 0) {
      const pct   = servico.percentualDesconto;
      const final = Math.round(preco * (100 - pct)) / 100;
      return { final, desconto: preco - final };
    }
  }
  return { final: preco, desconto: 0 };
}

// Preço aplicando SOMENTE o desconto promocional do serviço (sem o 10% novo cliente).
function _precoComPromoServico(precoOriginal, serviceId) {
  const preco = parseFloat(precoOriginal) || 0;
  if (serviceId && typeof _configCache !== 'undefined' && _configCache?.promocoes) {
    const servico = _configCache.promocoes.find(p => p.id === serviceId);
    if (servico?.descontoAtivo && servico.percentualDesconto > 0) {
      return Math.round(preco * (100 - servico.percentualDesconto)) / 100;
    }
  }
  return preco;
}

// Desconto de novo cliente (10%) vale para UMA leitura só: a de maior preço-base.
// Recebe itens com { valor_original, preco_base } e devolve cada um com
// valor_final / desconto_aplicado / aplicou_novo_cliente calculados.
function _aplicarDescontosCarrinho(itens) {
  const novoCliente = _lsGet('aceitouDesconto10') === 'true';
  let idxDesc = -1;
  if (novoCliente && itens.length) {
    idxDesc = 0;
    for (let i = 1; i < itens.length; i++) {
      if ((itens[i].preco_base ?? 0) > (itens[idxDesc].preco_base ?? 0)) idxDesc = i;
    }
  }
  return itens.map((it, i) => {
    const original = parseFloat(it.valor_original) || 0;
    const base     = it.preco_base ?? original;
    const aplica   = i === idxDesc;
    const final    = aplica ? Math.round(base * 90) / 100 : base;
    return {
      ...it,
      valor_final: final,
      desconto_aplicado: original - final,
      aplicou_novo_cliente: aplica,
    };
  });
}

async function abrirSeletor(ref) {
  // Salva elemento que tinha foco pra restaurar depois
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.setAttribute('data-last-focus', '');
  }
  let tipos;
  try {
    tipos = await _garantirTipos();
  } catch (err) {
    console.error('abrirSeletor: falha ao carregar tipos', err);
    mostrarAlerta('Erro de conexão. Verifique sua internet e tente novamente.', 'error');
    return;
  }

  const isGrupo = typeof ref === 'string' && ref.startsWith('grupo:');
  if (isGrupo) {
    const grupoSlug = ref.slice(6);
    const tiers = tipos
      .filter(t => t.grupo_slug === grupoSlug)
      .sort((a, b) => Number(a.preco_original) - Number(b.preco_original));
    if (!tiers.length) {
      mostrarAlerta('Serviço temporariamente indisponível. Tente novamente.', 'error');
      return;
    }
    return _abrirSeletorGrupo(grupoSlug, tiers);
  }

  const tipo = typeof ref === 'number'
    ? tipos.find(t => t.id === ref)
    : tipos.find(t => t.slug === ref || t.id === Number(ref));

  if (!tipo) {
    console.warn('Tipo não encontrado:', ref);
    mostrarAlerta('Serviço temporariamente indisponível. Tente novamente.', 'error');
    return;
  }

  _seletorTipo     = tipo;
  Estado.serviceId = tipo.slug || tipo.id;
  _seletorQty      = 1;

  const tiersEl    = document.getElementById('seletor-tiers');
  const qtyEl      = document.getElementById('seletor-qty-wrap');
  const resumoEl   = document.getElementById('seletor-resumo');
  const btnConfirm = document.getElementById('seletor-btn-confirm');

  document.getElementById('seletor-nome').textContent     = tipo.nome;
  document.getElementById('seletor-pergunta').textContent = tipo.especial
    ? 'Confirme para escolher a data'
    : 'Quantas sessões?';

  if (tiersEl) { tiersEl.innerHTML = ''; tiersEl.style.display = 'none'; }
  qtyEl.style.display    = _tipoMaxQty(tipo) === 1 ? 'none' : 'flex';
  resumoEl.style.display = 'flex';
  _atualizarResumoSeletor();
  btnConfirm.removeAttribute('disabled');

  document.getElementById('seletor-overlay').classList.add('open');
  document.body.classList.add('seletor-aberto');

  // Fecha com Escape
  const _escSeletor = (e) => {
    if (e.key === 'Escape') { fecharSeletor(); document.removeEventListener('keydown', _escSeletor); }
  };
  document.addEventListener('keydown', _escSeletor);
}

function _abrirSeletorGrupo(grupoSlug, tiers) {
  const principal = tiers[0];

  _seletorTipo     = null;
  _seletorQty      = 1;
  Estado.serviceId = `grupo:${grupoSlug}`;

  const tiersEl    = document.getElementById('seletor-tiers');
  const qtyEl      = document.getElementById('seletor-qty-wrap');
  const resumoEl   = document.getElementById('seletor-resumo');
  const btnConfirm = document.getElementById('seletor-btn-confirm');

  document.getElementById('seletor-nome').textContent     = _nomeGrupo(principal);
  document.getElementById('seletor-pergunta').textContent = principal.requer_pergunta
    ? 'Quantas perguntas?'
    : 'Escolha uma opção';

  tiersEl.innerHTML = '';
  tiers.forEach(tier => {
    const { final } = calcularPrecoFinal(tier.preco_original);
    const opt = document.createElement('div');
    opt.className = 'seletor-tier-opt';
    opt.innerHTML = `
      <span class="tier-label">${_escCat(tier.tier_label || tier.nome)}</span>
      <div class="tier-info">
        <span class="tier-preco">R$ ${final.toFixed(0)}</span>
      </div>`;
    opt.addEventListener('click', () => {
      tiersEl.querySelectorAll('.seletor-tier-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      _seletorTipo = tier;
      btnConfirm.removeAttribute('disabled');
    });
    tiersEl.appendChild(opt);
  });

  tiersEl.style.display  = 'flex';
  qtyEl.style.display    = 'none';
  resumoEl.style.display = 'none';
  btnConfirm.setAttribute('disabled', '');

  document.getElementById('seletor-overlay').classList.add('open');
  document.body.classList.add('seletor-aberto');

  // Fecha com Escape
  const _escGrupo = (e) => {
    if (e.key === 'Escape') { fecharSeletor(); document.removeEventListener('keydown', _escGrupo); }
  };
  document.addEventListener('keydown', _escGrupo);
}

function _atualizarResumoSeletor() {
  const tipo = _seletorTipo;
  if (!tipo) return;
  const total    = tipo.preco_original * _seletorQty;
  const { final } = calcularPrecoFinal(total);

  document.getElementById('seletor-qty').textContent   = _seletorQty;
  document.getElementById('seletor-preco').textContent = `R$ ${final.toFixed(0)}`;
}

function alterarQty(delta) {
  const max = _tipoMaxQty(_seletorTipo);
  _seletorQty = Math.max(1, Math.min(max, _seletorQty + delta));
  _atualizarResumoSeletor();
}

function fecharSeletor() {
  document.getElementById('seletor-overlay')?.classList.remove('open');
  document.body.classList.remove('seletor-aberto');
  // Restaura foco pro gatilho
  const trigger = document.querySelector('[data-last-focus]');
  if (trigger) { trigger.focus(); trigger.removeAttribute('data-last-focus'); }
}

function confirmarSeletor() {
  if (!_seletorTipo) return;

  const t = _seletorTipo;
  const tipoFinal = {
    ...t,
    terapeuta:       t.terapeuta,
    especial:        !!t.especial,
    requerPergunta:  !!t.requer_pergunta,
    preco_original:  t.preco_original * _seletorQty,
    nome: _seletorQty > 1 ? `${t.nome} (×${_seletorQty})` : t.nome,
  };

  fecharSeletor();
  abrirModal(tipoFinal);
}

// adicionarOutraLeitura está em modal-agendamento.js (onde _ofereceRetomar reside)

// ============================================================
// STEP 1 — Calendário de Vagas
// ============================================================
async function carregarCalendario() {
  const cal = document.getElementById('calendario');
  if (!cal) return;
  cal.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando disponibilidade...</div>';

  const profissional = Estado.tipoSelecionado?.terapeuta;
  if (!profissional) {
    cal.innerHTML = '<div class="ag-empty">Selecione um serviço primeiro.</div>';
    return;
  }

  try {
    const isEspecial = !!Estado.tipoSelecionado?.especial;
    const dias = isEspecial
      ? await _buscarDiasEspeciais(profissional, 90)
      : await _buscarDiasComVagas(profissional, 6);

    if (!dias.length) {
      const numero = WHATSAPP_TERAPEUTA[profissional] || '';
      cal.innerHTML = `
        <div class="ag-empty ag-empty-vagas">
          <p>Sem leituras disponíveis no momento.</p>
          <p style="font-size:.85rem; margin-top:4px; color:var(--text-muted);">Nossa agenda está temporariamente cheia. Entre em contato pelo WhatsApp para verificar próximas disponibilidades.</p>
          ${numero ? `<a href="https://wa.me/${numero}" target="_blank" rel="noopener" class="ag-btn ag-btn-whatsapp" style="margin-top:14px; display:inline-flex;">💬 Verificar disponibilidade</a>` : ''}
        </div>`;
      return;
    }

    cal.innerHTML = '';
    cal.className = 'ag-vagas-lista';

    dias.forEach(({ data, vagas, ate_horario }) => {
      const [aY, aM, aD] = data.split('-').map(Number);
      const d = new Date(aY, aM - 1, aD);
      const card = document.createElement('div');
      card.className = 'ag-vagas-card';

      const horarioLabel = ate_horario ? `entrega até ${ate_horario.slice(0, 5)}` : '';
      const vagasText    = vagas === 1 ? '1 leitura disponível' : `${vagas} leituras disponíveis`;
      const cls          = vagas <= 2 ? 'vagas-poucas' : 'vagas-ok';

      card.innerHTML = `
        <div class="ag-vagas-data">
          <span class="ag-vagas-dia-num">${d.getDate()}</span>
          <div class="ag-vagas-dia-info">
            <span class="ag-vagas-dia-nome">${DIAS_PT[d.getDay()]}</span>
            <span class="ag-vagas-mes">${MESES_PT[d.getMonth()]}</span>
          </div>
        </div>
        <div class="ag-vagas-info ${cls}">
          <span class="ag-vagas-badge">${vagasText}${horarioLabel ? ' (' + horarioLabel + ')' : ''}</span>
        </div>
        <span class="ag-vagas-action" aria-hidden="true">→</span>`;

      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Agendar em ${DIAS_PT[d.getDay()]}, ${d.getDate()} de ${MESES_PT[d.getMonth()]} — ${vagasText}`);
      card.addEventListener('click', () => selecionarData(data, ate_horario, card));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selecionarData(data, ate_horario, card); } });
      cal.appendChild(card);
    });
  } catch (err) {
    console.error('carregarCalendario:', err);
    cal.innerHTML = '<div class="ag-empty">Erro ao carregar disponibilidade. Tente novamente.</div>';
  }
}

async function irParaPagamentoCarrinho() {
  if (Estado.carrinho.length === 0) {
    mostrarAlerta('Adicione pelo menos uma leitura ao pedido.', 'error');
    return;
  }

  const btn = document.getElementById('btn-ir-pagar');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="ag-btn-spinner" aria-hidden="true"></span> Salvando seu pedido…';
  }

  // Calcula os itens (com desconto distribuído) ANTES de salvar/limpar o carrinho.
  // Esse mesmo snapshot alimenta a tela de pagamento.
  const itens = _aplicarDescontosCarrinho(Estado.carrinho);

  try {
    const chave = await salvarMultiplosAgendamentos(itens);
    Estado.carrinho = [];
    _renderizarCarrinho();
    if (chave) redirecionarParaPagamento(chave, itens);
  } catch (err) {
    console.error('irParaPagamentoCarrinho:', err);
    const msg = err?.userMessage ? err.message : 'Erro ao salvar. Tente novamente.';
    mostrarAlerta(msg, 'error');
    if (btn) { btn.disabled = false; _atualizarBotoesCarrinho(); }
  }
}

window.irParaPagamentoCarrinho = irParaPagamentoCarrinho;

async function _buscarDiasComVagas(profissional, diasParaFrente) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = dataParaISO(hoje);
  const dataFim    = dataParaISO(new Date(hoje.getTime() + diasParaFrente * 86400000));

  const [
    { data: overrides },
    { data: contagens },
  ] = await Promise.all([
    supabase.from('disponibilidade_override').select('*').eq('profissional', profissional).gte('data', dataInicio).lte('data', dataFim),
    supabase.rpc('contar_agendamentos_por_data', {
      p_terapeuta: profissional,
      p_inicio:    dataInicio,
      p_fim:       dataFim,
    }),
  ]);

  const overrideMap = {};
  (overrides || []).forEach(o => { overrideMap[o.data] = o; });

  const contagemMap = {};
  (contagens || []).forEach(c => {
    contagemMap[c.data_agendamento] = Number(c.total) || 0;
  });

  const dias = [];
  for (let i = 0; i <= diasParaFrente; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    const str    = dataParaISO(d);
    const usadas = contagemMap[str] || 0;

    const ov = overrideMap[str];
    if (ov && ov.ativo) {
      const restantes = Math.max(0, ov.vagas_total - usadas);
      if (restantes > 0) {
        if (i === 0) {
          const ateH = ov.ate_horario || '18:00';
          const [h, m] = ateH.split(':').map(Number);
          const limite = new Date(); limite.setHours(h, m, 0, 0);
          limite.setMinutes(limite.getMinutes() - CUTOFF_BUFFER_MIN);
          if (new Date() >= limite) continue;
        }
        dias.push({ data: str, vagas: restantes, ate_horario: ov.ate_horario });
      }
    }
  }

  return dias;
}

async function _buscarDiasEspeciais(profissional, diasParaFrente) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = dataParaISO(hoje);
  const dataFim    = dataParaISO(new Date(hoje.getTime() + diasParaFrente * 86400000));

  const { data: especiais } = await supabase
    .from('disponibilidade_especial')
    .select('*')
    .eq('profissional', profissional)
    .gte('data', dataInicio)
    .lte('data', dataFim)
    .gt('vagas_restantes', 0);

  const agora = new Date();
  const hojeStr = dataParaISO(new Date());
  const dias = (especiais || []).filter(e => {
    if (!e.ativo) return false;
    if (e.data === hojeStr && e.ate_horario) {
      const [h, m] = e.ate_horario.split(':').map(Number);
      const limite = new Date(); limite.setHours(h, m, 0, 0);
      limite.setMinutes(limite.getMinutes() - CUTOFF_BUFFER_MIN);
      if (agora >= limite) return false;
    }
    return true;
  }).map(e => ({
    data: e.data,
    vagas: e.vagas_restantes,
    ate_horario: e.ate_horario,
  }));

  return dias.sort((a, b) => a.data.localeCompare(b.data));
}

function selecionarData(dataStr, ateHorario, cardEl) {
  document.querySelectorAll('#calendario .ag-vagas-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  Estado.dataSelecionada = dataStr;
  Estado.horarioSelecionado = ateHorario || null;
  // Se dados pessoais já preenchidos (2ª leitura do carrinho), pula direto para perguntas
  const proximoPasso = Estado.dadosPessoais.nome ? 2 : 0;
  setTimeout(() => irParaPasso(proximoPasso), 250);
}

// ============================================================
// STEP 2 — Formulário
// ============================================================
function atualizarResumo() {
  const tipo = Estado.tipoSelecionado;
  const data = Estado.dataSelecionada;
  if (!tipo || !data) return;

  // Simula esta leitura entrando no carrinho para refletir o desconto real
  // (o 10% de novo cliente vai para a leitura de maior preço, não para todas).
  const tentativa = {
    valor_original: tipo.preco_original,
    preco_base: _precoComPromoServico(tipo.preco_original, Estado.serviceId),
  };
  const simulado = _aplicarDescontosCarrinho([...Estado.carrinho, tentativa]);
  const esta = simulado[simulado.length - 1];
  const final = esta.valor_final;
  const desconto = esta.desconto_aplicado;

  const [rY, rM, rD] = data.split('-').map(Number);
  const d = new Date(rY, rM - 1, rD);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('res-tipo',    tipo.nome);
  set('res-data',    `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`);
  const horaLabel = Estado.horarioSelecionado ? `até as ${Estado.horarioSelecionado.slice(0,5)}` : 'no dia';
  set('res-hora',    horaLabel);
  set('res-valor',   `R$ ${final.toFixed(2).replace('.', ',')}`);

  const linhaDesc = document.getElementById('res-desconto-linha');
  if (linhaDesc) linhaDesc.style.display = desconto > 0 ? 'flex' : 'none';
  set('res-desconto', `- R$ ${desconto.toFixed(2).replace('.', ',')}`);
}

function processarFormulario(e) {
  e.preventDefault();
  if (!validarFormulario()) return;

  adicionarAoCarrinho();
}

function adicionarAoCarrinho() {
  const tipo = Estado.tipoSelecionado;
  if (!tipo || !Estado.dataSelecionada) return;

  const obs = _coletarObservacoes(tipo);

  const item = {
    tipo,
    serviceId: Estado.serviceId,
    terapeuta: tipo.terapeuta || null,
    data: Estado.dataSelecionada,
    horario: Estado.horarioSelecionado || '00:00',
    observacoes: obs,
    valor_original: tipo.preco_original,
    preco_base: _precoComPromoServico(tipo.preco_original, Estado.serviceId),
    agendamento_especial: !!tipo.especial,
    num_perguntas: _numeroDePerguntas(tipo),
  };

  Estado.carrinho.push(item);
  Estado.tipoSelecionado = null;
  Estado.dataSelecionada = null;
  Estado.horarioSelecionado = null;

  // Limpa campos de pergunta para evitar colisão de IDs na próxima leitura
  const obsGroup = document.getElementById('f-obs-group');
  if (obsGroup) {
    const textareas = obsGroup.querySelectorAll('textarea');
    textareas.forEach(ta => ta.value = '');
  }

  _renderizarCarrinho();
  irParaPasso(3);
}

function _renderizarCarrinho() {
  const container = document.getElementById('carrinho-lista');
  if (!container) return;

  if (Estado.carrinho.length === 0) {
    container.innerHTML = '<p class="ag-empty" style="padding:16px;">Nenhuma leitura adicionada ainda.</p>';
    _atualizarBotoesCarrinho();
    return;
  }

  const itens = _aplicarDescontosCarrinho(Estado.carrinho);
  const totalOriginal = itens.reduce((s, i) => s + (parseFloat(i.valor_original) || 0), 0);
  const totalDesconto = itens.reduce((s, i) => s + i.desconto_aplicado, 0);
  const totalFinal    = itens.reduce((s, i) => s + i.valor_final, 0);

  let html = '';
  itens.forEach((item, idx) => {
    const dataStr = item.data;
    const [aY, aM, aD] = dataStr.split('-').map(Number);
    const d = new Date(aY, aM - 1, aD);
    const nome = item.tipo.tier_label || item.tipo.nome;
    const entregaLabel = item.horario && item.horario !== '00:00'
      ? `Entrega até ${item.horario.slice(0,5)}`
      : 'Entrega no dia';
    const badgeDesc = item.aplicou_novo_cliente
      ? '<span class="cart-item-badge-desc">Desconto 10% aplicado</span>'
      : '';
    html += `
      <div class="cart-item">
        <div class="cart-item-header">
          <strong>${_escCat(nome)}</strong>
          <button class="cart-item-remove" data-idx="${idx}" aria-label="Remover leitura" type="button">✕</button>
        </div>
        <div class="cart-item-details">
          <span>${d.getDate()} de ${MESES_PT[d.getMonth()]}</span>
          <span>${entregaLabel}</span>
        </div>
        ${badgeDesc}
        <div class="cart-item-price">R$ ${item.valor_final.toFixed(2).replace('.',',')}</div>
      </div>`;
  });

  html += `<div class="cart-total">
    <div class="cart-total-row">
      <span>Subtotal</span><span>R$ ${totalOriginal.toFixed(2).replace('.',',')}</span>
    </div>`;
  if (totalDesconto > 0) {
    html += `<div class="cart-total-row cart-total-desc">
      <span>Desconto</span><span>- R$ ${totalDesconto.toFixed(2).replace('.',',')}</span>
    </div>`;
  }
  html += `<div class="cart-total-row cart-total-final">
      <span>Total</span><span>R$ ${totalFinal.toFixed(2).replace('.',',')}</span>
    </div>
  </div>
  <p class="cart-entrega-aviso">📲 Sua leitura será enviada por WhatsApp até o horário indicado em cada item.</p>`;

  container.innerHTML = html;

  // Eventos de remover
  container.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      Estado.carrinho.splice(idx, 1);
      _renderizarCarrinho();
      _atualizarBotoesCarrinho();
      if (Estado.carrinho.length === 0) irParaPasso(1);
    });
  });

  _atualizarBotoesCarrinho();
}

function _atualizarBotoesCarrinho() {
  const addBtn = document.getElementById('btn-add-leitura');
  const payBtn = document.getElementById('btn-ir-pagar');
  if (addBtn) addBtn.disabled = Estado.carrinho.length >= 4;
  if (payBtn) {
    if (Estado.carrinho.length > 0) {
      const itens = _aplicarDescontosCarrinho(Estado.carrinho);
      const total = itens.reduce((s, i) => s + i.valor_final, 0);
      const n = Estado.carrinho.length;
      const label = n === 1 ? '1 leitura' : `${n} leituras`;
      payBtn.style.display = '';
      payBtn.innerHTML = `💳 Pagar R$ ${total.toFixed(2).replace('.', ',')} (${label})`;
    } else {
      payBtn.style.display = 'none';
    }
  }
  if (typeof window._atualizarBotaoRetomar === 'function') window._atualizarBotaoRetomar();
}

function _prepararDadosPessoais() {
  Estado.dadosPessoais = {
    nome: (document.getElementById('f-nome')?.value || '').trim(),
    nascimento: document.getElementById('f-nasc')?.value || '',
    whatsapp: obterWhatsappCompleto(),
    email: document.getElementById('f-email')?.value || '',
  };
}

function validarDadosPessoais() {
  let ok = true;
  const campos = [
    { id: 'f-nome', minLen: 3, msg: 'Nome deve ter pelo menos 3 caracteres.' },
    { id: 'f-nasc', date: true, msg: 'Data de nascimento inválida.' },
    { id: 'f-fone', minLen: 6, msg: 'Número inválido.' },
  ];
  campos.forEach(({ id, minLen, date, msg }) => {
    const el = document.getElementById(id);
    if (!el) return;
    _limparErroField(el);
    const val = el.value.trim();
    const invalido = date
      ? (() => {
          if (!val) return true;
          const d = new Date(val);
          if (isNaN(d.getTime())) return true;
          const hoje = new Date();
          const minData = new Date(hoje.getFullYear() - 120, hoje.getMonth(), hoje.getDate());
          const maxData = new Date(hoje.getFullYear() - 10, hoje.getMonth(), hoje.getDate());
          return d > hoje || d > maxData || d < minData;
        })()
      : val.length < minLen;
    if (invalido) { el.classList.add('error'); mostrarErroField(el, msg); ok = false; }
  });
  return ok;
}

function confirmarDadosPessoais() {
  if (!validarDadosPessoais()) return;
  _prepararDadosPessoais();
  irParaPasso(2);
}

function irParaRevisao() {
  irParaPasso(3);
}

async function salvarMultiplosAgendamentos(itensPre) {
  const aceitouDesconto = _lsGet('aceitouDesconto10') === 'true';
  const whatsapp = Estado.dadosPessoais.whatsapp;

  // Pré-valida elegibilidade do desconto de novo cliente
  if (aceitouDesconto) {
    const { data: elegivel, error: errElig } = await supabase
      .rpc('cliente_elegivel_desconto', { p_whatsapp: whatsapp });
    if (errElig) throw errElig;
    if (elegivel === false) {
      localStorage.setItem('aceitouDesconto10', 'false');
      _renderizarCarrinho(); // recalcula sem o 10%
      const err = new Error('Você já tem agendamento conosco — o desconto de novo cliente não se aplica. Os valores foram atualizados, revise antes de continuar.');
      err.userMessage = true;
      throw err;
    }
  }

  // Itens já com desconto distribuído (a leitura mais cara recebe o 10%).
  const itens = itensPre || _aplicarDescontosCarrinho(Estado.carrinho);
  const chave = await gerarChavePedido();
  const totalFinal = itens.reduce((s, i) => s + i.valor_final, 0);
  const usouNovoCliente = itens.some(i => i.aplicou_novo_cliente);
  const nome = Estado.dadosPessoais.nome;
  const nascimento = Estado.dadosPessoais.nascimento || null;

  // Monta os itens para a RPC. A RPC criar_pedido (SECURITY DEFINER) insere o
  // pedido pai + N agendamentos numa única transação. Necessária porque anon
  // não tem SELECT em pedidos (LGPD), então .insert().select() falharia. Se
  // um trigger BEFORE INSERT der RAISE (sem vaga / desconto inválido), a
  // transação inteira faz rollback automático.
  const payloadItens = itens.map((item) => ({
    tipo_leitura_id: item.tipo.id,
    terapeuta: item.terapeuta,
    observacoes: item.observacoes,
    data: item.data,
    horario: item.horario,
    valor_original: item.valor_original,
    desconto_aplicado: item.desconto_aplicado,
    valor_final: item.valor_final,
    aceitou_novo_cliente: item.aplicou_novo_cliente,
    agendamento_especial: item.agendamento_especial,
  }));

  const { error: rpcErr } = await supabase.rpc('criar_pedido', {
    p_chave: chave,
    p_nome: nome,
    p_nascimento: nascimento,
    p_whatsapp: whatsapp,
    p_email: Estado.dadosPessoais.email || null,
    p_valor_total: totalFinal,
    p_aceitou_desconto_10: usouNovoCliente,
    p_itens: payloadItens,
  });

  if (rpcErr) {
    if (/sem vagas/i.test(rpcErr.message)) {
      const err = new Error('Uma das leituras ficou sem vagas para a data escolhida. Nenhum agendamento foi criado — escolha outra data e tente de novo.');
      err.userMessage = true;
      throw err;
    }
    if (/desconto_novo_cliente_invalido/i.test(rpcErr.message)) {
      localStorage.setItem('aceitouDesconto10', 'false');
      _renderizarCarrinho();
      const err = new Error('Desconto de novo cliente não se aplica. Os valores foram atualizados — revise antes de continuar.');
      err.userMessage = true;
      throw err;
    }
    throw rpcErr;
  }

  // Limpa carrinho
  Estado.carrinho = [];

  return chave;
}

function validarFormulario() {
  if (!Estado.dataSelecionada) {
    mostrarAlerta('Selecione uma data antes de continuar.', 'error');
    setTimeout(() => irParaPasso(1), 2000);
    return false;
  }

  const dataAgendamento = new Date(Estado.dataSelecionada + 'T23:59:00');
  if (dataAgendamento <= new Date()) {
    mostrarAlerta('Esta data já passou. Selecione uma nova data.', 'error');
    setTimeout(() => irParaPasso(1), 2000);
    return false;
  }

  let ok = true;
  // Só valida perguntas aqui (dados pessoais são validados em section 0)
  if (Estado.tipoSelecionado?.requerPergunta) {
    const n = _numeroDePerguntas(Estado.tipoSelecionado);
    for (let i = 1; i <= n; i++) {
      const el = document.getElementById(`f-obs-${i}`);
      if (!el) continue;
      _limparErroField(el);
      const val = el.value.trim();
      if (val.length < 3) {
        el.classList.add('error');
        mostrarErroField(el, n > 1 ? `Descreva a pergunta ${i}.` : 'Descreva sua pergunta/questão.');
        ok = false;
      }
    }
  }
  return ok;
}

function mostrarErroField(input, msg) {
  let span = input.nextElementSibling;
  if (!span || !span.classList.contains('ag-error-msg')) {
    span = document.createElement('span');
    span.className = 'ag-error-msg';
    span.setAttribute('role', 'alert');
    span.setAttribute('aria-live', 'polite');
    input.parentNode.insertBefore(span, input.nextSibling);
  }
  span.textContent = msg;
  // Limpa ao começar a digitar/corrigir
  if (!input.dataset.errClearBound) {
    input.dataset.errClearBound = '1';
    const limpar = () => _limparErroField(input);
    input.addEventListener('input', limpar);
    input.addEventListener('change', limpar);
  }
}

function _limparErroField(input) {
  input.classList.remove('error');
  const span = input.nextElementSibling;
  if (span && span.classList.contains('ag-error-msg')) span.remove();
}

// (Removida a antiga salvarAgendamento de 1 leitura: o fluxo agora é sempre
//  via carrinho → pedido pai + agendamentos filhos em salvarMultiplosAgendamentos.)

async function gerarChavePedido(tentativas = 0) {
  if (tentativas > 5) throw new Error('Falha ao gerar chave única');
  const chave = gerarChaveAleatoria();
  const { data: existe, error } = await supabase
    .rpc('chave_pedido_existe', { p_chave: chave });
  if (error) throw error;
  if (existe) return gerarChavePedido(tentativas + 1);
  return chave;
}

function gerarChaveAleatoria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bloco = (n) => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CS-${bloco(4)}-${bloco(4)}-${bloco(4)}`;
}

function redirecionarParaPagamento(chave) {
  console.warn('redirecionarParaPagamento não foi substituído — verifique se modal-agendamento.js carregou corretamente.');
  const err = new Error('Erro interno ao redirecionar para pagamento. Recarregue a página.');
  err.userMessage = true;
  throw err;
}

// ============================================================
// Navegação entre passos (1=Data, 2=Dados)
// ============================================================
function irParaPasso(num) {
  // num 1 = calendário (primeiro), 0 = dados pessoais, 2 = perguntas/resumo, 3 = revisão carrinho
  document.querySelectorAll('.ag-section').forEach((s) => {
    const idx = parseInt(s.dataset.passo, 10);
    s.classList.toggle('active', idx === num);
  });

  // Mapeia inner step → outer progress step (3 passos: Dados, Leituras, Pagamento)
  const outerStep = num === 1 ? 1 : (num === 0 || num === 2 ? 2 : 3);
  document.querySelectorAll('.ag-step').forEach((s, i) => {
    s.classList.remove('active','done');
    if (i + 1 === outerStep) s.classList.add('active');
    if (i + 1 < outerStep)   s.classList.add('done');
  });

  if (num === 2) atualizarResumo();
  if (num === 3 && typeof _renderizarCarrinho === 'function') _renderizarCarrinho();

  document.querySelector('.ag-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
// Helpers
// ============================================================
function dataParaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function mostrarAlerta(msg, tipo = 'info') {
  const div = document.createElement('div');
  div.className = `ag-alert ag-alert-${tipo}`;
  div.textContent = msg;
  const main = document.querySelector('.ag-container') || document.body;
  main.prepend(div);
  setTimeout(() => div.remove(), 4000);
}

function obterWhatsappCompleto() {
  const ddi  = document.getElementById('f-ddi');
  const fone = document.getElementById('f-fone');
  const prefixo = ddi ? ddi.value : '+55';
  const numero  = fone ? fone.value.trim() : '';
  return `${prefixo} ${numero}`;
}

function aplicarMascaraFone(input) {
  const ddi = document.getElementById('f-ddi');

  function atualizar() {
    const isBR = !ddi || ddi.value === '+55';
    if (isBR) {
      let v = input.value.replace(/\D/g,'').slice(0,11);
      if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
      else if (v.length) v = `(${v}`;
      input.value = v;
      input.placeholder = '(27) 99999-9999';
    } else {
      input.value = input.value.replace(/[^\d\s\-().+]/g, '');
      input.placeholder = 'Número local';
    }
  }

  input.addEventListener('input', atualizar);
  if (ddi) {
    ddi.addEventListener('change', () => {
      input.value = '';
      atualizar();
    });
  }
}

// ============================================================
// Renderização dinâmica do catálogo no site
// ============================================================
function _escCat(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _escDesc(s) {
  return _escCat(s).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

function _formatarPrecoCat(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n)
    ? `R$&nbsp;${n}`
    : `R$&nbsp;${n.toFixed(2).replace('.', ',')}`;
}

function _agruparCatalogo(tipos) {
  const itens = [];
  const grupos = new Map();
  for (const t of tipos) {
    if (t.grupo_slug) {
      if (!grupos.has(t.grupo_slug)) {
        const item = { kind: 'grupo', grupo_slug: t.grupo_slug, principal: t, tiers: [] };
        grupos.set(t.grupo_slug, item);
        itens.push(item);
      }
      grupos.get(t.grupo_slug).tiers.push(t);
    } else {
      itens.push({ kind: 'single', tipo: t });
    }
  }
  for (const g of grupos.values()) {
    g.tiers.sort((a, b) => Number(a.preco_original) - Number(b.preco_original));
  }
  return itens;
}

function _nomeGrupo(principal) {
  if (!principal.tier_label) return principal.nome;
  const sep = principal.nome.indexOf(' – ');
  return sep > 0 ? principal.nome.slice(0, sep) : principal.nome;
}

async function renderizarCatalogoSite() {
  const grid = document.getElementById('catGrid');
  if (!grid) return;

  const tipos = await _garantirTipos();
  if (!tipos.length) {
    grid.innerHTML = '<div class="ag-empty">Nenhuma leitura disponível no momento.</div>';
    return;
  }

  const itens = _agruparCatalogo(tipos);

  grid.innerHTML = itens.map(item => {
    if (item.kind === 'grupo') {
      const p     = item.principal;
      const nome  = _nomeGrupo(p);
      const img   = p.imagem_url
        ? `<img src="${_escCat(p.imagem_url)}" alt="${_escCat(nome)}" class="cat-img" loading="lazy">`
        : `<div class="cat-img cat-img--placeholder" aria-hidden="true">✦</div>`;
      const desc  = p.descricao ? `<p class="cat-desc">${_escDesc(p.descricao)}</p>` : '';
      const tiers = item.tiers.map(t => `
        <span><span>${_escCat(t.tier_label || t.nome)}</span><strong>${_formatarPrecoCat(t.preco_original)}</strong></span>
      `).join('');

      return `
        <article class="cat-card" data-category="${_escCat(p.terapeuta)}" data-service-id="grupo:${_escCat(item.grupo_slug)}">
          <div class="cat-card-img">${img}</div>
          <div class="cat-body">
            <h3 class="cat-name">${_escCat(nome)}</h3>
            ${desc}
          </div>
          <div class="cat-footer">
            <div class="cat-footer-tiers">${tiers}</div>
            <button class="cat-btn" onclick="abrirSeletor('grupo:${_escCat(item.grupo_slug)}')">Agendar</button>
          </div>
        </article>
      `;
    }

    const t       = item.tipo;
    const slug    = t.slug || `id-${t.id}`;
    const img     = t.imagem_url
      ? `<img src="${_escCat(t.imagem_url)}" alt="${_escCat(t.nome)}" class="cat-img" loading="lazy">`
      : `<div class="cat-img cat-img--placeholder" aria-hidden="true">✦</div>`;
    const desc    = t.descricao ? `<p class="cat-desc">${_escDesc(t.descricao)}</p>` : '';
    const onclick = t.slug ? `abrirSeletor('${_escCat(slug)}')` : `abrirSeletor(${t.id})`;

    return `
      <article class="cat-card" data-category="${_escCat(t.terapeuta)}" data-service-id="${_escCat(slug)}">
        <div class="cat-card-img">${img}</div>
        <div class="cat-body">
          <h3 class="cat-name">${_escCat(t.nome)}</h3>
          ${desc}
        </div>
        <div class="cat-footer">
          <span class="cat-footer-price">${_formatarPrecoCat(t.preco_original)}</span>
          <button class="cat-btn" onclick="${onclick}">Agendar</button>
        </div>
      </article>
    `;
  }).join('');

  if (typeof inicializarFiltrosCatalogo === 'function') inicializarFiltrosCatalogo();
  if (typeof renderizarDescontos === 'function') renderizarDescontos();
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  renderizarCatalogoSite();

  const fone = document.getElementById('f-fone');
  if (fone) aplicarMascaraFone(fone);

  const form = document.getElementById('form-dados');
  if (form) form.addEventListener('submit', processarFormulario);

  const formPessoais = document.getElementById('form-dados-pessoais');
  if (formPessoais) formPessoais.addEventListener('submit', (e) => { e.preventDefault(); confirmarDadosPessoais(); });

  const seletorOverlay = document.getElementById('seletor-overlay');
  if (seletorOverlay) {
    seletorOverlay.addEventListener('click', e => {
      if (e.target === seletorOverlay) fecharSeletor();
    });
  }

  // Abre no calendário (passo 1) por padrão
  document.querySelectorAll('.ag-section').forEach(s => {
    const passo = parseInt(s.dataset.passo, 10);
    s.classList.toggle('active', passo === 1);
  });
});
