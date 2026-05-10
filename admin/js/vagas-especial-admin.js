/* ============================================================
   COCAR SAGRADO — Admin: Agenda Especial
   ============================================================ */

const SERVICOS_ESPECIAIS_INFO = {
  matheus: ['Búzios Completo'],
  camila:  ['Promo das Mães', 'Registros Akáshicos', 'Mesa Radiônica', 'Mesa Cigana Completa', 'Theta Healing'],
};

const DIAS_ESP  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES_ESP = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let _profEspecial  = localStorage.getItem('especial_terapeuta') || 'matheus';
let _especialCache = [];

// ============================================================
// Seletor de profissional
// ============================================================
function trocarProfEspecial(p) {
  _profEspecial = p;
  localStorage.setItem('especial_terapeuta', p);
  document.getElementById('btn-esp-matheus')?.classList.toggle('active', p === 'matheus');
  document.getElementById('btn-esp-camila')?.classList.toggle('active',  p === 'camila');
  _atualizarServicosInfo();
  carregarEspecial();
}

function _atualizarServicosInfo() {
  const el = document.getElementById('esp-servicos-info');
  if (!el) return;
  const servicos = SERVICOS_ESPECIAIS_INFO[_profEspecial] || [];
  el.textContent = servicos.join(' · ');
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
    const d    = new Date(rec.data + 'T00:00:00');
    const card = document.createElement('div');
    card.className = 'esp-card' + (rec.ativo ? '' : ' esp-card--off');
    card.innerHTML = `
      <div class="esp-card-data">
        <span class="esp-card-dianum">${d.getDate()}</span>
        <div class="esp-card-diainfo">
          <span>${DIAS_ESP[d.getDay()]}</span>
          <span>${MESES_ESP[d.getMonth()]}</span>
        </div>
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
        <button class="ag-btn ag-btn-primary ag-btn-sm esp-btn-salvar" title="Salvar">💾 Salvar</button>
        <button class="ag-btn ag-btn-outline ag-btn-sm esp-btn-del" style="color:#c00" title="Remover">✕</button>
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

  const { error } = await supabase
    .from('disponibilidade_especial')
    .upsert({
      profissional:    _profEspecial,
      data,
      vagas_total:     vagas,
      vagas_restantes: vagas,
      ate_horario:     hora,
      ativo:           true,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'profissional,data' });

  btn.disabled    = false;
  btn.textContent = '+ Adicionar';

  if (error) { _toastEsp('❌ ' + error.message); return; }

  inputData.value = '';
  await carregarEspecial();
  _toastEsp('✅ Data adicionada!');
}

// ============================================================
// Salvar / Deletar
// ============================================================
async function _salvarEspecial(data, card) {
  const btn   = card.querySelector('.esp-btn-salvar');
  const vagas = parseInt(card.querySelector('.esp-sel-vagas').value);
  const hora  = card.querySelector('.esp-sel-hora').value;
  const ativo = card.querySelector('.esp-chk-ativo').checked;

  const orig      = btn.textContent;
  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  const { error } = await supabase
    .from('disponibilidade_especial')
    .upsert({
      profissional:    _profEspecial,
      data,
      vagas_total:     vagas,
      vagas_restantes: vagas,
      ate_horario:     hora,
      ativo,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profissional,data' });

  btn.disabled = false;
  if (error) {
    btn.textContent = '✗ Erro';
    setTimeout(() => { btn.textContent = orig; }, 2000);
    _toastEsp('❌ ' + error.message);
    return;
  }

  btn.textContent = '✓ Salvo';
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

async function _deletarEspecial(data, card) {
  if (!confirm('Remover esta data da agenda especial?')) return;

  const { error } = await supabase
    .from('disponibilidade_especial')
    .delete()
    .eq('profissional', _profEspecial)
    .eq('data', data);

  if (error) { _toastEsp('❌ ' + error.message); return; }

  card.remove();
  _especialCache = _especialCache.filter(r => r.data !== data);
  if (!_especialCache.length) {
    document.getElementById('esp-lista').innerHTML =
      '<div class="ag-empty" style="margin-top:16px">Nenhuma data configurada ainda.</div>';
  }
  _toastEsp('✅ Removido.');
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

function _toastEsp(msg) {
  const t = document.createElement('div');
  t.className = 'vagas-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('vagas-toast--show'), 10);
  setTimeout(() => { t.classList.remove('vagas-toast--show'); setTimeout(() => t.remove(), 300); }, 2800);
}

// ============================================================
// Init
// ============================================================
function inicializarEspecial() {
  document.getElementById('btn-esp-matheus')?.classList.toggle('active', _profEspecial === 'matheus');
  document.getElementById('btn-esp-camila')?.classList.toggle('active',  _profEspecial === 'camila');

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
