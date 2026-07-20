/* ============================================================
   COCAR SAGRADO — Admin: Agenda Especial
   ============================================================ */

const DIAS_ESP  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES_ESP = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let _profEspecial   = localStorage.getItem('especial_terapeuta') || 'matheus';
let _especialCache  = [];
let _servicosEspPorProf = null;   // cache: { terapeuta: [nomes] }, vindo do catálogo

function _profsEspecial() {
  return (typeof listaTerapeutas === 'function')
    ? listaTerapeutas()
    : [{ id: 'matheus', nome: 'Matheus' }, { id: 'camila', nome: 'Camila' }];
}

// ============================================================
// Seletor de profissional (botões gerados da lista central)
// ============================================================
function _renderBotoesProf() {
  const wrap = document.getElementById('esp-prof-btns');
  if (!wrap) return;
  const profs = _profsEspecial();
  if (!profs.find(t => t.id === _profEspecial)) _profEspecial = profs[0]?.id || 'matheus';
  wrap.innerHTML = '';
  profs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'ag-btn ag-btn-outline ag-btn-sm' + (t.id === _profEspecial ? ' active' : '');
    btn.textContent = t.nome;
    btn.dataset.prof = t.id;
    btn.addEventListener('click', () => trocarProfEspecial(t.id));
    wrap.appendChild(btn);
  });
}

function trocarProfEspecial(p) {
  _profEspecial = p;
  localStorage.setItem('especial_terapeuta', p);
  document.querySelectorAll('#esp-prof-btns [data-prof]').forEach(b => {
    b.classList.toggle('active', b.dataset.prof === p);
  });
  _atualizarServicosInfo();
  carregarEspecial();
}

// Serviços de agenda especial vêm do catálogo (tipos_leitura.especial),
// não de lista hardcoded — mudou o catálogo, muda aqui junto.
async function _atualizarServicosInfo() {
  const el = document.getElementById('esp-servicos-info');
  if (!el) return;
  if (!_servicosEspPorProf) {
    const { data, error } = await supabase
      .from('tipos_leitura')
      .select('nome, terapeuta')
      .eq('especial', true)
      .eq('ativo', true)
      .order('ordem');
    if (error) { el.textContent = '—'; return; }
    _servicosEspPorProf = {};
    (data || []).forEach(t => {
      if (!t.terapeuta) return;
      (_servicosEspPorProf[t.terapeuta] = _servicosEspPorProf[t.terapeuta] || []).push(t.nome);
    });
  }
  const servicos = _servicosEspPorProf[_profEspecial] || [];
  el.textContent = servicos.length ? servicos.join(' · ') : 'nenhum serviço especial ativo';
}

