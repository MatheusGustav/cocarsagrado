/* ============================================================
   COCAR SAGRADO — Admin: Cupons de desconto
   Desconto R$ fixo no total do pedido (comunidade do WhatsApp).
   Tabela public.cupons (RLS: só admin autenticado).
   ============================================================ */

let _cuponsCache = [];

function _cupFmtBRL(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? `R$ ${n}` : `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function _cupEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// Carregar + renderizar
// ============================================================
async function inicializarCupons() {
  const container = document.getElementById('cupons-container');
  if (!container) return;

  container.innerHTML = `
    <div class="desc-bloco-titulo" style="margin-bottom:14px;">Cupons de desconto</div>
    <div class="cup-form">
      <div class="cup-form-row">
        <label class="cup-campo">
          <span>Código</span>
          <input type="text" id="cup-novo-codigo" class="cup-input cup-input-codigo"
                 placeholder="EX: COMUNIDADE" maxlength="32" autocomplete="off">
        </label>
        <label class="cup-campo">
          <span>Desconto (R$)</span>
          <input type="number" id="cup-novo-valor" class="cup-input" min="1" step="1" placeholder="20">
        </label>
        <label class="cup-campo cup-campo-desc">
          <span>Descrição (opcional)</span>
          <input type="text" id="cup-novo-desc" class="cup-input" placeholder="ex: Comunidade do Zap" maxlength="80">
        </label>
        <button class="ag-btn ag-btn-primary cup-btn-add" id="cup-btn-add" onclick="criarCupom()">+ Criar cupom</button>
      </div>
    </div>
    <div id="cup-lista" style="margin-top:20px;">
      <div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>
    </div>`;

  await carregarCupons();
}

async function carregarCupons() {
  const lista = document.getElementById('cup-lista');
  if (!lista) return;

  const { data, error } = await supabase
    .from('cupons')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar cupons.</div>';
    console.error('carregarCupons:', error);
    return;
  }

  _cuponsCache = data || [];
  _renderCupons();
}

function _renderCupons() {
  const lista = document.getElementById('cup-lista');
  if (!lista) return;

  if (!_cuponsCache.length) {
    lista.innerHTML = '<div class="ag-empty" style="margin-top:16px">Nenhum cupom criado ainda.</div>';
    return;
  }

  lista.innerHTML = '';
  _cuponsCache.forEach(rec => {
    const card = document.createElement('div');
    card.className = 'cup-card' + (rec.ativo ? '' : ' cup-card--off');
    card.innerHTML = `
      <div class="cup-card-info">
        <span class="cup-card-codigo">${_cupEsc(rec.codigo)}</span>
        <span class="cup-card-valor">${_cupFmtBRL(rec.valor_desconto)} de desconto</span>
        ${rec.descricao ? `<span class="cup-card-desc">${_cupEsc(rec.descricao)}</span>` : ''}
      </div>
      <div class="cup-card-acoes">
        <label class="esp-toggle-wrap">
          <input type="checkbox" class="cup-chk-ativo esp-chk-ativo" ${rec.ativo ? 'checked' : ''}>
          <span class="esp-toggle-track"><span class="esp-toggle-thumb"></span></span>
          <span class="esp-toggle-txt">${rec.ativo ? 'Ativo' : 'Inativo'}</span>
        </label>
        <button class="ag-btn ag-btn-outline ag-btn-sm cup-btn-del" style="color:var(--t-danger)" title="Remover">✕</button>
      </div>`;

    const chk = card.querySelector('.cup-chk-ativo');
    chk.addEventListener('change', () => _toggleCupom(rec.codigo, chk, card));
    card.querySelector('.cup-btn-del').addEventListener('click', () => _deletarCupom(rec.codigo, card));
    lista.appendChild(card);
  });
}

// ============================================================
// Criar / atualizar / deletar
// ============================================================
async function criarCupom() {
  const inCod  = document.getElementById('cup-novo-codigo');
  const inVal  = document.getElementById('cup-novo-valor');
  const inDesc = document.getElementById('cup-novo-desc');
  const btn    = document.getElementById('cup-btn-add');

  const codigo = (inCod?.value || '').trim().toUpperCase();
  const valor  = parseFloat(inVal?.value || '0');
  const desc   = (inDesc?.value || '').trim() || null;

  if (!codigo)        { _toastAdmin('Digite um código.', 'erro'); return; }
  if (!(valor > 0))   { _toastAdmin('Valor do desconto deve ser maior que zero.', 'erro'); return; }

  btn.disabled = true;
  btn.textContent = 'Criando...';

  const { error } = await supabase
    .from('cupons')
    .insert({ codigo, valor_desconto: valor, descricao: desc, ativo: true });

  btn.disabled = false;
  btn.textContent = '+ Criar cupom';

  if (error) {
    const msg = /duplicate|unique/i.test(error.message) ? 'Já existe um cupom com esse código.' : error.message;
    _toastAdmin('❌ ' + msg, 'erro');
    return;
  }

  inCod.value = ''; inVal.value = ''; inDesc.value = '';
  await carregarCupons();
  _toastAdmin('✅ Cupom criado!', 'ok');
}

async function _toggleCupom(codigo, chk, card) {
  const ativo = chk.checked;
  const txt = card.querySelector('.esp-toggle-txt');
  txt.textContent = ativo ? 'Ativo' : 'Inativo';
  card.classList.toggle('cup-card--off', !ativo);

  const { error } = await supabase
    .from('cupons')
    .update({ ativo })
    .eq('codigo', codigo);

  if (error) {
    // reverte visual
    chk.checked = !ativo;
    txt.textContent = !ativo ? 'Ativo' : 'Inativo';
    card.classList.toggle('cup-card--off', ativo);
    _toastAdmin('❌ ' + error.message, 'erro');
    return;
  }
  const rec = _cuponsCache.find(c => c.codigo === codigo);
  if (rec) rec.ativo = ativo;
}

async function _deletarCupom(codigo, card) {
  if (!confirm(`Remover o cupom ${codigo}?`)) return;

  const { error } = await supabase.from('cupons').delete().eq('codigo', codigo);
  if (error) { _toastAdmin('❌ ' + error.message, 'erro'); return; }

  card.remove();
  _cuponsCache = _cuponsCache.filter(c => c.codigo !== codigo);
  if (!_cuponsCache.length) {
    document.getElementById('cup-lista').innerHTML =
      '<div class="ag-empty" style="margin-top:16px">Nenhum cupom criado ainda.</div>';
  }
  _toastAdmin('✅ Removido.', 'ok');
}

window.inicializarCupons = inicializarCupons;
window.criarCupom = criarCupom;
