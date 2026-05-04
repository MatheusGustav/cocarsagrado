/* ============================================================
   COCAR SAGRADO — Controle de Agenda (Admin)
   Modal por dia — salva individualmente no Supabase
   ============================================================ */

const DIAS_SEMANA_AGENDA   = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const DIAS_SEMANA_COMPLETO = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

let _diaEditando      = null;
let _terapeutaAgenda  = localStorage.getItem('agenda_terapeuta') || 'matheus';

// ============================================================
// Seletor de terapeuta
// ============================================================
function trocarTerapeutaAgenda(t) {
  _terapeutaAgenda = t;
  localStorage.setItem('agenda_terapeuta', t);
  _atualizarBotoesTerapeuta();
  carregarAgenda();
}

function _atualizarBotoesTerapeuta() {
  document.getElementById('btn-ag-matheus')?.classList.toggle('active', _terapeutaAgenda === 'matheus');
  document.getElementById('btn-ag-camila')?.classList.toggle('active',  _terapeutaAgenda === 'camila');
}

// ============================================================
// Carregar e renderizar overview
// ============================================================
async function carregarAgenda() {
  const grade = document.getElementById('grade-agenda');
  if (!grade) return;
  grade.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const { data, error } = await supabase
    .from('horarios_disponiveis')
    .select('*')
    .eq('terapeuta', _terapeutaAgenda)
    .order('dia_semana')
    .order('hora_inicio');

  if (error) {
    grade.innerHTML = '<div class="ag-empty">Erro ao carregar agenda.</div>';
    console.error(error);
    return;
  }

  renderizarAgenda(data || []);
}

