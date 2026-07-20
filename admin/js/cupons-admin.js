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

// timestamptz -> 'DD/MM/AAAA' no fuso de SP (o valor vem em UTC; cortar a
// string mostraria o dia seguinte pra quem expira às 23:59 de Brasília)
function _cupDataBR(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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
        <label class="cup-campo" title="Preenchido = cupom pessoal: só essa conta consegue usar (e ela vê o cupom no site). O cliente recebe e-mail se tiver ligado as novidades.">
          <span>E-mail do cliente (opcional)</span>
          <input type="email" id="cup-novo-email" class="cup-input" placeholder="cupom pessoal" autocomplete="off">
        </label>
        <label class="cup-campo" title="Vazio = sem validade. Expira no fim do dia (horário de Brasília).">
          <span>Validade (opcional)</span>
          <input type="date" id="cup-novo-validade" class="cup-input">
        </label>
        <label class="cup-campo cup-campo-uso">
          <span>Uso único</span>
          <label class="esp-toggle-wrap">
            <input type="checkbox" id="cup-novo-uso" class="esp-chk-ativo">
            <span class="esp-toggle-track"><span class="esp-toggle-thumb"></span></span>
            <span class="esp-toggle-txt">Reutilizável</span>
          </label>
        </label>
        <button class="ag-btn ag-btn-primary cup-btn-add" id="cup-btn-add" onclick="criarCupom()"><svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Criar cupom</button>
      </div>
    </div>
    <div id="cup-lista" style="margin-top:20px;">
      <div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>
    </div>`;

  const chkUso = document.getElementById('cup-novo-uso');
  chkUso?.addEventListener('change', () => {
    chkUso.closest('.esp-toggle-wrap').querySelector('.esp-toggle-txt').textContent =
      chkUso.checked ? 'Uso único' : 'Reutilizável';
  });

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
        ${rec.expira_em ? `<span class="cup-card-desc">Válido até ${_cupDataBR(rec.expira_em)}</span>` : ''}
        ${rec.uso_unico ? '<span class="cup-card-badge">Uso único</span>' : ''}
        ${rec.user_id ? '<span class="cup-card-badge">Pessoal</span>' : ''}
      </div>
      <div class="cup-card-acoes">
        <label class="esp-toggle-wrap" title="Liga/desliga o cupom">
          <input type="checkbox" class="cup-chk-ativo esp-chk-ativo" ${rec.ativo ? 'checked' : ''}>
          <span class="esp-toggle-track"><span class="esp-toggle-thumb"></span></span>
          <span class="esp-toggle-txt">${rec.ativo ? 'Ativo' : 'Inativo'}</span>
        </label>
        <label class="esp-toggle-wrap" title="Se ligado, o cupom morre após o cliente pagar com ele">
          <input type="checkbox" class="cup-chk-uso esp-chk-ativo" ${rec.uso_unico ? 'checked' : ''}>
          <span class="esp-toggle-track"><span class="esp-toggle-thumb"></span></span>
          <span class="esp-toggle-txt">${rec.uso_unico ? 'Uso único' : 'Reutilizável'}</span>
        </label>
        <button class="ag-btn ag-btn-outline ag-btn-sm cup-btn-del" style="color:var(--t-danger)" title="Remover" aria-label="Remover cupom"><svg class="ico" aria-hidden="true"><use href="#ico-lixeira"></use></svg></button>
      </div>`;

    const chk = card.querySelector('.cup-chk-ativo');
    chk.addEventListener('change', () => _toggleCupom(rec.codigo, chk, card));
    const chkUso = card.querySelector('.cup-chk-uso');
    chkUso.addEventListener('change', () => _toggleUsoUnico(rec.codigo, chkUso, card));
    card.querySelector('.cup-btn-del').addEventListener('click', () => _deletarCupom(rec.codigo, card));
    lista.appendChild(card);
  });
}