// ============================================================
// Carregar e renderizar
// ============================================================
async function carregarEspecial() {
  const lista = document.getElementById('esp-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = _espISO(hoje);

  const { data, error } = await supabase
    .from('disponibilidade_especial')
    .select('*')
    .eq('profissional', _profEspecial)
    .gte('data', dataInicio)
    .order('data');

  if (error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar.</div>';
    console.error(error);
    return;
  }

  _especialCache = data || [];
  _renderEspecial();
}

function _renderEspecial() {
  const lista = document.getElementById('esp-lista');
  if (!lista) return;
  lista.innerHTML = '';

  if (!_especialCache.length) {
    lista.innerHTML = '<div class="ag-empty" style="margin-top:16px">Nenhuma data configurada ainda.</div>';
    return;
  }

  _especialCache.forEach(rec => {
    const [eY, eM, eD] = rec.data.split('-').map(Number);
    const d    = new Date(eY, eM - 1, eD);
    const card = document.createElement('div');
    card.className = 'esp-card' + (rec.ativo ? '' : ' esp-card--off');
    const restantesLabel = rec.vagas_restantes !== undefined
      ? `<span class="esp-restantes">${rec.vagas_restantes} vaga${rec.vagas_restantes !== 1 ? 's' : ''} restante${rec.vagas_restantes !== 1 ? 's' : ''}</span>`
      : '';

    card.innerHTML = `
      <div class="esp-card-data">
        <span class="esp-card-dianum">${d.getDate()}</span>
        <div class="esp-card-diainfo">
          <span>${DIAS_ESP[d.getDay()]}</span>
          <span>${MESES_ESP[d.getMonth()]}</span>
        </div>
        ${restantesLabel ? `<div class="esp-restantes-wrap">${restantesLabel}</div>` : ''}
      </div>
      <div class="esp-card-campos">
        <label class="esp-campo-wrap">
          <span>Vagas</span>
          <select class="esp-sel esp-sel-vagas">${_opVagas(rec.vagas_total)}</select>
        </label>
        <label class="esp-campo-wrap">
          <span>Até</span>
          <select class="esp-sel esp-sel-hora">${_opHora(rec.ate_horario?.slice(0,5) || '18:00')}</select>
        </label>
        <label class="esp-toggle-wrap">
          <input type="checkbox" class="esp-chk-ativo" ${rec.ativo ? 'checked' : ''}>
          <span class="esp-toggle-track"><span class="esp-toggle-thumb"></span></span>
          <span class="esp-toggle-txt">${rec.ativo ? 'Ativo' : 'Inativo'}</span>
        </label>
      </div>
      <div class="esp-card-acoes">
        <button class="ag-btn ag-btn-primary ag-btn-sm esp-btn-salvar" title="Salvar"><svg class="ico" aria-hidden="true"><use href="#ico-guardar"></use></svg> Salvar</button>
        <button class="ag-btn ag-btn-outline ag-btn-sm esp-btn-del" style="color:var(--t-danger)" title="Remover" aria-label="Remover data"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg></button>
      </div>`;

    const chk = card.querySelector('.esp-chk-ativo');
    const txt = card.querySelector('.esp-toggle-txt');
    chk.addEventListener('change', () => {
      txt.textContent = chk.checked ? 'Ativo' : 'Inativo';
      card.classList.toggle('esp-card--off', !chk.checked);
    });

    card.querySelector('.esp-btn-salvar').addEventListener('click', () => _salvarEspecial(rec.data, card));
    card.querySelector('.esp-btn-del').addEventListener('click',    () => _deletarEspecial(rec.data, card));
    lista.appendChild(card);
  });
}

// ============================================================
// Adicionar nova data
// ============================================================
async function adicionarDataEspecial() {
  const inputData  = document.getElementById('esp-nova-data');
  const inputVagas = document.getElementById('esp-nova-vagas');
  const inputHora  = document.getElementById('esp-nova-hora');
  const btn        = document.getElementById('esp-btn-adicionar');

  const data  = inputData?.value;
  const vagas = parseInt(inputVagas?.value || '1');
  const hora  = inputHora?.value || '18:00';

  if (!data) { _toastEsp('Selecione uma data.'); return; }

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  if (new Date(data + 'T00:00:00') < hoje) { _toastEsp('Data no passado.'); return; }

  btn.disabled    = true;
  btn.textContent = 'Adicionando...';

  // Se a data já existe (re-adição), preserva o vagas_restantes
  // ajustado pelos agendamentos já feitos, limitado ao novo total.
  const { data: existente } = await supabase
    .from('disponibilidade_especial')
    .select('vagas_total, vagas_restantes')
    .eq('profissional', _profEspecial)
    .eq('data', data)
    .maybeSingle();

  let restantes = vagas;
  if (existente) {
    const ocupadas = Math.max(0, existente.vagas_total - existente.vagas_restantes);
    restantes = Math.max(0, vagas - ocupadas);
  }

  const { error } = await supabase
    .from('disponibilidade_especial')
    .upsert({
      profissional:    _profEspecial,
      data,
      vagas_total:     vagas,
      vagas_restantes: restantes,
      ate_horario:     hora,
      ativo:           true,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'profissional,data' });

  btn.disabled    = false;
  btn.textContent = '+ Adicionar';

  if (error) { _toastEsp(error.message, 'erro'); return; }

  inputData.value = '';
  await carregarEspecial();
  _toastEsp('Data adicionada!', 'ok');
}

// ============================================================
// Salvar / Deletar
// ============================================================
async function _salvarEspecial(data, card) {
  const btn   = card.querySelector('.esp-btn-salvar');
  const vagas = parseInt(card.querySelector('.esp-sel-vagas').value);
  const hora  = card.querySelector('.esp-sel-hora').value;
  const ativo = card.querySelector('.esp-chk-ativo').checked;

  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  // Recalcula restantes a partir das vagas já ocupadas,
  // para que aumentar o total reabra vagas corretamente.
  const rec = _especialCache.find(r => r.data === data);
  let restantes = vagas;
  if (rec) {
    const ocupadas = Math.max(0, (rec.vagas_total ?? 0) - (rec.vagas_restantes ?? 0));
    restantes = Math.max(0, vagas - ocupadas);
  }

  const { error } = await supabase
    .from('disponibilidade_especial')
    .upsert({
      profissional:    _profEspecial,
      data,
      vagas_total:     vagas,
      vagas_restantes: restantes,
      ate_horario:     hora,
      ativo,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profissional,data' });

  btn.disabled = false;
  if (error) {
    _admBtnEstado(btn, 'erro');
    setTimeout(() => _admBtnEstado(btn, 'salvar'), 2000);
    _toastEsp(error.message, 'erro');
    return;
  }

  // Sincroniza cache e label de restantes
  if (rec) {
    rec.vagas_total     = vagas;
    rec.vagas_restantes = restantes;
    const lbl = card.querySelector('.esp-restantes');
    if (lbl) lbl.textContent = `${restantes} vaga${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''}`;
  }

  _admBtnEstado(btn, 'salvo');
  setTimeout(() => _admBtnEstado(btn, 'salvar'), 2000);
}

async function _deletarEspecial(data, card) {
  if (!confirm('Remover esta data da agenda especial?')) return;

  const { error } = await supabase
    .from('disponibilidade_especial')
    .delete()
    .eq('profissional', _profEspecial)
    .eq('data', data);

  if (error) { _toastEsp(error.message, 'erro'); return; }

  card.remove();
  _especialCache = _especialCache.filter(r => r.data !== data);
  if (!_especialCache.length) {
    document.getElementById('esp-lista').innerHTML =
      '<div class="ag-empty" style="margin-top:16px">Nenhuma data configurada ainda.</div>';
  }
  _toastEsp('Removido.', 'ok');
}

// ============================================================
// Helpers
// ============================================================
function _opVagas(sel) {
  return Array.from({length: 11}, (_, i) =>
    `<option value="${i}"${i === sel ? ' selected' : ''}>${i}</option>`
  ).join('');
}

function _opHora(sel) {
  let html = '';
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const v = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      html += `<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`;
    }
  }
  return html;
}

function _espISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _toastEsp(msg, tipo) {
  const t = document.createElement('div');
  t.className = 'vagas-toast';
  t.innerHTML = `<svg class="ico vagas-toast-ico" aria-hidden="true"><use href="#ico-${ICO_TOAST[tipo] || 'info'}"></use></svg>`;
  t.appendChild(document.createTextNode(msg));
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('vagas-toast--show'), 10);
  setTimeout(() => { t.classList.remove('vagas-toast--show'); setTimeout(() => t.remove(), 300); }, 2800);
}

// ============================================================
// Init
// ============================================================
function inicializarEspecial() {
  _renderBotoesProf();

  // Popular select de hora do form de adição
  const selHora = document.getElementById('esp-nova-hora');
  if (selHora) selHora.innerHTML = _opHora('18:00');

  // Data mínima = hoje
  const inputData = document.getElementById('esp-nova-data');
  if (inputData) {
    const hoje = new Date();
    inputData.min = _espISO(hoje);
  }

  _atualizarServicosInfo();
  carregarEspecial();
}
