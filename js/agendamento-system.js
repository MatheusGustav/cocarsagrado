/* ============================================================
   COCAR SAGRADO — Sistema de Agendamento
   ============================================================ */

// Estado global
const Estado = {
  tipoSelecionado: null,    // { id, nome, preco_original, duracao_minutos, ... }
  dataSelecionada: null,    // 'YYYY-MM-DD'
  horarioSelecionado: null, // 'HH:MM'
  aceitou10: localStorage.getItem('aceitouDesconto10') === 'true',
};

// Nomes dos dias da semana (0=Dom ... 6=Sáb)
const DIAS_PT = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const DIAS_ABREV = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ============================================================
// STEP 1 — Tipos de leitura
// ============================================================
async function carregarTiposLeitura() {
  const grid = document.getElementById('grid-tipos');
  if (!grid) return;
  grid.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const { data, error } = await supabase
    .from('tipos_leitura')
    .select('*')
    .eq('ativo', true)
    .order('preco_original');

  if (error || !data?.length) {
    grid.innerHTML = '<div class="ag-empty">Nenhuma leitura disponível no momento.</div>';
    return;
  }

  grid.innerHTML = '';
  data.forEach(tipo => grid.appendChild(criarCardTipo(tipo)));
}

function calcularPrecoFinal(precoOriginal) {
  if (Estado.aceitou10) return { final: precoOriginal * 0.9, desconto: precoOriginal * 0.1 };
  return { final: precoOriginal, desconto: 0 };
}

function criarCardTipo(tipo) {
  const card = document.createElement('div');
  card.className = 'ag-card';
  card.dataset.id = tipo.id;

  const { final } = calcularPrecoFinal(tipo.preco_original);
  const temDesconto = Estado.aceitou10;

  const precoHTML = temDesconto
    ? `<div class="ag-price-block">
        <span class="ag-price-old">R$ ${tipo.preco_original.toFixed(2).replace('.', ',')}</span>
        <span class="ag-price-desc">R$ ${final.toFixed(2).replace('.', ',')}</span>
       </div>`
    : `<span class="ag-price">R$ ${tipo.preco_original.toFixed(2).replace('.', ',')}</span>`;

  card.innerHTML = `
    ${temDesconto ? '<div class="ag-badge">10% OFF</div>' : ''}
    <h3>${tipo.nome}</h3>
    <p>${tipo.descricao || ''}</p>
    <div class="ag-card-meta">
      <span class="ag-card-duration">⏱ ${tipo.duracao_minutos} min</span>
      ${precoHTML}
    </div>`;

  card.addEventListener('click', () => selecionarTipoLeitura(tipo, card));
  return card;
}

function selecionarTipoLeitura(tipo, cardEl) {
  document.querySelectorAll('#grid-tipos .ag-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  Estado.tipoSelecionado = tipo;
  setTimeout(() => irParaPasso(2), 250);
}

// ============================================================
// STEP 2 — Calendário
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
    const str = dataParaISO(d);
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
  setTimeout(() => irParaPasso(3), 250);
}

// ============================================================
// STEP 3 — Horários
// ============================================================
async function carregarHorariosData(dataStr) {
  const container = document.getElementById('slots-horarios');
  const titulo    = document.getElementById('titulo-horarios');
  if (!container) return;

  const d = new Date(dataStr + 'T00:00:00');
  if (titulo) titulo.textContent = `Horários disponíveis — ${d.getDate()} de ${MESES_PT[d.getMonth()]} (${DIAS_PT[d.getDay()]})`;

  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Verificando...</div>';

  const diaSemana = d.getDay();
  const duracao   = Estado.tipoSelecionado?.duracao_minutos || 60;

  const [{ data: horarios, error: e1 }, { data: ocupados, error: e2 }] = await Promise.all([
    supabase.from('horarios_disponiveis').select('hora_inicio,hora_fim').eq('dia_semana', diaSemana).eq('ativo', true),
    supabase.from('agendamentos').select('hora_agendamento,duracao_minutos')
      .eq('data_agendamento', dataStr)
      .not('status', 'eq', 'cancelado'),
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
  setTimeout(() => irParaPasso(4), 250);
}

// ============================================================
// STEP 4 — Formulário
// ============================================================
function atualizarResumo() {
  const tipo  = Estado.tipoSelecionado;
  const data  = Estado.dataSelecionada;
  const hora  = Estado.horarioSelecionado;
  if (!tipo || !data || !hora) return;

  const { final, desconto } = calcularPrecoFinal(tipo.preco_original);
  const d = new Date(data + 'T00:00:00');

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('res-tipo',   tipo.nome);
  set('res-data',   `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`);
  set('res-hora',   hora);
  set('res-duracao',`${tipo.duracao_minutos} min`);
  set('res-valor',  `R$ ${final.toFixed(2).replace('.', ',')}`);

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
    { id: 'f-nome',  minLen: 3,  msg: 'Nome deve ter pelo menos 3 caracteres.' },
    { id: 'f-email', email: true, msg: 'E-mail inválido.' },
    { id: 'f-fone',  minLen: 10, msg: 'WhatsApp inválido.' },
  ];

  campos.forEach(({ id, minLen, email, msg }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('error');
    const val = el.value.trim();
    let invalido = false;
    if (email) invalido = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    else invalido = val.replace(/\D/g,'').length < minLen;
    if (invalido) {
      el.classList.add('error');
      mostrarErroField(el, msg);
      ok = false;
    }
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
  const tipo    = Estado.tipoSelecionado;
  const { final, desconto } = calcularPrecoFinal(tipo.preco_original);
  const chave   = await gerarChavePedido();

  const payload = {
    chave_pedido:        chave,
    tipo_leitura_id:     tipo.id,
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
  const tipo  = Estado.tipoSelecionado;
  const { final } = calcularPrecoFinal(tipo.preco_original);
  const d = new Date(Estado.dataSelecionada + 'T00:00:00');

  sessionStorage.setItem('agendamento', JSON.stringify({
    chave,
    tipo:     tipo.nome,
    data:     `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`,
    hora:     Estado.horarioSelecionado,
    duracao:  tipo.duracao_minutos,
    valor:    final.toFixed(2).replace('.', ','),
    nome:     document.getElementById('f-nome').value.trim(),
    whatsapp: document.getElementById('f-fone').value.trim(),
  }));

  window.location.href = 'pagamento.html';
}

// ============================================================
// Navegação entre passos
// ============================================================
function irParaPasso(num) {
  if (num === 3 && Estado.dataSelecionada) carregarHorariosData(Estado.dataSelecionada);
  if (num === 4) atualizarResumo();

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

// Máscara WhatsApp
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
  carregarTiposLeitura();

  const fone = document.getElementById('f-fone');
  if (fone) aplicarMascaraFone(fone);

  const form = document.getElementById('form-dados');
  if (form) form.addEventListener('submit', processarFormulario);
});