// ============================================================
// Criar / atualizar / deletar
// ============================================================
async function criarCupom() {
  const inCod   = document.getElementById('cup-novo-codigo');
  const inVal   = document.getElementById('cup-novo-valor');
  const inDesc  = document.getElementById('cup-novo-desc');
  const inUso   = document.getElementById('cup-novo-uso');
  const inEmail = document.getElementById('cup-novo-email');
  const inValid = document.getElementById('cup-novo-validade');
  const btn     = document.getElementById('cup-btn-add');

  const codigo = (inCod?.value || '').trim().toUpperCase();
  const valor  = parseFloat(inVal?.value || '0');
  let   desc   = (inDesc?.value || '').trim() || null;
  const usoUnico = !!inUso?.checked;
  const email    = (inEmail?.value || '').trim();
  const validade = (inValid?.value || '').trim();

  if (!codigo)        { _toastAdmin('Digite um código.', 'erro'); return; }
  if (!(valor > 0))   { _toastAdmin('Valor do desconto deve ser maior que zero.', 'erro'); return; }

  btn.disabled = true;
  btn.textContent = 'Criando...';

  // Cupom pessoal: resolve o e-mail pra conta (precisa ter conta no site).
  let userId = null;
  if (email) {
    const { data, error } = await supabase.rpc('admin_user_por_email', { p_email: email });
    if (error || !data?.length) {
      btn.disabled = false;
      btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Criar cupom';
      _toastAdmin(error ? error.message : 'Nenhuma conta com esse e-mail — o cliente precisa criar a conta primeiro.', 'erro');
      return;
    }
    userId = data[0].user_id;
    // Sem descrição, anota o dono (a tabela não guarda o e-mail).
    if (!desc) desc = `pessoal: ${data[0].nome || email}`;
    // Conta que nunca confirmou o código: o cupom fica preso a um user
    // que talvez nunca logue (e o cliente não vê nada no site).
    if (data[0].confirmado === false) {
      _toastAdmin('Essa conta nunca concluiu o login — o cliente só verá o cupom depois de entrar com esse e-mail.', 'erro');
    }
  }

  // Validade: expira no fim do dia escolhido, horário de Brasília.
  const expiraEm = validade ? new Date(`${validade}T23:59:59-03:00`).toISOString() : null;

  const { error } = await supabase
    .from('cupons')
    .insert({ codigo, valor_desconto: valor, descricao: desc, ativo: true, uso_unico: usoUnico, user_id: userId, expira_em: expiraEm });

  btn.disabled = false;
  btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Criar cupom';

  if (error) {
    const msg = /duplicate|unique/i.test(error.message) ? 'Já existe um cupom com esse código.' : error.message;
    _toastAdmin(msg, 'erro');
    return;
  }

  inCod.value = ''; inVal.value = ''; inDesc.value = '';
  if (inEmail) inEmail.value = '';
  if (inValid) inValid.value = '';
  if (inUso) {
    inUso.checked = false;
    inUso.closest('.esp-toggle-wrap').querySelector('.esp-toggle-txt').textContent = 'Reutilizável';
  }
  await carregarCupons();
  _toastAdmin('Cupom criado!' + (userId ? ' Pessoal — o cliente vê no site (e recebe e-mail se ligou as novidades).' : ''), 'ok');
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
    _toastAdmin(error.message, 'erro');
    return;
  }
  const rec = _cuponsCache.find(c => c.codigo === codigo);
  if (rec) rec.ativo = ativo;
}

async function _toggleUsoUnico(codigo, chk, card) {
  const usoUnico = chk.checked;
  const txt = chk.closest('.esp-toggle-wrap').querySelector('.esp-toggle-txt');
  txt.textContent = usoUnico ? 'Uso único' : 'Reutilizável';

  const { error } = await supabase
    .from('cupons')
    .update({ uso_unico: usoUnico })
    .eq('codigo', codigo);

  if (error) {
    chk.checked = !usoUnico;
    txt.textContent = !usoUnico ? 'Uso único' : 'Reutilizável';
    _toastAdmin(error.message, 'erro');
    return;
  }

  // Atualiza o badge "Uso único" no card
  const info = card.querySelector('.cup-card-info');
  let badge = info.querySelector('.cup-card-badge');
  if (usoUnico && !badge) {
    badge = document.createElement('span');
    badge.className = 'cup-card-badge';
    badge.textContent = 'Uso único';
    info.appendChild(badge);
  } else if (!usoUnico && badge) {
    badge.remove();
  }

  const rec = _cuponsCache.find(c => c.codigo === codigo);
  if (rec) rec.uso_unico = usoUnico;
}

async function _deletarCupom(codigo, card) {
  if (!confirm(`Remover o cupom ${codigo}?`)) return;

  const { error } = await supabase.from('cupons').delete().eq('codigo', codigo);
  if (error) { _toastAdmin(error.message, 'erro'); return; }

  card.remove();
  _cuponsCache = _cuponsCache.filter(c => c.codigo !== codigo);
  if (!_cuponsCache.length) {
    document.getElementById('cup-lista').innerHTML =
      '<div class="ag-empty" style="margin-top:16px">Nenhum cupom criado ainda.</div>';
  }
  _toastAdmin('Removido.', 'ok');
}

window.inicializarCupons = inicializarCupons;
window.criarCupom = criarCupom;
