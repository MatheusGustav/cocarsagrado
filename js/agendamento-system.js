/* ============================================================
   COCAR SAGRADO — Sistema de Agendamento (Sistema de Vagas)
   ============================================================ */

const Estado = {
  tipoSelecionado: null,
  dataSelecionada: null,
};

const DIAS_PT  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ============================================================
// SELETOR DE QUANTIDADE / TIER
// ============================================================

let _tiposCache          = null;
let _seletorConfig       = null;
let _seletorQty          = 1;
let _seletorTierEscolhido= null;

const WHATSAPP_TERAPEUTA = {
  matheus: '5528999476620',
  camila:  '5527998528483',
};

const SERVICO_CONFIG = {
  'buzios-avulso':        { tipo: 'tier',      terapeuta: 'matheus', nome: 'Búzios Avulso',        prefixo: 'Búzios Avulso – ',       pergunta: 'Quantas perguntas?', requerPergunta: true },
  'mesa-cigana-avulsa':   { tipo: 'tier',      terapeuta: 'camila',  nome: 'Mesa Cigana Avulsa',   prefixo: 'Mesa Cigana Avulsa – ',  pergunta: 'Quantas perguntas?', requerPergunta: true },
  'buzios-completo':      { tipo: 'quantidade', terapeuta: 'matheus', nome: 'Búzios Completo',      pergunta: 'Quantas sessões?' },
  'confirmacao-orixas':   { tipo: 'quantidade', terapeuta: 'matheus', nome: 'Confirmação de Orixás',pergunta: 'Quantas sessões?' },
  'cabala-odu':           { tipo: 'quantidade', terapeuta: 'matheus', nome: 'Cabala de Odu',        pergunta: 'Quantas sessões?' },
  'confirmacao-exu':      { tipo: 'quantidade', terapeuta: 'matheus', nome: 'Confirmação de Exu',   pergunta: 'Quantas sessões?' },
  'mesa-cigana-completa': { tipo: 'quantidade', terapeuta: 'camila',  nome: 'Mesa Cigana Completa', pergunta: 'Quantas sessões?' },
  'aguas-oxum':           { tipo: 'quantidade', terapeuta: 'camila',  nome: 'Águas de Oxum',        pergunta: 'Quantas sessões?' },
  'rosa-venus':           { tipo: 'quantidade', terapeuta: 'camila',  nome: 'Rosa de Vênus',        pergunta: 'Quantas sessões?' },
  'leitura-mentores':     { tipo: 'quantidade', terapeuta: 'camila',  nome: 'Leitura dos Mentores', pergunta: 'Quantas sessões?' },
  'mesa-mediunica':       { tipo: 'quantidade', terapeuta: 'camila',  nome: 'Mesa Mediúnica',       pergunta: 'Quantas sessões?' },
  'mesa-radionica':       { tipo: 'quantidade', terapeuta: 'camila',  nome: 'Mesa Radiônica',       pergunta: 'Quantas sessões?' },
  'registros-akashicos':  { tipo: 'quantidade', terapeuta: 'camila',  nome: 'Registros Akáshicos',  pergunta: 'Quantas sessões?' },
  'theta-healing':        { tipo: 'quantidade', terapeuta: 'camila',  nome: 'Theta Healing',        pergunta: 'Quantas sessões?' },
};

async function _garantirTipos() {
  if (_tiposCache) return _tiposCache;
  if (typeof supabase === 'undefined' || !supabase) {
    console.error('Supabase não carregado — verifique a conexão com a CDN.');
    return [];
  }
  const { data, error } = await supabase.from('tipos_leitura').select('*');
  if (error) {
    console.error('Erro ao carregar tipos:', error);
    return [];
  }
  _tiposCache = data || [];
  return _tiposCache;
}

function calcularPrecoFinal(precoOriginal) {
  if (localStorage.getItem('aceitouDesconto10') === 'true') {
    const final = Math.round(precoOriginal * 90) / 100;
    return { final, desconto: precoOriginal - final };
  }
  return { final: precoOriginal, desconto: 0 };
}

