/* ============================================================
   COCAR SAGRADO — Admin: Sistema de Vagas (por data específica)
   ============================================================ */

const DIAS_SEMANA_VAGAS_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MESES_VAGAS_ABREV      = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const PROFISSIONAIS_VAGAS     = ['camila', 'matheus'];
const PROFISSIONAL_NOME_VAGAS = { camila: 'Camila', matheus: 'Matheus' };
const DIAS_A_FRENTE           = 14;

let _overrideCache = {};

function _dataParaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _proximasDatas() {
  const datas = [];
  const hoje  = new Date();
  hoje.setHours(0, 0, 0, 0);
  for (let i = 1; i <= DIAS_A_FRENTE; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    datas.push(d);
  }
  return datas;
}

// ============================================================
// Carregamento
// ============================================================
async function carregarPadraoSemanal() {
  const container = document.getElementById('vagas-padrao-container');
  if (!container) return;
  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const datas    = _proximasDatas();
  const dataIni  = _dataParaISO(datas[0]);
  const dataFim  = _dataParaISO(datas[datas.length - 1]);

  const { data, error } = await supabase
    .from('disponibilidade_override')
    .select('*')
    .in('profissional', PROFISSIONAIS_VAGAS)
    .gte('data', dataIni)
    .lte('data', dataFim);

  if (error) {
    container.innerHTML = '<div class="ag-empty">Erro ao carregar configuração.</div>';
    return;
  }

  _overrideCache = {};
  (data || []).forEach(r => { _overrideCache[`${r.profissional}_${r.data}`] = r; });
  renderizarPadraoSemanal();
}

