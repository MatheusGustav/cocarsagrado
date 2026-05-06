/* ============================================================
   COCAR SAGRADO — Admin: Sistema de Vagas Flexível
   ============================================================ */

const DIAS_SEMANA_VAGAS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const PROFISSIONAIS_VAGAS     = ['camila', 'matheus'];
const PROFISSIONAL_NOME_VAGAS = { camila: 'Camila', matheus: 'Matheus' };

let _padraoCache  = {};
let _dataOverride = null;

// ============================================================
// Navegação de abas
// ============================================================
function mudarAbaVagas(aba) {
  document.querySelectorAll('.vagas-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('vagas-tab-' + aba)?.classList.add('active');
  document.getElementById('vagas-painel-padrao').style.display   = aba === 'padrao'   ? '' : 'none';
  document.getElementById('vagas-painel-override').style.display = aba === 'override' ? '' : 'none';
  if (aba === 'padrao') carregarPadraoSemanal();
}

// ============================================================
// Padrão Semanal
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
    container.innerHTML = '<div class="ag-empty">Erro ao carregar padrão.</div>';
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

  for (let dia = 0; dia < 7; dia++) {
    const secao = document.createElement('div');
    secao.className = 'vagas-dia-secao';

    const titulo = document.createElement('h3');
    titulo.className = 'vagas-dia-titulo';
    titulo.textContent = DIAS_SEMANA_VAGAS[dia];
    secao.appendChild(titulo);

    const grid = document.createElement('div');
    grid.className = 'vagas-cards-grid';

    PROFISSIONAIS_VAGAS.forEach(prof => {
      const key   = `${prof}_${dia}`;
      const rec   = _padraoCache[key];
      const ativo  = rec ? rec.ativo  : false;
      const vagas  = rec ? rec.vagas_total : 0;
      const ate    = rec ? (rec.ate_horario?.slice(0,5) || '18:00') : '18:00';

      const card = document.createElement('div');
      card.className = 'vagas-config-card';
      card.innerHTML = `
        <div class="vagas-prof-header">
          <span class="vagas-prof-nome">${PROFISSIONAL_NOME_VAGAS[prof]}</span>
          <label class="vagas-toggle-wrap" aria-label="Ativar ${PROFISSIONAL_NOME_VAGAS[prof]}">
            <input type="checkbox" class="vagas-chk" data-prof="${prof}" data-dia="${dia}" ${ativo ? 'checked' : ''}>
            <span class="vagas-toggle-track"><span class="vagas-toggle-thumb"></span></span>
            <span class="vagas-toggle-txt">${ativo ? 'Ativo' : 'Folga'}</span>
          </label>
        </div>
        <div class="vagas-fields ${ativo ? '' : 'vagas-fields--off'}">
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
        </div>`;

      const chk    = card.querySelector('.vagas-chk');
      const fields = card.querySelector('.vagas-fields');
      const txt    = card.querySelector('.vagas-toggle-txt');
      chk.addEventListener('change', () => {
        fields.classList.toggle('vagas-fields--off', !chk.checked);
        txt.textContent = chk.checked ? 'Ativo' : 'Folga';
      });

      grid.appendChild(card);
    });

    secao.appendChild(grid);
    container.appendChild(secao);
  }
}

async function salvarPadraoSemanal() {
  const btn = document.getElementById('vagas-btn-salvar-padrao');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  const registros = [];
  for (let dia = 0; dia < 7; dia++) {
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
  }

  const { error } = await supabase
    .from('disponibilidade_padrao')
    .upsert(registros, { onConflict: 'profissional,dia_semana' });

  if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Padrão Semanal'; }

  if (error) { _toastVagas('❌ Erro ao salvar: ' + error.message); return; }
  await carregarPadraoSemanal();
  _toastVagas('✅ Padrão semanal salvo!');
}