async function abrirSeletor(serviceId) {
  const config = SERVICO_CONFIG[serviceId];
  if (!config) return;

  let tipos;
  try {
    tipos = await _garantirTipos();
  } catch (err) {
    console.error('abrirSeletor: falha ao carregar tipos', err);
    mostrarAlerta('Erro de conexão. Verifique sua internet e tente novamente.', 'error');
    return;
  }

  _seletorConfig        = config;
  _seletorQty           = 1;
  _seletorTierEscolhido = null;

  const tiersEl    = document.getElementById('seletor-tiers');
  const qtyEl      = document.getElementById('seletor-qty-wrap');
  const resumoEl   = document.getElementById('seletor-resumo');
  const btnConfirm = document.getElementById('seletor-btn-confirm');

  document.getElementById('seletor-nome').textContent     = config.nome;
  document.getElementById('seletor-pergunta').textContent = config.pergunta;

  if (config.tipo === 'tier') {
    const tiers = tipos
      .filter(t => t.nome.startsWith(config.prefixo))
      .sort((a, b) => a.preco_original - b.preco_original);

    tiersEl.innerHTML = '';
    tiers.forEach(tier => {
      const { final } = calcularPrecoFinal(tier.preco_original);
      const label = tier.nome.replace(config.prefixo, '');
      const opt = document.createElement('div');
      opt.className = 'seletor-tier-opt';
      opt.innerHTML = `
        <span class="tier-label">${label}</span>
        <div class="tier-info">
          <span class="tier-duracao">⏱ ${tier.duracao_minutos} min</span>
          <span class="tier-preco">R$ ${final.toFixed(0)}</span>
        </div>`;
      opt.addEventListener('click', () => {
        tiersEl.querySelectorAll('.seletor-tier-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        _seletorTierEscolhido = tier;
        btnConfirm.removeAttribute('disabled');
      });
      tiersEl.appendChild(opt);
    });

    tiersEl.style.display  = 'flex';
    qtyEl.style.display    = 'none';
    resumoEl.style.display = 'none';
    btnConfirm.setAttribute('disabled', '');

  } else {
    const tipo = tipos.find(t => t.nome === config.nome);
    if (!tipo) {
      console.warn('Tipo não encontrado:', config.nome);
      mostrarAlerta('Serviço temporariamente indisponível. Tente novamente.', 'error');
      return;
    }

    _seletorTierEscolhido = tipo;
    tiersEl.style.display  = 'none';
    qtyEl.style.display    = 'flex';
    resumoEl.style.display = 'flex';
    _atualizarResumoSeletor();
    btnConfirm.removeAttribute('disabled');
  }

  document.getElementById('seletor-overlay').classList.add('open');
  document.body.classList.add('seletor-aberto');
}

function _atualizarResumoSeletor() {
  const tipo = _seletorTierEscolhido;
  if (!tipo) return;
  const total    = tipo.preco_original  * _seletorQty;
  const durTotal = tipo.duracao_minutos * _seletorQty;
  const { final } = calcularPrecoFinal(total);

  document.getElementById('seletor-qty').textContent     = _seletorQty;
  document.getElementById('seletor-preco').textContent   = `R$ ${final.toFixed(0)}`;
  document.getElementById('seletor-duracao').textContent = _formatarDuracao(durTotal);
}

function _formatarDuracao(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}min` : `${h}h`;
}

function alterarQty(delta) {
  _seletorQty = Math.max(1, Math.min(5, _seletorQty + delta));
  _atualizarResumoSeletor();
}

function fecharSeletor() {
  document.getElementById('seletor-overlay')?.classList.remove('open');
  document.body.classList.remove('seletor-aberto');
}

function confirmarSeletor() {
  if (!_seletorConfig || !_seletorTierEscolhido) return;

  let tipoFinal;
  if (_seletorConfig.tipo === 'tier') {
    tipoFinal = { ..._seletorTierEscolhido, terapeuta: _seletorConfig.terapeuta, requerPergunta: !!_seletorConfig.requerPergunta };
  } else {
    tipoFinal = {
      ..._seletorTierEscolhido,
      terapeuta:       _seletorConfig.terapeuta,
      preco_original:  _seletorTierEscolhido.preco_original  * _seletorQty,
      duracao_minutos: _seletorTierEscolhido.duracao_minutos * _seletorQty,
      nome: _seletorQty > 1
        ? `${_seletorTierEscolhido.nome} (×${_seletorQty})`
        : _seletorTierEscolhido.nome,
    };
  }

  fecharSeletor();
  abrirModal(tipoFinal);
}

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
    const dias = await _buscarDiasComVagas(profissional, 45);

    if (!dias.length) {
      const numero = WHATSAPP_TERAPEUTA[profissional] || '';
      cal.innerHTML = `
        <div class="ag-empty ag-empty-vagas">
          <p>Nenhuma data disponível nos próximos 45 dias.</p>
          <p style="font-size:.85rem; margin-top:4px;">Entre em contato para verificar disponibilidade especial.</p>
          ${numero ? `<a href="https://wa.me/${numero}" target="_blank" rel="noopener" class="ag-btn ag-btn-whatsapp" style="margin-top:14px; display:inline-flex;">💬 Falar no WhatsApp</a>` : ''}
        </div>`;
      return;
    }

    cal.innerHTML = '';
    cal.className = 'ag-vagas-lista';

    dias.forEach(({ data, vagas, ate_horario }) => {
      const d = new Date(data + 'T00:00:00');
      const card = document.createElement('div');
      card.className = 'ag-vagas-card';

      const h = ate_horario ? parseInt(ate_horario.slice(0, 2)) : null;
      const horarioLabel = h !== null ? `até ${h}h` : '';
      const vagasText    = vagas === 1 ? '1 vaga disponível' : `${vagas} vagas disponíveis`;
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
          <span class="ag-vagas-badge">✨ ${vagasText}${horarioLabel ? ' (' + horarioLabel + ')' : ''}</span>
        </div>
        <span class="ag-vagas-action" aria-hidden="true">→</span>`;

      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Agendar em ${DIAS_PT[d.getDay()]}, ${d.getDate()} de ${MESES_PT[d.getMonth()]} — ${vagasText}`);
      card.addEventListener('click', () => selecionarData(data, card));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selecionarData(data, card); } });
      cal.appendChild(card);
    });
  } catch (err) {
    console.error('carregarCalendario:', err);
    cal.innerHTML = '<div class="ag-empty">Erro ao carregar disponibilidade. Tente novamente.</div>';
  }
}

async function _buscarDiasComVagas(profissional, diasParaFrente) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = dataParaISO(new Date(hoje.getTime() + 86400000));
  const dataFim    = dataParaISO(new Date(hoje.getTime() + diasParaFrente * 86400000));

  const [
    { data: padroes },
    { data: overrides },
    { data: agendados },
  ] = await Promise.all([
    supabase.from('disponibilidade_padrao').select('*').eq('profissional', profissional).eq('ativo', true),
    supabase.from('disponibilidade_override').select('*').eq('profissional', profissional).gte('data', dataInicio).lte('data', dataFim),
    supabase.from('agendamentos').select('data_agendamento').eq('terapeuta', profissional).gte('data_agendamento', dataInicio).lte('data_agendamento', dataFim).in('status', ['pago','confirmado','atendido','pendente']),
  ]);

  const padraoMap = {};
  (padroes || []).forEach(p => { padraoMap[p.dia_semana] = p; });

  const overrideMap = {};
  (overrides || []).forEach(o => { overrideMap[o.data] = o; });

  const contagemMap = {};
  (agendados || []).forEach(a => {
    contagemMap[a.data_agendamento] = (contagemMap[a.data_agendamento] || 0) + 1;
  });

  const dias = [];
  for (let i = 1; i <= diasParaFrente; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    const str    = dataParaISO(d);
    const usadas = contagemMap[str] || 0;

    const ov = overrideMap[str];
    if (ov) {
      if (ov.ativo) {
        const restantes = Math.max(0, ov.vagas_total - usadas);
        if (restantes > 0) dias.push({ data: str, vagas: restantes, ate_horario: ov.ate_horario });
      }
    } else {
      const padrao = padraoMap[d.getDay()];
      if (padrao && padrao.vagas_total > 0) {
        const restantes = Math.max(0, padrao.vagas_total - usadas);
        if (restantes > 0) dias.push({ data: str, vagas: restantes, ate_horario: padrao.ate_horario });
      }
    }
  }

  return dias;
}

function selecionarData(dataStr, cardEl) {
  document.querySelectorAll('#calendario .ag-vagas-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  Estado.dataSelecionada = dataStr;
  setTimeout(() => irParaPasso(2), 250);
}

// ============================================================
// STEP 2 — Formulário
// ============================================================
function atualizarResumo() {
  const tipo = Estado.tipoSelecionado;
  const data = Estado.dataSelecionada;
  if (!tipo || !data) return;

  const { final, desconto } = calcularPrecoFinal(tipo.preco_original);
  const d = new Date(data + 'T00:00:00');

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('res-tipo',    tipo.nome);
  set('res-data',    `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`);
  set('res-hora',    'A combinar via WhatsApp 💬');
  set('res-duracao', _formatarDuracao(tipo.duracao_minutos));
  set('res-valor',   `R$ ${final.toFixed(2).replace('.', ',')}`);

  const linhaDesc = document.getElementById('res-desconto-linha');
  if (linhaDesc) linhaDesc.style.display = desconto > 0 ? 'flex' : 'none';
  set('res-desconto', `- R$ ${desconto.toFixed(2).replace('.', ',')}`);
}

function processarFormulario(e) {
  e.preventDefault();
  if (!validarFormulario()) return;

  const btn = document.getElementById('btn-pagar');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  salvarAgendamento()
    .then(chave => { if (chave) redirecionarParaPagamento(chave); })
    .catch(err => {
      console.error('salvarAgendamento:', err);
      mostrarAlerta('Erro ao salvar agendamento. Tente novamente.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Continuar para Pagamento'; }
    });
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
  const campos = [
    { id: 'f-nome', minLen: 3,  msg: 'Nome deve ter pelo menos 3 caracteres.' },
    { id: 'f-nasc', date: true, msg: 'Data de nascimento inválida.' },
    { id: 'f-fone', minLen: 10, msg: 'WhatsApp inválido.' },
  ];
  if (Estado.tipoSelecionado?.requerPergunta) {
    campos.push({ id: 'f-obs', minLen: 3, msg: 'Descreva sua pergunta/questão.' });
  }
  campos.forEach(({ id, minLen, date, msg }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('error');
    const val = el.value.trim();
    const invalido = date
      ? !val
      : id === 'f-fone'
        ? val.replace(/\D/g,'').length < minLen
        : val.length < minLen;
    if (invalido) { el.classList.add('error'); mostrarErroField(el, msg); ok = false; }
  });
  return ok;
}

function mostrarErroField(input, msg) {
  let span = input.nextElementSibling;
  if (!span || !span.classList.contains('ag-error-msg')) {
    span = document.createElement('span');
    span.className = 'ag-error-msg';
    input.parentNode.insertBefore(span, input.nextSibling);
  }
  span.textContent = msg;
  setTimeout(() => { if (span) span.remove(); }, 3000);
}

async function salvarAgendamento() {
  const tipo = Estado.tipoSelecionado;
  const { final, desconto } = calcularPrecoFinal(tipo.preco_original);
  const chave = await gerarChavePedido();

  const payload = {
    chave_pedido:        chave,
    tipo_leitura_id:     tipo.id,
    terapeuta:           tipo.terapeuta || null,
    cliente_nome:        document.getElementById('f-nome').value.trim(),
    cliente_nascimento:  document.getElementById('f-nasc')?.value || null,
    cliente_whatsapp:    document.getElementById('f-fone').value.trim(),
    cliente_observacoes: document.getElementById('f-obs')?.value?.trim() || null,
    data_agendamento:    Estado.dataSelecionada,
    hora_agendamento:    '00:00',
    duracao_minutos:     tipo.duracao_minutos,
    valor_original:      tipo.preco_original,
    desconto_aplicado:   desconto,
    valor_final:         final,
    aceitou_desconto_10: localStorage.getItem('aceitouDesconto10') === 'true',
    status:              'pendente',
  };

  const { error } = await supabase.from('agendamentos').insert(payload);
  if (error) throw error;
  return chave;
}

async function gerarChavePedido(tentativas = 0) {
  if (tentativas > 5) throw new Error('Falha ao gerar chave única');
  const chave = gerarChaveAleatoria();
  const { data, error } = await supabase
    .from('agendamentos').select('id').eq('chave_pedido', chave).maybeSingle();
  if (error) throw error;
  if (data) return gerarChavePedido(tentativas + 1);
  return chave;
}

function gerarChaveAleatoria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bloco = (n) => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CS-${bloco(4)}-${bloco(4)}-${bloco(4)}`;
}