// ============================================================
// Renderização
// ============================================================
function renderizarPadraoSemanal() {
  const container = document.getElementById('vagas-padrao-container');
  if (!container) return;
  container.innerHTML = '';

  const datas = _proximasDatas();
  const grid  = document.createElement('div');
  grid.className = 'vps-semana-grid';

  for (const d of datas) {
    const str            = _dataParaISO(d);
    const ativosCamila   = _overrideCache[`camila_${str}`]?.ativo  ?? false;
    const ativosMatheus  = _overrideCache[`matheus_${str}`]?.ativo ?? false;
    const totalAtivos    = [ativosCamila, ativosMatheus].filter(Boolean).length;

    let chipTxt = 'Folga';
    let chipCls = 'vps-chip--folga';
    if (totalAtivos === 2) { chipTxt = '2 ativas'; chipCls = 'vps-chip--ok'; }
    else if (totalAtivos === 1) { chipTxt = '1 ativa'; chipCls = 'vps-chip--parcial'; }

    const diaNome = DIAS_SEMANA_VAGAS_FULL[d.getDay()];
    const diaNum  = d.getDate();
    const mesAbr  = MESES_VAGAS_ABREV[d.getMonth()];

    const card = document.createElement('div');
    card.className = 'vps-dia-card';
    card.innerHTML = `
      <div class="vps-dia-header">
        <span class="vps-dia-nome">${diaNome} <span style="font-weight:400;font-size:.8em;opacity:.7">${diaNum} ${mesAbr}</span></span>
        <span class="vps-chip ${chipCls}" data-chip-data="${str}">${chipTxt}</span>
      </div>
      <div class="vps-dia-body">
        ${PROFISSIONAIS_VAGAS.map((prof, i) => {
          const rec   = _overrideCache[`${prof}_${str}`];
          const ativo = rec?.ativo  ?? false;
          const vagas = rec?.vagas_total ?? 0;
          const ate   = rec?.ate_horario?.slice(0, 5) ?? '18:00';
          return `
            ${i > 0 ? '<div class="vps-prof-divider"></div>' : ''}
            <div class="vps-prof-row">
              <div class="vps-prof-top">
                <span class="vps-prof-nome">${PROFISSIONAL_NOME_VAGAS[prof]}</span>
                <label class="vagas-toggle-wrap" aria-label="Ativar ${PROFISSIONAL_NOME_VAGAS[prof]}">
                  <input type="checkbox" class="vagas-chk" data-prof="${prof}" data-data="${str}" ${ativo ? 'checked' : ''}>
                  <span class="vagas-toggle-track"><span class="vagas-toggle-thumb"></span></span>
                  <span class="vagas-toggle-txt">${ativo ? 'Ativo' : 'Folga'}</span>
                </label>
              </div>
              <div class="vps-prof-fields ${ativo ? '' : 'vps-prof-fields--off'}">
                <div class="vagas-field-grp">
                  <label>Vagas</label>
                  <select class="vagas-sel vagas-sel-qty" data-prof="${prof}" data-data="${str}">
                    ${_opcoesVagas(vagas)}
                  </select>
                </div>
                <div class="vagas-field-grp">
                  <label>Até</label>
                  <select class="vagas-sel vagas-sel-hora" data-prof="${prof}" data-data="${str}">
                    ${_opcoesHorario(ate)}
                  </select>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="vps-dia-footer">
        <button class="ag-btn ag-btn-primary ag-btn-sm vps-btn-salvar" data-data="${str}">💾 Salvar</button>
      </div>`;

    PROFISSIONAIS_VAGAS.forEach(prof => {
      const chk = card.querySelector(`.vagas-chk[data-prof="${prof}"]`);
      chk.addEventListener('change', () => {
        const row  = chk.closest('.vps-prof-row');
        const flds = row.querySelector('.vps-prof-fields');
        const txt  = chk.closest('.vagas-toggle-wrap').querySelector('.vagas-toggle-txt');
        flds.classList.toggle('vps-prof-fields--off', !chk.checked);
        txt.textContent = chk.checked ? 'Ativo' : 'Folga';
        _atualizarChipData(str, card);
      });
    });

    card.querySelector('.vps-btn-salvar').addEventListener('click', function() {
      salvarDiaData(str, this);
    });

    grid.appendChild(card);
  }

  container.appendChild(grid);
}

function _atualizarChipData(str, card) {
  const chks   = card.querySelectorAll('.vagas-chk');
  const ativos  = Array.from(chks).filter(c => c.checked).length;
  const chip    = card.querySelector(`[data-chip-data="${str}"]`);
  if (!chip) return;
  chip.className = 'vps-chip';
  if (ativos === 2)      { chip.textContent = '2 ativas'; chip.classList.add('vps-chip--ok'); }
  else if (ativos === 1) { chip.textContent = '1 ativa';  chip.classList.add('vps-chip--parcial'); }
  else                   { chip.textContent = 'Folga';    chip.classList.add('vps-chip--folga'); }
}

// ============================================================
// Salvar (override por data específica)
// ============================================================
async function salvarDiaData(str, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  const registros = [];
  for (const prof of PROFISSIONAIS_VAGAS) {
    const chk    = document.querySelector(`.vagas-chk[data-prof="${prof}"][data-data="${str}"]`);
    const selQty = document.querySelector(`.vagas-sel-qty[data-prof="${prof}"][data-data="${str}"]`);
    const selHor = document.querySelector(`.vagas-sel-hora[data-prof="${prof}"][data-data="${str}"]`);
    if (!chk) continue;
    registros.push({
      profissional: prof,
      data:         str,
      vagas_total:  parseInt(selQty?.value || '0'),
      ate_horario:  selHor?.value || '18:00',
      ativo:        chk.checked,
      updated_at:   new Date().toISOString(),
    });
  }

  const { error } = await supabase
    .from('disponibilidade_override')
    .upsert(registros, { onConflict: 'profissional,data' });

  if (btn) {
    btn.disabled = false;
    if (error) {
      btn.textContent = '✗ Erro';
      setTimeout(() => { btn.textContent = '💾 Salvar'; }, 2000);
    } else {
      btn.textContent = '✓ Salvo';
      setTimeout(() => { btn.textContent = '💾 Salvar'; }, 2000);
    }
  }

  if (error) { _toastVagas('❌ Erro ao salvar: ' + error.message); return; }

  registros.forEach(r => { _overrideCache[`${r.profissional}_${r.data}`] = r; });
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
