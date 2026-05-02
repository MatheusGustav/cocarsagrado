/* ============================================================
   COCAR SAGRADO — Sistema de Agendamento
   ============================================================ */

const Estado = {
  tipoSelecionado:   null,
  dataSelecionada:   null,
  horarioSelecionado:null,
  aceitou10: localStorage.getItem('aceitouDesconto10') === 'true',
};

const DIAS_PT    = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const DIAS_ABREV = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES_PT   = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

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
  'buzios-avulso':        { tipo: 'tier',      terapeuta: 'matheus', nome: 'Búzios Avulso',        prefixo: 'Búzios Avulso – ',       pergunta: 'Quantas perguntas?' },
  'mesa-cigana-avulsa':   { tipo: 'tier',      terapeuta: 'camila',  nome: 'Mesa Cigana Avulsa',   prefixo: 'Mesa Cigana Avulsa – ',  pergunta: 'Quantas perguntas?' },
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
  const { data, error } = await supabase.from('tipos_leitura').select('*');
  if (error) console.error('Erro ao carregar tipos:', error);
  _tiposCache = data || [];
  return _tiposCache;
}

function calcularPrecoFinal(precoOriginal) {
  if (Estado.aceitou10) return { final: precoOriginal * 0.9, desconto: precoOriginal * 0.1 };
  return { final: precoOriginal, desconto: 0 };
}