function redirecionarParaPagamento(chave) {
  console.warn('redirecionarParaPagamento não foi substituído — verifique se modal-agendamento.js carregou corretamente.');
  mostrarAlerta('Erro interno ao redirecionar para pagamento. Recarregue a página.', 'error');
}

// ============================================================
// Navegação entre passos (1=Data, 2=Dados)
// ============================================================
function irParaPasso(num) {
  if (num === 2) atualizarResumo();

  document.querySelectorAll('.ag-section').forEach((s, i) => {
    s.classList.toggle('active', i + 1 === num);
  });
  document.querySelectorAll('.ag-step').forEach((s, i) => {
    s.classList.remove('active','done');
    if (i + 1 === num) s.classList.add('active');
    if (i + 1 < num)   s.classList.add('done');
  });

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

function aplicarMascaraFone(input) {
  input.addEventListener('input', () => {
    let v = input.value.replace(/\D/g,'').slice(0,11);
    if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
    else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
    else if (v.length) v = `(${v}`;
    input.value = v;
  });
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  _garantirTipos();

  const fone = document.getElementById('f-fone');
  if (fone) aplicarMascaraFone(fone);

  const form = document.getElementById('form-dados');
  if (form) form.addEventListener('submit', processarFormulario);

  const seletorOverlay = document.getElementById('seletor-overlay');
  if (seletorOverlay) {
    seletorOverlay.addEventListener('click', e => {
      if (e.target === seletorOverlay) fecharSeletor();
    });
  }
});