function renderizarAgenda(registros) {
  const grade = document.getElementById('grade-agenda');
  if (!grade) return;
  grade.innerHTML = '';

  for (let dia = 0; dia < 7; dia++) {
    const faixas  = registros.filter(r => r.dia_semana === dia);
    const diaAtivo = faixas.some(r => r.ativo);

    const tagsHtml = faixas.length
      ? faixas.map(f =>
          `<span class="agenda-tag-hora">${f.hora_inicio.slice(0,5)} — ${f.hora_fim.slice(0,5)}</span>`
        ).join('')
      : `<span class="agenda-sem-faixas">Sem horários</span>`;

    const card = document.createElement('div');
    card.className = 'agenda-card-overview' + (diaAtivo ? ' ativo' : '');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Editar ${DIAS_SEMANA_COMPLETO[dia]}`);
    card.innerHTML = `
      <div class="agenda-card-header">
        <span class="agenda-dia-nome">${DIAS_SEMANA_AGENDA[dia]}</span>
        <span class="agenda-status-pill ${diaAtivo ? 'ativo' : 'inativo'}">${diaAtivo ? 'Ativo' : 'Inativo'}</span>
      </div>
      <div class="agenda-tags">${tagsHtml}</div>
      <div class="agenda-card-footer">
        <span class="agenda-card-hint">Clique para editar</span>
        <span class="agenda-card-arrow">→</span>
      </div>
    `;

    card.addEventListener('click', () => abrirModalDia(dia));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') abrirModalDia(dia); });
    grade.appendChild(card);
  }
}

// ============================================================
// Modal — abrir / fechar
// ============================================================
async function abrirModalDia(dia) {
  _diaEditando = dia;

  const modal = document.getElementById('agenda-modal');
  document.getElementById('agenda-modal-titulo').textContent = DIAS_SEMANA_COMPLETO[dia];
  document.getElementById('agenda-modal-faixas').innerHTML =
    '<div class="ag-loading"><div class="ag-spinner"></div></div>';

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  await _carregarDiaNoModal(dia);
}

function fecharModalDia() {
  document.getElementById('agenda-modal').classList.remove('open');
  document.body.style.overflow = '';
  _diaEditando = null;
}

async function _carregarDiaNoModal(dia) {
  const { data } = await supabase
    .from('horarios_disponiveis')
    .select('*')
    .eq('dia_semana', dia)
    .eq('terapeuta', _terapeutaAgenda)
    .order('hora_inicio');

  const faixas   = data || [];
  // Sem faixas = inativo (mesmo critério do card no overview).
  const diaAtivo = faixas.some(f => f.ativo);

  const toggle = document.getElementById('agenda-modal-toggle');
  const label  = document.getElementById('agenda-toggle-label');
  toggle.checked    = diaAtivo;
  label.textContent = diaAtivo ? 'Dia ativo' : 'Dia inativo';

  const lista = document.getElementById('agenda-modal-faixas');
  lista.innerHTML = '';

  if (faixas.length) {
    faixas.forEach(f => lista.appendChild(_criarLinhaFaixaModal(f.hora_inicio.slice(0,5), f.hora_fim.slice(0,5))));
  } else {
    lista.appendChild(_criarLinhaFaixaModal('08:00', '18:00'));
  }
}

// ============================================================
// Linhas de faixa no modal
// ============================================================
function _criarLinhaFaixaModal(inicio, fim) {
  const div = document.createElement('div');
  div.className = 'agenda-faixa-row-modal';
  div.innerHTML = `
    <div class="agenda-faixa-inputs">
      <input type="time" class="agenda-time-modal hora-inicio" value="${inicio}">
      <span class="agenda-sep-modal">até</span>
      <input type="time" class="agenda-time-modal hora-fim" value="${fim}">
    </div>
    <button class="agenda-faixa-remover" onclick="this.closest('.agenda-faixa-row-modal').remove()" title="Remover faixa" aria-label="Remover">✕</button>
  `;
  return div;
}

function adicionarFaixaModal() {
  const lista = document.getElementById('agenda-modal-faixas');
  const nova  = _criarLinhaFaixaModal('08:00', '18:00');
  lista.appendChild(nova);
  nova.querySelector('.hora-inicio').focus();
}

// Sincroniza label do toggle
document.addEventListener('DOMContentLoaded', () => {
  _atualizarBotoesTerapeuta();

  const toggle = document.getElementById('agenda-modal-toggle');
  const label  = document.getElementById('agenda-toggle-label');
  if (toggle && label) {
    toggle.addEventListener('change', () => {
      label.textContent = toggle.checked ? 'Dia ativo' : 'Dia inativo';
    });
  }

  // ESC fecha modal (só se estiver aberto)
  document.addEventListener('keydown', e => {
    const m = document.getElementById('agenda-modal');
    if (e.key === 'Escape' && m?.classList.contains('open')) fecharModalDia();
  });

  // Backdrop fecha modal
  document.getElementById('agenda-modal')?.addEventListener('click', e => {
    if (e.target.id === 'agenda-modal') fecharModalDia();
  });
});

// ============================================================
// Salvar dia individualmente
// ============================================================
function _validarFaixas(faixas) {
  for (const f of faixas) {
    if (!f.hora_inicio || !f.hora_fim) return 'Preencha início e fim de todas as faixas.';
    if (f.hora_inicio >= f.hora_fim) {
      return `Faixa inválida: ${f.hora_inicio} → ${f.hora_fim} (início deve ser menor que fim).`;
    }
  }
  const sorted = [...faixas].sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].hora_inicio < sorted[i - 1].hora_fim) {
      return `Faixas se sobrepõem: ${sorted[i - 1].hora_inicio}–${sorted[i - 1].hora_fim} e ${sorted[i].hora_inicio}–${sorted[i].hora_fim}.`;
    }
  }
  return null;
}

async function salvarDia() {
  const dia = _diaEditando;
  if (dia === null) return;

  const btn   = document.getElementById('agenda-modal-salvar');
  const orig  = btn.textContent;
  btn.disabled  = true;
  btn.textContent = 'Salvando…';

  const ativo = document.getElementById('agenda-modal-toggle').checked;
  const rows  = document.querySelectorAll('.agenda-faixa-row-modal');

  const novaConfig = [];
  rows.forEach(row => {
    const inicio = row.querySelector('.hora-inicio')?.value;
    const fim    = row.querySelector('.hora-fim')?.value;
    if (inicio && fim) {
      novaConfig.push({ dia_semana: dia, hora_inicio: inicio, hora_fim: fim, ativo, terapeuta: _terapeutaAgenda });
    }
  });

  const erroValidacao = _validarFaixas(novaConfig);
  if (erroValidacao) {
    alert(erroValidacao);
    btn.disabled = false;
    btn.textContent = orig;
    return;
  }

  // Apaga registros do dia/terapeuta e reinsere.
  // Não é atômico: a validação acima reduz drasticamente a chance do INSERT falhar
  // depois de um DELETE bem-sucedido.
  const { error: delErr } = await supabase
    .from('horarios_disponiveis')
    .delete()
    .eq('dia_semana', dia)
    .eq('terapeuta', _terapeutaAgenda);

  if (delErr) {
    alert('Erro ao salvar: ' + delErr.message);
    btn.disabled = false;
    btn.textContent = orig;
    return;
  }

  if (novaConfig.length) {
    const { error: insErr } = await supabase
      .from('horarios_disponiveis')
      .insert(novaConfig);

    if (insErr) {
      alert('Erro ao salvar: ' + insErr.message);
      btn.disabled = false;
      btn.textContent = orig;
      return;
    }
  }

  fecharModalDia();
  await carregarAgenda();
  btn.disabled = false;
  btn.textContent = orig;
}
