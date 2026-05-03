/* ============================================================
   COCAR SAGRADO — Controle de Agenda (Admin)
   ============================================================ */

const DIAS_SEMANA_AGENDA = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

async function carregarAgenda() {
  const grade = document.getElementById('grade-agenda');
  if (!grade) return;
  grade.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const { data, error } = await supabase
    .from('horarios_disponiveis')
    .select('*')
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
    const faixas = registros.filter(r => r.dia_semana === dia);
    const diaAtivo = faixas.some(r => r.ativo);

    const card = document.createElement('div');
    card.className = 'agenda-dia-card' + (diaAtivo ? ' agenda-dia-ativo' : '');
    card.dataset.dia = dia;

    card.innerHTML = `
      <div class="agenda-dia-header">
        <span class="agenda-dia-nome">${DIAS_SEMANA_AGENDA[dia]}</span>
        <label class="agenda-toggle">
          <input type="checkbox" class="dia-toggle" data-dia="${dia}" ${diaAtivo ? 'checked' : ''}>
          <span class="agenda-toggle-track"><span class="agenda-toggle-thumb"></span></span>
          <span class="agenda-toggle-text">${diaAtivo ? 'Ativo' : 'Inativo'}</span>
        </label>
      </div>
      <div class="agenda-faixas" id="faixas-dia-${dia}"></div>
      <button class="agenda-btn-add" onclick="adicionarFaixa(${dia})">+ faixa de horário</button>
    `;

    const faixasEl = card.querySelector(`#faixas-dia-${dia}`);
    if (faixas.length) {
      faixas.forEach(f => faixasEl.appendChild(criarLinhaFaixa(f.hora_inicio.slice(0,5), f.hora_fim.slice(0,5), f.ativo)));
    } else {
      faixasEl.innerHTML = '<p class="agenda-vazio">Sem faixas configuradas</p>';
    }

    grade.appendChild(card);
  }

  document.querySelectorAll('.dia-toggle').forEach(chk => {
    chk.addEventListener('change', () => {
      const dia = parseInt(chk.dataset.dia);
      const card = chk.closest('.agenda-dia-card');
      const label = card.querySelector('.agenda-toggle-text');
      label.textContent = chk.checked ? 'Ativo' : 'Inativo';
      card.classList.toggle('agenda-dia-ativo', chk.checked);
      card.querySelectorAll('.faixa-ativo').forEach(c => { c.checked = chk.checked; });
    });
  });
}

function criarLinhaFaixa(inicio, fim, ativo) {
  const div = document.createElement('div');
  div.className = 'agenda-faixa-row';
  div.innerHTML = `
    <input type="time" class="agenda-time hora-inicio" value="${inicio}">
    <span class="agenda-sep">até</span>
    <input type="time" class="agenda-time hora-fim" value="${fim}">
    <label class="agenda-faixa-ativo">
      <input type="checkbox" class="faixa-ativo" ${ativo ? 'checked' : ''}> ativo
    </label>
    <button class="agenda-btn-remover" onclick="removerFaixa(this)" title="Remover">✕</button>
  `;
  return div;
}

function adicionarFaixa(dia) {
  const faixasEl = document.getElementById(`faixas-dia-${dia}`);
  const vazio = faixasEl.querySelector('.agenda-vazio');
  if (vazio) vazio.remove();
  const diaAtivo = document.querySelector(`.dia-toggle[data-dia="${dia}"]`)?.checked || false;
  faixasEl.appendChild(criarLinhaFaixa('08:00', '18:00', diaAtivo));
}

function removerFaixa(btn) {
  const row = btn.closest('.agenda-faixa-row');
  const faixasEl = row.parentElement;
  row.remove();
  if (!faixasEl.querySelector('.agenda-faixa-row')) {
    faixasEl.innerHTML = '<p class="agenda-vazio">Sem faixas configuradas</p>';
  }
}

async function salvarAgenda() {
  const btn = document.getElementById('btn-salvar-agenda');
  if (btn) { btn.disabled = true; btn.textContent = '💾 Salvando...'; }

  const novaConfig = [];
  for (let dia = 0; dia < 7; dia++) {
    const rows = document.querySelectorAll(`#faixas-dia-${dia} .agenda-faixa-row`);
    rows.forEach(row => {
      const inicio = row.querySelector('.hora-inicio')?.value;
      const fim    = row.querySelector('.hora-fim')?.value;
      const ativo  = row.querySelector('.faixa-ativo')?.checked ?? true;
      if (inicio && fim && inicio !== fim) {
        novaConfig.push({ dia_semana: dia, hora_inicio: inicio, hora_fim: fim, ativo });
      }
    });
  }

  // Apaga todos e reinserere
  const { data: todos } = await supabase.from('horarios_disponiveis').select('id');
  if (todos?.length) {
    const { error: delErr } = await supabase
      .from('horarios_disponiveis')
      .delete()
      .in('id', todos.map(r => r.id));
    if (delErr) {
      alert('Erro ao limpar agenda: ' + delErr.message);
      if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Alterações'; }
      return;
    }
  }

  if (novaConfig.length) {
    const { error: insErr } = await supabase.from('horarios_disponiveis').insert(novaConfig);
    if (insErr) {
      alert('Erro ao salvar horários: ' + insErr.message);
      if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Alterações'; }
      return;
    }
  }

  await carregarAgenda();
  if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Alterações'; }
}