async function abrirSeletor(serviceId) {
  const config = SERVICO_CONFIG[serviceId];
  if (!config) return;

  const tipos = await _garantirTipos();

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
    if (!tipo) { console.warn('Tipo não encontrado:', config.nome); return; }

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
    tipoFinal = { ..._seletorTierEscolhido, terapeuta: _seletorConfig.terapeuta };
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
// STEP 1 — Calendário
// ============================================================
async function carregarCalendario() {
  const cal = document.getElementById('calendario');
  if (!cal) return;
  cal.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const { data: horarios, error } = await supabase
    .from('horarios_disponiveis')
    .select('dia_semana')
    .eq('ativo', true);

  if (error) {
    cal.innerHTML = '<div class="ag-empty">Erro ao carregar calendário.</div>';
    return;
  }

  const diasComAtendimento = new Set(horarios.map(h => h.dia_semana));
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const dias = [];

  for (let i = 1; i <= 30; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    if (diasComAtendimento.has(d.getDay())) dias.push(d);
  }

  if (!dias.length) {
    cal.innerHTML = '<div class="ag-empty">Nenhuma data disponível nos próximos 30 dias.</div>';
    return;
  }

  cal.innerHTML = '';
  cal.className = 'ag-calendar';
  dias.forEach(d => {
    const str  = dataParaISO(d);
    const card = document.createElement('div');
    card.className = 'ag-day-card';
    card.innerHTML = `
      <div class="day-num">${d.getDate()}</div>
      <div class="day-name">${DIAS_ABREV[d.getDay()]}</div>
      <div class="day-month">${MESES_PT[d.getMonth()]}</div>`;
    card.addEventListener('click', () => selecionarData(str, card));
    cal.appendChild(card);
  });
}

function selecionarData(dataStr, cardEl) {
  document.querySelectorAll('#calendario .ag-day-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  Estado.dataSelecionada = dataStr;
  setTimeout(() => irParaPasso(2), 250);
}

// ============================================================
// STEP 2 — Horários
// ============================================================
async function carregarHorariosData(dataStr) {
  const container = document.getElementById('slots-horarios');
  const titulo    = document.getElementById('titulo-horarios');
  if (!container) return;

  const d = new Date(dataStr + 'T00:00:00');
  if (titulo) titulo.textContent =
    `Horários disponíveis — ${d.getDate()} de ${MESES_PT[d.getMonth()]} (${DIAS_PT[d.getDay()]})`;

  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Verificando...</div>';

  const diaSemana = d.getDay();
  const duracao   = Estado.tipoSelecionado?.duracao_minutos || 60;

  const [{ data: horarios, error: e1 }, { data: ocupados }] = await Promise.all([
    supabase.from('horarios_disponiveis').select('hora_inicio,hora_fim')
      .eq('dia_semana', diaSemana).eq('ativo', true),
    supabase.from('agendamentos').select('hora_agendamento,duracao_minutos')
      .eq('data_agendamento', dataStr).not('status', 'eq', 'cancelado'),
  ]);

  if (e1 || !horarios?.length) {
    container.innerHTML = '<div class="ag-empty">Sem horários para este dia.</div>';
    return;
  }

  const slots = gerarSlots(horarios, duracao, ocupados || []);
  if (!slots.length) {
    container.innerHTML = '<div class="ag-empty">Sem slots disponíveis neste dia.</div>';
    return;
  }

  container.innerHTML = '';
  container.className = 'ag-slots';
  slots.forEach(({ hora, ocupado }) => {
    const el = document.createElement('div');
    el.className = 'ag-slot' + (ocupado ? ' occupied' : '');
    el.textContent = hora;
    el.title = ocupado ? 'Horário indisponível' : hora;
    if (!ocupado) el.addEventListener('click', () => selecionarHorario(hora, el));
    container.appendChild(el);
  });
}

function gerarSlots(horarios, duracao, ocupados) {
  const slots = [];
  horarios.forEach(({ hora_inicio, hora_fim }) => {
    let atual = horaParaMinutos(hora_inicio);
    const fim = horaParaMinutos(hora_fim);
    while (atual + duracao <= fim) {
      const horaStr = minutosParaHora(atual);
      const ocupado = ocupados.some(o =>
        horariosSeSobrepoe(atual, atual + duracao,
          horaParaMinutos(o.hora_agendamento),
          horaParaMinutos(o.hora_agendamento) + (o.duracao_minutos || 60))
      );
      slots.push({ hora: horaStr, ocupado });
      atual += 30;
    }
  });
  return slots;
}

function horariosSeSobrepoe(ini1, fim1, ini2, fim2) {
  return ini1 < fim2 && fim1 > ini2;
}

function selecionarHorario(hora, el) {
  document.querySelectorAll('#slots-horarios .ag-slot').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  Estado.horarioSelecionado = hora;
  atualizarResumo();
  setTimeout(() => irParaPasso(3), 250);
}

// ============================================================
// STEP 3 — Formulário
// ============================================================
function atualizarResumo() {
  const tipo = Estado.tipoSelecionado;
  const data = Estado.dataSelecionada;
  const hora = Estado.horarioSelecionado;
  if (!tipo || !data || !hora) return;

  const { final, desconto } = calcularPrecoFinal(tipo.preco_original);
  const d = new Date(data + 'T00:00:00');

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('res-tipo',    tipo.nome);
  set('res-data',    `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`);
  set('res-hora',    hora);
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
    .catch(() => {
      mostrarAlerta('Erro ao salvar agendamento. Tente novamente.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Continuar para Pagamento'; }
    });
}

function validarFormulario() {
  let ok = true;
  const campos = [
    { id: 'f-nome',  minLen: 3,   msg: 'Nome deve ter pelo menos 3 caracteres.' },
    { id: 'f-email', email: true, msg: 'E-mail inválido.' },
    { id: 'f-fone',  minLen: 10, msg: 'WhatsApp inválido.' },
  ];
  campos.forEach(({ id, minLen, email, msg }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('error');
    const val = el.value.trim();
    const invalido = email
      ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
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
    cliente_email:       document.getElementById('f-email').value.trim(),
    cliente_whatsapp:    document.getElementById('f-fone').value.trim(),
    cliente_observacoes: document.getElementById('f-obs')?.value.trim() || null,
    data_agendamento:    Estado.dataSelecionada,
    hora_agendamento:    Estado.horarioSelecionado,
    duracao_minutos:     tipo.duracao_minutos,
    valor_original:      tipo.preco_original,
    desconto_aplicado:   desconto,
    valor_final:         final,
    aceitou_desconto_10: Estado.aceitou10,
    status:              'pendente',
  };

  const { error } = await supabase.from('agendamentos').insert(payload);
  if (error) throw error;
  return chave;
}

async function gerarChavePedido(tentativas = 0) {
  if (tentativas > 5) throw new Error('Falha ao gerar chave única');
  const chave = gerarChaveAleatoria();
  const { data } = await supabase.from('agendamentos').select('id').eq('chave_pedido', chave).maybeSingle();
  if (data) return gerarChavePedido(tentativas + 1);
  return chave;
}

function gerarChaveAleatoria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bloco = (n) => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CS-${bloco(4)}-${bloco(4)}-${bloco(4)}`;
}

function redirecionarParaPagamento(chave) {
  // substituído por modal-agendamento.js (window.redirecionarParaPagamento)
}

// ============================================================
// Navegação entre passos (1=Data, 2=Horário, 3=Dados)
// ============================================================
function irParaPasso(num) {
  if (num === 2 && Estado.dataSelecionada) carregarHorariosData(Estado.dataSelecionada);
  if (num === 3) atualizarResumo();

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
function horaParaMinutos(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}
function minutosParaHora(min) {
  const h = Math.floor(min / 60).toString().padStart(2,'0');
  const m = (min % 60).toString().padStart(2,'0');
  return `${h}:${m}`;
}
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
  _garantirTipos(); // pré-carrega para o seletor responder rápido

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
