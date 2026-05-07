/* ============================================================
   COCAR SAGRADO — Admin: Sistema de Vagas
   ============================================================ */

const DIAS_SEMANA_VAGAS      = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DIAS_SEMANA_VAGAS_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MESES_VAGAS            = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MESES_VAGAS_ABREV      = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const PROFISSIONAIS_VAGAS     = ['camila', 'matheus'];
const PROFISSIONAL_NOME_VAGAS = { camila: 'Camila', matheus: 'Matheus' };

let _padraoCache = {};
let _dataAjuste  = null;
let _ajustesMap  = {};
let _calMes, _calAno;

// ============================================================
// Navegação de abas
// ============================================================
function mudarAbaVagas(aba) {
  document.querySelectorAll('.vagas-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('vagas-tab-' + aba)?.classList.add('active');
  document.getElementById('vagas-painel-padrao').style.display = aba === 'padrao' ? '' : 'none';
  document.getElementById('vagas-painel-ajuste').style.display = aba === 'ajuste' ? '' : 'none';
  if (aba === 'padrao') carregarPadraoSemanal();
  if (aba === 'ajuste') inicializarAjustePontual();
}

// ============================================================
// Configuração Padrão
// ============================================================
async function carregarPadraoSemanal() {
  const container = document.getElementById('vagas-padrao-container');
  if (!container) return;
  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const { data, error } = await supabase
    .from('disponibilidade_padrao')
    .select('*')
    .order('dia_semana');

  if (error) {
    container.innerHTML = '<div class="ag-empty">Erro ao carregar configuração.</div>';
    return;
  }

  _padraoCache = {};
  (data || []).forEach(r => { _padraoCache[`${r.profissional}_${r.dia_semana}`] = r; });
  renderizarPadraoSemanal();
}

function renderizarPadraoSemanal() {
  const container = document.getElementById('vagas-padrao-container');
  if (!container) return;
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'vps-semana-grid';

  for (let dia = 0; dia < 7; dia++) {
    const ativosCamila  = _padraoCache[`camila_${dia}`]?.ativo  ?? false;
    const ativosMatheus = _padraoCache[`matheus_${dia}`]?.ativo ?? false;
    const totalAtivos   = [ativosCamila, ativosMatheus].filter(Boolean).length;

    let chipTxt = 'Folga';
    let chipCls = 'vps-chip--folga';
    if (totalAtivos === 2) { chipTxt = '2 ativas'; chipCls = 'vps-chip--ok'; }
    else if (totalAtivos === 1) { chipTxt = '1 ativa'; chipCls = 'vps-chip--parcial'; }

    const card = document.createElement('div');
    card.className = 'vps-dia-card';
    card.innerHTML = `
      <div class="vps-dia-header">
        <span class="vps-dia-nome">${DIAS_SEMANA_VAGAS_FULL[dia]}</span>
        <span class="vps-chip ${chipCls}" data-chip-dia="${dia}">${chipTxt}</span>
      </div>
      <div class="vps-dia-body">
        ${PROFISSIONAIS_VAGAS.map((prof, i) => {
          const rec   = _padraoCache[`${prof}_${dia}`];
          const ativo = rec?.ativo ?? false;
          const vagas = rec?.vagas_total ?? 0;
          const ate   = rec?.ate_horario?.slice(0, 5) ?? '18:00';
          return `
            ${i > 0 ? '<div class="vps-prof-divider"></div>' : ''}
            <div class="vps-prof-row">
              <div class="vps-prof-top">
                <span class="vps-prof-nome">${PROFISSIONAL_NOME_VAGAS[prof]}</span>
                <label class="vagas-toggle-wrap" aria-label="Ativar ${PROFISSIONAL_NOME_VAGAS[prof]}">
                  <input type="checkbox" class="vagas-chk" data-prof="${prof}" data-dia="${dia}" ${ativo ? 'checked' : ''}>
                  <span class="vagas-toggle-track"><span class="vagas-toggle-thumb"></span></span>
                  <span class="vagas-toggle-txt">${ativo ? 'Ativo' : 'Folga'}</span>
                </label>
              </div>
              <div class="vps-prof-fields ${ativo ? '' : 'vps-prof-fields--off'}">
                <div class="vagas-field-grp">
                  <label>Vagas</label>
                  <select class="vagas-sel vagas-sel-qty" data-prof="${prof}" data-dia="${dia}">
                    ${_opcoesVagas(vagas)}
                  </select>
                </div>
                <div class="vagas-field-grp">
                  <label>Até</label>
                  <select class="vagas-sel vagas-sel-hora" data-prof="${prof}" data-dia="${dia}">
                    ${_opcoesHorario(ate)}
                  </select>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="vps-dia-footer">
        <button class="ag-btn ag-btn-primary ag-btn-sm vps-btn-salvar" data-dia="${dia}">💾 Salvar</button>
      </div>`;

    PROFISSIONAIS_VAGAS.forEach(prof => {
      const chk    = card.querySelector(`.vagas-chk[data-prof="${prof}"]`);
      const fields = card.querySelector(`.vps-prof-fields`);
      const allChks = card.querySelectorAll('.vagas-chk');

      chk.addEventListener('change', () => {
        const row    = chk.closest('.vps-prof-row');
        const flds   = row.querySelector('.vps-prof-fields');
        const txt    = chk.closest('.vagas-toggle-wrap').querySelector('.vagas-toggle-txt');
        flds.classList.toggle('vps-prof-fields--off', !chk.checked);
        txt.textContent = chk.checked ? 'Ativo' : 'Folga';
        _atualizarChipDia(dia, card);
      });
    });

    card.querySelector('.vps-btn-salvar').addEventListener('click', function() {
      salvarDiaPadrao(dia, this);
    });

    grid.appendChild(card);
  }

  container.appendChild(grid);
}

function _atualizarChipDia(dia, card) {
  const chks     = card.querySelectorAll('.vagas-chk');
  const ativos   = Array.from(chks).filter(c => c.checked).length;
  const chip     = card.querySelector(`[data-chip-dia="${dia}"]`);
  if (!chip) return;
  chip.className = 'vps-chip';
  if (ativos === 2)      { chip.textContent = '2 ativas'; chip.classList.add('vps-chip--ok'); }
  else if (ativos === 1) { chip.textContent = '1 ativa';  chip.classList.add('vps-chip--parcial'); }
  else                   { chip.textContent = 'Folga';    chip.classList.add('vps-chip--folga'); }
}

async function salvarDiaPadrao(dia, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  const registros = [];
  for (const prof of PROFISSIONAIS_VAGAS) {
    const chk    = document.querySelector(`.vagas-chk[data-prof="${prof}"][data-dia="${dia}"]`);
    const selQty = document.querySelector(`.vagas-sel-qty[data-prof="${prof}"][data-dia="${dia}"]`);
    const selHor = document.querySelector(`.vagas-sel-hora[data-prof="${prof}"][data-dia="${dia}"]`);
    if (!chk) continue;
    registros.push({
      profissional: prof,
      dia_semana:   dia,
      vagas_total:  parseInt(selQty?.value || '0'),
      ate_horario:  selHor?.value || '18:00',
      ativo:        chk.checked,
      updated_at:   new Date().toISOString(),
    });
  }

  const { error } = await supabase
    .from('disponibilidade_padrao')
    .upsert(registros, { onConflict: 'profissional,dia_semana' });

  if (btn) {
    btn.disabled = false;
    if (error) {
      btn.textContent = '✗ Erro';
      setTimeout(() => { btn.textContent = 'Salvar'; }, 2000);
    } else {
      btn.textContent = '✓ Salvo';
      setTimeout(() => { btn.textContent = 'Salvar'; }, 2000);
    }
  }

  if (error) { _toastVagas('❌ Erro ao salvar: ' + error.message); return; }

  registros.forEach(r => { _padraoCache[`${r.profissional}_${r.dia_semana}`] = r; });
}

// ============================================================
// Ajuste Pontual
// ============================================================
async function inicializarAjustePontual() {
  const hoje = _hojeStr();
  const d = new Date(hoje + 'T00:00:00');
  _calMes  = d.getMonth();
  _calAno  = d.getFullYear();
  _dataAjuste = hoje;

  await carregarTodosAjustes();
  renderizarMiniCalendario();
  renderizarListaExcecoes();
  await carregarAjusteData();
}

async function carregarTodosAjustes() {
  const { data } = await supabase
    .from('disponibilidade_override')
    .select('*')
    .gte('data', _hojeStr())
    .order('data');

  _ajustesMap = {};
  (data || []).forEach(r => {
    if (!_ajustesMap[r.data]) _ajustesMap[r.data] = [];
    _ajustesMap[r.data].push(r);
  });
}

function renderizarMiniCalendario() {
  const container = document.getElementById('vagas-mini-cal');
  if (!container) return;

  const primeiroDia = new Date(_calAno, _calMes, 1);
  const ultimoDia   = new Date(_calAno, _calMes + 1, 0);
  const hoje        = _hojeStr();

  let html = `
    <div class="vcal-nav">
      <button class="vcal-nav-btn" onclick="navegarCalendario(-1)">‹</button>
      <span class="vcal-mes-ano">${MESES_VAGAS[_calMes]} ${_calAno}</span>
      <button class="vcal-nav-btn" onclick="navegarCalendario(1)">›</button>
    </div>
    <div class="vcal-grid">
      ${DIAS_SEMANA_VAGAS.map(d => `<div class="vcal-head">${d}</div>`).join('')}
  `;

  for (let i = 0; i < primeiroDia.getDay(); i++) {
    html += `<div class="vcal-cell vcal-cell--vazio"></div>`;
  }

  for (let d = 1; d <= ultimoDia.getDate(); d++) {
    const dataStr   = `${_calAno}-${String(_calMes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isHoje    = dataStr === hoje;
    const isSel     = dataStr === _dataAjuste;
    const temAjuste = !!_ajustesMap[dataStr];
    const isPast    = dataStr < hoje;

    const classes = [
      'vcal-cell',
      isPast    ? 'vcal-cell--past'   : '',
      isHoje    ? 'vcal-cell--hoje'   : '',
      isSel     ? 'vcal-cell--sel'    : '',
      temAjuste ? 'vcal-cell--ajuste' : '',
    ].filter(Boolean).join(' ');

    html += `<div class="${classes}" ${!isPast ? `onclick="selecionarDiaAjuste('${dataStr}')"` : ''}>
      <span class="vcal-num">${d}</span>
      ${temAjuste ? '<span class="vcal-dot"></span>' : ''}
    </div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

function navegarCalendario(delta) {
  _calMes += delta;
  if (_calMes > 11) { _calMes = 0;  _calAno++; }
  if (_calMes < 0)  { _calMes = 11; _calAno--; }
  renderizarMiniCalendario();
}

async function selecionarDiaAjuste(dataStr) {
  _dataAjuste = dataStr;
  renderizarMiniCalendario();
  await carregarAjusteData();
}

function renderizarListaExcecoes() {
  const container = document.getElementById('vagas-lista-excecoes');
  if (!container) return;

  const datas = Object.keys(_ajustesMap).sort();
  if (!datas.length) {
    container.innerHTML = '<p class="vagas-excecoes-vazio">Nenhum ajuste futuro cadastrado.</p>';
    return;
  }

  let html = '<div class="vagas-excecoes-lista">';
  for (const data of datas) {
    const d = new Date(data + 'T00:00:00');
    const infos = _ajustesMap[data].map(o => {
      if (!o.ativo) return `<span class="vagas-exc-folga">${PROFISSIONAL_NOME_VAGAS[o.profissional]}: folga</span>`;
      return `<span class="vagas-exc-info">${PROFISSIONAL_NOME_VAGAS[o.profissional]}: ${o.vagas_total}v até ${o.ate_horario?.slice(0, 5)}</span>`;
    }).join('');

    html += `<div class="vagas-excecao-item" onclick="selecionarDiaAjuste('${data}')">
      <div class="vagas-exc-data">
        <span class="vagas-exc-dia">${d.getDate()}</span>
        <span class="vagas-exc-mes">${MESES_VAGAS_ABREV[d.getMonth()]}</span>
      </div>
      <div class="vagas-exc-detalhes">
        <span class="vagas-exc-diaSem">${DIAS_SEMANA_VAGAS_FULL[d.getDay()]}</span>
        <div class="vagas-exc-profs">${infos}</div>
      </div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

async function carregarAjusteData() {
  if (!_dataAjuste) return;

  const container = document.getElementById('vagas-ajuste-container');
  const footer    = document.getElementById('vagas-ajuste-footer');
  if (!container) return;
  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const diaSemana = new Date(_dataAjuste + 'T00:00:00').getDay();

  const [{ data: padroes }, { data: overrides }] = await Promise.all([
    supabase.from('disponibilidade_padrao').select('*').in('profissional', PROFISSIONAIS_VAGAS).eq('dia_semana', diaSemana),
    supabase.from('disponibilidade_override').select('*').in('profissional', PROFISSIONAIS_VAGAS).eq('data', _dataAjuste),
  ]);

  const padraoMap = {};
  (padroes || []).forEach(p => { padraoMap[p.profissional] = p; });
  const overrideMap = {};
  (overrides || []).forEach(o => { overrideMap[o.profissional] = o; });

  const d = new Date(_dataAjuste + 'T00:00:00');
  const MESES_FULL = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

  container.innerHTML = '';

  const tit = document.createElement('h3');
  tit.className = 'vagas-override-titulo';
  tit.textContent = `${DIAS_SEMANA_VAGAS_FULL[d.getDay()]}, ${d.getDate()} de ${MESES_FULL[d.getMonth()]} de ${d.getFullYear()}`;
  container.appendChild(tit);

  PROFISSIONAIS_VAGAS.forEach(prof => {
    const padrao   = padraoMap[prof];
    const override = overrideMap[prof];
    const temOv    = !!override;

    const padraoDesc = padrao && padrao.ativo && padrao.vagas_total > 0
      ? `${padrao.vagas_total} vagas até ${padrao.ate_horario?.slice(0, 5)}`
      : 'Folga (padrão)';

    const card = document.createElement('div');
    card.className = 'vagas-override-card' + (temOv ? ' vagas-override-card--ativo' : '');
    card.innerHTML = `
      <div class="vagas-prof-header">
        <span class="vagas-prof-nome">${PROFISSIONAL_NOME_VAGAS[prof]}</span>
        ${temOv ? '<span class="vagas-ov-badge">⚠ Ajuste ativo</span>' : ''}
      </div>
      <div class="vagas-radio-grupo">
        <label class="vagas-radio-label">
          <input type="radio" name="ov_${prof}" value="padrao" ${!temOv ? 'checked' : ''}>
          <span>Usar configuração padrão <em>(${padraoDesc})</em></span>
        </label>
        <label class="vagas-radio-label">
          <input type="radio" name="ov_${prof}" value="custom" ${temOv ? 'checked' : ''}>
          <span>Ajustar para este dia</span>
        </label>
      </div>
      <div class="vagas-override-fields ${!temOv ? 'vagas-override-fields--hidden' : ''}">
        <div class="vagas-field-grp">
          <label>Vagas</label>
          <select class="vagas-sel vagas-ov-qty" data-prof="${prof}">
            ${_opcoesVagas(temOv ? override.vagas_total : (padrao?.vagas_total || 0))}
          </select>
        </div>
        <div class="vagas-field-grp">
          <label>Até</label>
          <select class="vagas-sel vagas-ov-hora" data-prof="${prof}">
            ${_opcoesHorario(temOv ? override.ate_horario?.slice(0, 5) : (padrao?.ate_horario?.slice(0, 5) || '18:00'))}
          </select>
        </div>
        <div class="vagas-field-grp vagas-field-grp--toggle">
          <label class="vagas-toggle-wrap" aria-label="Ativo">
            <input type="checkbox" class="vagas-chk vagas-ov-ativo" data-prof="${prof}" ${temOv ? (override.ativo ? 'checked' : '') : 'checked'}>
            <span class="vagas-toggle-track"><span class="vagas-toggle-thumb"></span></span>
            <span class="vagas-toggle-txt">Ativo</span>
          </label>
        </div>
        <p class="vagas-ov-aviso">⚠ Sobrescreve a configuração padrão</p>
      </div>`;

    const radios = card.querySelectorAll(`input[name="ov_${prof}"]`);
    const fields = card.querySelector('.vagas-override-fields');
    radios.forEach(r => {
      r.addEventListener('change', () => {
        fields.classList.toggle('vagas-override-fields--hidden', r.value === 'padrao');
      });
    });

    container.appendChild(card);
  });

  if (footer) footer.style.display = 'flex';
}

async function salvarAjuste() {
  if (!_dataAjuste) return;
  const btn = document.getElementById('vagas-btn-salvar-ajuste');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  const inserir = [];
  const deletar = [];

  for (const prof of PROFISSIONAIS_VAGAS) {
    const radioCustom = document.querySelector(`input[name="ov_${prof}"][value="custom"]`);
    if (radioCustom?.checked) {
      const vagas   = parseInt(document.querySelector(`.vagas-ov-qty[data-prof="${prof}"]`)?.value || '0');
      const horario = document.querySelector(`.vagas-ov-hora[data-prof="${prof}"]`)?.value || '18:00';
      const ativo   = document.querySelector(`.vagas-ov-ativo[data-prof="${prof}"]`)?.checked ?? true;
      inserir.push({
        profissional:    prof,
        data:            _dataAjuste,
        vagas_total:     vagas,
        vagas_restantes: vagas,
        ate_horario:     horario,
        ativo,
        updated_at:      new Date().toISOString(),
      });
    } else {
      deletar.push(prof);
    }
  }

  for (const prof of deletar) {
    await supabase.from('disponibilidade_override').delete().eq('profissional', prof).eq('data', _dataAjuste);
  }

  if (inserir.length) {
    const { error } = await supabase
      .from('disponibilidade_override')
      .upsert(inserir, { onConflict: 'profissional,data' });
    if (error) {
      _toastVagas('❌ Erro ao salvar: ' + error.message);
      if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Ajuste'; }
      return;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Ajuste'; }

  await carregarTodosAjustes();
  renderizarMiniCalendario();
  renderizarListaExcecoes();
  await carregarAjusteData();
  _toastVagas('✅ Ajuste salvo!');
}

async function limparAjuste() {
  if (!_dataAjuste) return;
  if (!confirm('Remover o ajuste desta data? A configuração voltará ao padrão.')) return;

  const { error } = await supabase
    .from('disponibilidade_override')
    .delete()
    .in('profissional', PROFISSIONAIS_VAGAS)
    .eq('data', _dataAjuste);

  if (error) { _toastVagas('❌ Erro: ' + error.message); return; }

  await carregarTodosAjustes();
  renderizarMiniCalendario();
  renderizarListaExcecoes();
  await carregarAjusteData();
  _toastVagas('✅ Ajuste removido — usando configuração padrão.');
}

// ============================================================
// Helpers
// ============================================================
function _hojeStr() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

function _opcoesVagas(sel) {
  let html = '';
  for (let i = 0; i <= 20; i++) {
    html += `<option value="${i}"${i === sel ? ' selected' : ''}>${i}</option>`;
  }
  return html;
}

function _opcoesHorario(sel) {
  let html = '';
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      html += `<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`;
    }
  }
  return html;
}

function _toastVagas(msg) {
  const t = document.createElement('div');
  t.className = 'vagas-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('vagas-toast--show'), 10);
  setTimeout(() => {
    t.classList.remove('vagas-toast--show');
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

// ============================================================
// Init
// ============================================================
function inicializarVagas() {
  carregarPadraoSemanal();
}
