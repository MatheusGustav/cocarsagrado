/* ============================================================
   COCAR SAGRADO — Admin: Sistema de Vagas (por data específica)
   ============================================================ */

const DIAS_SEMANA_VAGAS_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MESES_VAGAS_ABREV      = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DIAS_A_FRENTE          = 6;

// Lista central de terapeutas vem do admin-system.js (config 'terapeutas').
function _profsVagas() {
  return (typeof listaTerapeutas === 'function')
    ? listaTerapeutas().map(t => t.id)
    : ['camila', 'matheus'];
}
function _profNomeVagas(id) {
  return (typeof terapeutaNome === 'function') ? terapeutaNome(id) : id;
}

let _overrideCache = {};
let _ocupadasCache = {};

function _dataParaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _proximasDatas() {
  const datas = [];
  const hoje  = new Date();
  hoje.setHours(0, 0, 0, 0);
  for (let i = 0; i <= DIAS_A_FRENTE; i++) {
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

  const profs    = _profsVagas();
  const datas    = _proximasDatas();
  const dataIni  = _dataParaISO(datas[0]);
  const dataFim  = _dataParaISO(datas[datas.length - 1]);

  const [overridesResp, ...contagensResps] = await Promise.all([
    supabase
      .from('disponibilidade_override')
      .select('*')
      .in('profissional', profs)
      .gte('data', dataIni)
      .lte('data', dataFim),
    ...profs.map(prof =>
      supabase.rpc('contar_agendamentos_por_data', {
        p_terapeuta: prof,
        p_inicio:    dataIni,
        p_fim:       dataFim,
      })
    ),
  ]);

  if (overridesResp.error) {
    container.innerHTML = '<div class="ag-empty">Erro ao carregar configuração.</div>';
    return;
  }

  _overrideCache = {};
  (overridesResp.data || []).forEach(r => { _overrideCache[`${r.profissional}_${r.data}`] = r; });

  _ocupadasCache = {};
  profs.forEach((prof, i) => {
    (contagensResps[i]?.data || []).forEach(c => {
      _ocupadasCache[`${prof}_${c.data_agendamento}`] = Number(c.total) || 0;
    });
  });

  renderizarPadraoSemanal();
}

// ============================================================
// Renderização
// ============================================================
function renderizarPadraoSemanal() {
  const container = document.getElementById('vagas-padrao-container');
  if (!container) return;
  container.innerHTML = '';

  const profs = _profsVagas();
  const datas = _proximasDatas();
  const grid  = document.createElement('div');
  grid.className = 'vps-semana-grid';

  const hojeStr = _dataParaISO(new Date());

  for (const d of datas) {
    const str         = _dataParaISO(d);
    const ehHoje      = str === hojeStr;
    const totalAtivos = profs.filter(p => _overrideCache[`${p}_${str}`]?.ativo).length;

    let chipTxt = 'Folga';
    let chipCls = 'vps-chip--folga';
    if (totalAtivos === profs.length && totalAtivos > 0) { chipTxt = `${totalAtivos} ativas`; chipCls = 'vps-chip--ok'; }
    else if (totalAtivos > 0) { chipTxt = `${totalAtivos} ativa${totalAtivos > 1 ? 's' : ''}`; chipCls = 'vps-chip--parcial'; }

    const diaNome = DIAS_SEMANA_VAGAS_FULL[d.getDay()];
    const diaNum  = d.getDate();
    const mesAbr  = MESES_VAGAS_ABREV[d.getMonth()];

    const card = document.createElement('div');
    card.className = 'vps-dia-card' + (ehHoje ? ' vps-dia-card--hoje' : '');
    card.innerHTML = `
      <div class="vps-dia-header">
        <span class="vps-dia-nome">${ehHoje ? '<span class="vps-badge-hoje">HOJE</span> ' : ''}${diaNome} <span style="font-weight:400;font-size:.8em;opacity:.7">${diaNum} ${mesAbr}</span></span>
        <span class="vps-chip ${chipCls}" data-chip-data="${str}">${chipTxt}</span>
      </div>
      <div class="vps-dia-body">
        ${profs.map((prof, i) => {
          const rec      = _overrideCache[`${prof}_${str}`];
          const ativo    = rec?.ativo  ?? false;
          const vagas    = rec?.vagas_total ?? 0;
          const ate      = rec?.ate_horario?.slice(0, 5) ?? '18:00';
          const ocupadas = _ocupadasCache[`${prof}_${str}`] ?? 0;
          const livres   = Math.max(0, vagas - ocupadas);
          const ocupCls  = !ativo ? '' : (livres === 0 && vagas > 0 ? 'vagas-ocup--cheio' : (ocupadas > 0 ? 'vagas-ocup--parcial' : ''));
          return `
            ${i > 0 ? '<div class="vps-prof-divider"></div>' : ''}
            <div class="vps-prof-row">
              <div class="vps-prof-top">
                <span class="vps-prof-nome">${_profNomeVagas(prof)}</span>
                <label class="vagas-toggle-wrap" aria-label="Ativar ${_profNomeVagas(prof)}">
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
              <div class="vagas-ocup-info vagas-ocup-info--link ${ocupCls}" data-prof="${prof}" data-data="${str}"
                   onclick="verAgendamentosDoDia('${str}', '${prof}')" title="Ver agendamentos deste dia" ${ativo ? '' : 'style="display:none"'}>
                <span class="vagas-ocup-num"><strong>${ocupadas}</strong> ocupadas</span>
                <span class="vagas-ocup-sep">·</span>
                <span class="vagas-ocup-num"><strong>${livres}</strong> livres</span>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="vps-dia-footer">
        <button class="ag-btn ag-btn-primary ag-btn-sm vps-btn-salvar" data-data="${str}">💾 Salvar</button>
      </div>`;

    profs.forEach(prof => {
      const chk = card.querySelector(`.vagas-chk[data-prof="${prof}"]`);
      const ocupInfo = card.querySelector(`.vagas-ocup-info[data-prof="${prof}"]`);
      const selQty   = card.querySelector(`.vagas-sel-qty[data-prof="${prof}"]`);

      chk.addEventListener('change', () => {
        const row  = chk.closest('.vps-prof-row');
        const flds = row.querySelector('.vps-prof-fields');
        const txt  = chk.closest('.vagas-toggle-wrap').querySelector('.vagas-toggle-txt');
        flds.classList.toggle('vps-prof-fields--off', !chk.checked);
        txt.textContent = chk.checked ? 'Ativo' : 'Folga';
        if (ocupInfo) ocupInfo.style.display = chk.checked ? '' : 'none';
        _atualizarChipData(str, card);
      });

      // Atualiza badge ocupadas/livres ao mudar o total no select
      selQty?.addEventListener('change', () => _refreshOcupInfo(ocupInfo, selQty, prof, str));
    });

    card.querySelector('.vps-btn-salvar').addEventListener('click', function() {
      salvarDiaData(str, this);
    });

    grid.appendChild(card);
  }

  container.appendChild(grid);
}

function _refreshOcupInfo(ocupInfo, selQty, prof, str) {
  if (!ocupInfo) return;
  const total    = parseInt(selQty?.value || '0', 10);
  const ocupadas = _ocupadasCache[`${prof}_${str}`] ?? 0;
  const livres   = Math.max(0, total - ocupadas);
  const nums = ocupInfo.querySelectorAll('.vagas-ocup-num strong');
  if (nums[0]) nums[0].textContent = ocupadas;
  if (nums[1]) nums[1].textContent = livres;
  ocupInfo.classList.toggle('vagas-ocup--cheio',   livres === 0 && total > 0);
  ocupInfo.classList.toggle('vagas-ocup--parcial', livres > 0 && ocupadas > 0);
}

function _atualizarChipData(str, card) {
  const chks   = card.querySelectorAll('.vagas-chk');
  const total  = chks.length;
  const ativos = Array.from(chks).filter(c => c.checked).length;
  const chip   = card.querySelector(`[data-chip-data="${str}"]`);
  if (!chip) return;
  chip.className = 'vps-chip';
  if (ativos === total && ativos > 0) { chip.textContent = `${ativos} ativas`; chip.classList.add('vps-chip--ok'); }
  else if (ativos > 0) { chip.textContent = `${ativos} ativa${ativos > 1 ? 's' : ''}`; chip.classList.add('vps-chip--parcial'); }
  else                 { chip.textContent = 'Folga';    chip.classList.add('vps-chip--folga'); }
}

// Atalho Vagas -> Agendamentos: abre a lista já filtrada pelo dia/terapeuta.
function verAgendamentosDoDia(dataIso, prof) {
  const fData = document.getElementById('filtro-data');
  const fTer  = document.getElementById('filtro-terapeuta');
  if (fData) fData.value = dataIso;
  if (fTer)  fTer.value  = prof || '';
  if (typeof filtrarPorPill === 'function') filtrarPorPill('');
  if (typeof mostrarSecao === 'function') mostrarSecao('agendamentos');
}

// ============================================================
// Salvar (override por data específica)
// ============================================================
async function salvarDiaData(str, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  const registros = [];
  for (const prof of _profsVagas()) {
    const chk    = document.querySelector(`.vagas-chk[data-prof="${prof}"][data-data="${str}"]`);
    const selQty = document.querySelector(`.vagas-sel-qty[data-prof="${prof}"][data-data="${str}"]`);
    const selHor = document.querySelector(`.vagas-sel-hora[data-prof="${prof}"][data-data="${str}"]`);
    if (!chk) continue;
    const qty = parseInt(selQty?.value || '0');
    registros.push({
      profissional:    prof,
      data:            str,
      vagas_total:     qty,
      // Recalcula restantes pelas ocupadas reais: aumentar o total reabre vagas
      vagas_restantes: Math.max(0, qty - (_ocupadasCache[`${prof}_${str}`] ?? 0)),
      ate_horario:     selHor?.value || '18:00',
      ativo:           chk.checked,
      updated_at:      new Date().toISOString(),
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