// ============================================================
// Override por Dia
// ============================================================
async function carregarOverrideData() {
  const inp      = document.getElementById('override-data');
  _dataOverride  = inp?.value;
  if (!_dataOverride) return;

  const container = document.getElementById('vagas-override-container');
  const footer    = document.getElementById('vagas-override-footer');
  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const diaSemana = new Date(_dataOverride + 'T00:00:00').getDay();

  const [{ data: padroes }, { data: overrides }] = await Promise.all([
    supabase.from('disponibilidade_padrao').select('*').in('profissional', PROFISSIONAIS_VAGAS).eq('dia_semana', diaSemana),
    supabase.from('disponibilidade_override').select('*').in('profissional', PROFISSIONAIS_VAGAS).eq('data', _dataOverride),
  ]);

  const padraoMap   = {};
  (padroes  || []).forEach(p => { padraoMap[p.profissional]   = p; });
  const overrideMap = {};
  (overrides || []).forEach(o => { overrideMap[o.profissional] = o; });

  const d = new Date(_dataOverride + 'T00:00:00');
  const MESES_OVERRIDE = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

  container.innerHTML = '';

  const tit = document.createElement('h3');
  tit.className = 'vagas-override-titulo';
  tit.textContent = `${DIAS_SEMANA_VAGAS[d.getDay()]}, ${d.getDate()} de ${MESES_OVERRIDE[d.getMonth()]} de ${d.getFullYear()}`;
  container.appendChild(tit);

  PROFISSIONAIS_VAGAS.forEach(prof => {
    const padrao    = padraoMap[prof];
    const override  = overrideMap[prof];
    const temOv     = !!override;

    const padraoDesc = padrao && padrao.ativo && padrao.vagas_total > 0
      ? `${padrao.vagas_total} vagas até ${padrao.ate_horario?.slice(0,5)}`
      : 'Folga (padrão)';

    const card = document.createElement('div');
    card.className = 'vagas-override-card' + (temOv ? ' vagas-override-card--ativo' : '');
    card.innerHTML = `
      <div class="vagas-prof-header">
        <span class="vagas-prof-nome">${PROFISSIONAL_NOME_VAGAS[prof]}</span>
        ${temOv ? '<span class="vagas-ov-badge">⚠ Override ativo</span>' : ''}
      </div>
      <div class="vagas-radio-grupo">
        <label class="vagas-radio-label">
          <input type="radio" name="ov_${prof}" value="padrao" ${!temOv ? 'checked' : ''}>
          <span>Usar padrão <em>(${padraoDesc})</em></span>
        </label>
        <label class="vagas-radio-label">
          <input type="radio" name="ov_${prof}" value="custom" ${temOv ? 'checked' : ''}>
          <span>Customizar para este dia</span>
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
            ${_opcoesHorario(temOv ? override.ate_horario?.slice(0,5) : (padrao?.ate_horario?.slice(0,5) || '18:00'))}
          </select>
        </div>
        <div class="vagas-field-grp vagas-field-grp--toggle">
          <label class="vagas-toggle-wrap" aria-label="Ativo">
            <input type="checkbox" class="vagas-chk vagas-ov-ativo" data-prof="${prof}" ${temOv ? (override.ativo ? 'checked' : '') : 'checked'}>
            <span class="vagas-toggle-track"><span class="vagas-toggle-thumb"></span></span>
            <span class="vagas-toggle-txt">Ativo</span>
          </label>
        </div>
        <p class="vagas-ov-aviso">⚠ Sobrescreve o padrão semanal</p>
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

async function salvarOverride() {
  if (!_dataOverride) return;
  const btn = document.getElementById('vagas-btn-salvar-ov');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  const inserir  = [];
  const deletar  = [];

  for (const prof of PROFISSIONAIS_VAGAS) {
    const radioCustom = document.querySelector(`input[name="ov_${prof}"][value="custom"]`);
    if (radioCustom?.checked) {
      const vagas  = parseInt(document.querySelector(`.vagas-ov-qty[data-prof="${prof}"]`)?.value  || '0');
      const horario = document.querySelector(`.vagas-ov-hora[data-prof="${prof}"]`)?.value || '18:00';
      const ativo   = document.querySelector(`.vagas-ov-ativo[data-prof="${prof}"]`)?.checked ?? true;
      inserir.push({
        profissional:    prof,
        data:            _dataOverride,
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
    await supabase.from('disponibilidade_override').delete().eq('profissional', prof).eq('data', _dataOverride);
  }

  if (inserir.length) {
    const { error } = await supabase
      .from('disponibilidade_override')
      .upsert(inserir, { onConflict: 'profissional,data' });
    if (error) {
      _toastVagas('❌ Erro ao salvar override: ' + error.message);
      if (btn) { btn.disabled = false; btn.textContent = '💾 Aplicar Override'; }
      return;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = '💾 Aplicar Override'; }
  await carregarOverrideData();
  _toastVagas('✅ Override aplicado!');
}

async function limparOverride() {
  if (!_dataOverride) return;
  if (!confirm('Remover todos os overrides desta data? A disponibilidade voltará ao padrão semanal.')) return;
  const { error } = await supabase
    .from('disponibilidade_override')
    .delete()
    .in('profissional', PROFISSIONAIS_VAGAS)
    .eq('data', _dataOverride);
  if (error) { _toastVagas('❌ Erro: ' + error.message); return; }
  await carregarOverrideData();
  _toastVagas('✅ Override removido — usando padrão semanal.');
}

// ============================================================
// Helpers
// ============================================================
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
      const v = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
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
  const inp = document.getElementById('override-data');
  if (inp && !inp.value) {
    const h = new Date();
    inp.value = `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;
  }
  carregarPadraoSemanal();
}
