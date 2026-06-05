/* ============================================================
   COCAR SAGRADO — Painel Admin
   ============================================================ */

const WHATSAPP_TERAPEUTA = { matheus: '5528999476620', camila: '5527998528483' };

let _agendamentosTodos = [];
let _statusAtivo       = 'pendente';
let _autoRefreshTimer  = null;
let _admAutenticado    = false;
let _realtimeChannel   = null;
let _refreshDebounce   = null;
let _mfaFactorId       = null;
let _avaliandoSessao   = false;

// ============================================================
// Autenticação com Supabase Auth + MFA (TOTP, 2º fator)
//
// Fluxo: senha -> verifica o nível de garantia da sessão (AAL).
//   - tem fator TOTP verificado e sessão só com senha (aal1) -> desafio
//   - nenhum fator inscrito (nextLevel aal1) -> força inscrição (QR)
//   - sessão já elevada (aal2) -> entra no painel
// Só ao atingir aal2 o painel é liberado e o Realtime conectado.
// ============================================================
async function initAuth() {
  // Listeners do card de login (anexados uma única vez).
  document.getElementById('adm-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await _fazerLogin();
  });
  document.getElementById('adm-mfa-btn')?.addEventListener('click', _verificarMFA);
  document.getElementById('adm-mfa-cancel')?.addEventListener('click', _fazerLogout);
  document.getElementById('adm-mfa-code')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _verificarMFA(); }
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await _avaliarSessao();
    return;
  }
  _admAutenticado = false;
  _mostrarLogin();
}

async function _fazerLogin() {
  const email    = document.getElementById('adm-email')?.value?.trim();
  const password = document.getElementById('adm-password')?.value;
  const btn      = document.getElementById('adm-login-btn');
  const errorEl  = document.getElementById('adm-login-error');

  if (!email || !password) return;

  btn.disabled    = true;
  btn.textContent = 'Entrando...';
  errorEl.style.display = 'none';

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    btn.disabled    = false;
    btn.textContent = 'Entrar';
    errorEl.textContent = error.message === 'Invalid login credentials'
      ? 'E-mail ou senha inválidos.'
      : error.message;
    errorEl.style.display = 'block';
    return;
  }

  // Senha OK (sessão aal1). Decide entre exigir MFA, inscrever ou entrar.
  await _avaliarSessao();
  btn.disabled    = false;
  btn.textContent = 'Entrar';
}

// Lê o AAL (Authenticator Assurance Level) e roteia o fluxo de login.
async function _avaliarSessao() {
  if (_avaliandoSessao) return;
  _avaliandoSessao = true;
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) { _entrarNoPainel(); return; }      // MFA indisponível: não trava o acesso
    const { currentLevel, nextLevel } = data;

    if (nextLevel === 'aal2' && currentLevel !== 'aal2') {
      await _mostrarMFAChallenge();   // tem fator verificado, sessão só senha
    } else if (nextLevel === 'aal1') {
      await _mostrarMFAEnroll();      // nenhum fator: força configuração
    } else {
      _entrarNoPainel();              // currentLevel === 'aal2'
    }
  } finally {
    _avaliandoSessao = false;
  }
}

function _entrarNoPainel() {
  _admAutenticado = true;
  _mostrarAdmin();
  if (typeof _initAdminNav === 'function') _initAdminNav();
  carregarAgendamentos();
}

// Desafio: o usuário já tem um TOTP verificado.
async function _mostrarMFAChallenge() {
  const err = document.getElementById('adm-mfa-error');
  if (err) err.style.display = 'none';
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) { _mostrarLogin(); return; }
  const verificados = (factors?.totp || []);
  const totp = verificados.find(f => f.status === 'verified') || verificados[0];
  if (!totp) { await _mostrarMFAEnroll(); return; }   // sem fator verificado -> inscrever
  _mfaFactorId = totp.id;
  _mostrarTelaMFA('challenge');
}

// Inscrição: gera um novo fator TOTP e mostra QR + chave manual.
async function _mostrarMFAEnroll() {
  const err = document.getElementById('adm-mfa-error');
  if (err) err.style.display = 'none';

  // Remove fatores não verificados pendentes (evita acúmulo/erros).
  try {
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of (list?.all || [])) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  } catch (_) { /* best-effort */ }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'painel-' + Date.now(),
  });
  _mostrarTelaMFA('enroll');
  if (error) {
    if (err) { err.textContent = error.message; err.style.display = 'block'; }
    return;
  }
  _mfaFactorId = data.id;
  const qr = document.getElementById('adm-mfa-qr');
  if (qr) {
    qr.innerHTML = '';
    const img = document.createElement('img');
    img.alt = 'QR Code MFA';
    img.style.cssText = 'width:184px;height:184px;background:#fff;border-radius:8px;padding:6px;';
    img.src = _normalizarQrCode(data.totp.qr_code);
    // Fallback: se o SVG não renderizar, orienta usar a chave manual abaixo.
    img.onerror = () => {
      qr.innerHTML = '<p style="color:#d4c9a8;font-size:.8rem;max-width:200px;text-align:center;">' +
        'Não foi possível exibir o QR. Use a chave manual abaixo no app autenticador.</p>';
    };
    qr.appendChild(img);
  }
  const secret = document.getElementById('adm-mfa-secret');
  if (secret) secret.textContent = data.totp.secret;
}

// O Supabase devolve o QR como data URI de SVG (data:image/svg+xml;utf-8,<svg...>).
// O '#' das cores não vem escapado e trunca o data URI no fragmento → imagem
// quebrada. Re-encoda o payload do SVG quando ele vem cru.
function _normalizarQrCode(src) {
  if (typeof src !== 'string') return src;
  if (src.startsWith('data:image/svg+xml')) {
    const i = src.indexOf(',');
    if (i !== -1) {
      const svg = src.slice(i + 1);
      if (svg.includes('<svg')) {           // veio cru (não percent-encoded)
        return 'data:image/svg+xml,' + encodeURIComponent(svg);
      }
    }
  }
  return src;
}

// Cria o challenge e verifica o código (mesma rotina p/ inscrição e desafio).
async function _verificarMFA() {
  const code = (document.getElementById('adm-mfa-code')?.value || '').replace(/\D/g, '');
  const btn  = document.getElementById('adm-mfa-btn');
  const err  = document.getElementById('adm-mfa-error');
  if (err) err.style.display = 'none';

  if (!/^\d{6}$/.test(code)) {
    if (err) { err.textContent = 'Digite os 6 dígitos do código.'; err.style.display = 'block'; }
    return;
  }
  if (!_mfaFactorId) {
    if (err) { err.textContent = 'Fator MFA não encontrado. Recarregue a página.'; err.style.display = 'block'; }
    return;
  }

  btn.disabled = true; btn.textContent = 'Verificando...';

  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: _mfaFactorId });
  if (chErr) {
    btn.disabled = false; btn.textContent = 'Verificar';
    if (err) { err.textContent = chErr.message; err.style.display = 'block'; }
    return;
  }

  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId: _mfaFactorId,
    challengeId: ch.id,
    code,
  });

  btn.disabled = false; btn.textContent = 'Verificar';

  if (vErr) {
    if (err) { err.textContent = 'Código inválido ou expirado. Tente novamente.'; err.style.display = 'block'; }
    return;
  }

  // Sucesso -> sessão elevada para aal2.
  const codeEl = document.getElementById('adm-mfa-code');
  if (codeEl) codeEl.value = '';
  _entrarNoPainel();
}

async function _fazerLogout() {
  _pararRealtime();
  _mfaFactorId = null;
  await supabase.auth.signOut();
  _admAutenticado = false;
  _mostrarLogin();
}

function _mostrarAdmin() {
  document.getElementById('adm-login-screen')?.style.setProperty('display', 'none');
  document.getElementById('admin-content')?.style.setProperty('display', 'block');
}

function _mostrarLogin() {
  document.getElementById('adm-login-screen')?.style.setProperty('display', '');
  document.getElementById('admin-content')?.style.setProperty('display', 'none');
  // Garante que o card volte ao formulário de senha (esconde etapa MFA).
  const form = document.getElementById('adm-login-form');
  const mfa  = document.getElementById('adm-mfa');
  if (form) form.style.display = '';
  if (mfa)  mfa.style.display  = 'none';
}

// Alterna as telas do card de login: senha | enroll | challenge.
function _mostrarTelaMFA(modo) {
  const form = document.getElementById('adm-login-form');
  const mfa  = document.getElementById('adm-mfa');
  if (form) form.style.display = 'none';
  if (mfa)  mfa.style.display  = '';
  document.getElementById('adm-mfa-enroll').style.display         = modo === 'enroll'    ? '' : 'none';
  document.getElementById('adm-mfa-challenge-text').style.display = modo === 'challenge' ? '' : 'none';
  document.getElementById('adm-mfa-code')?.focus();
}

// Monitora mudanças de sessão (logout remoto, expiração).
// O SIGNED_IN NÃO entra direto: o acesso passa sempre pelo gate de AAL.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || (!session && _admAutenticado)) {
    _admAutenticado = false;
    _pararRealtime();
    _mostrarLogin();
  }
});

const STATUS_LABELS = {
  pendente:   'Pendente',
  pago:       'Pago',
  confirmado: 'Confirmado',
  atendido:   'Atendido',
  cancelado:  'Cancelado',
};

function _toastAdmin(msg, tipo) {
  const t = document.createElement('div');
  t.className = 'adm-toast adm-toast--' + (tipo || 'info');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('adm-toast--show'));
  setTimeout(() => {
    t.classList.remove('adm-toast--show');
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ============================================================
// Carregamento principal
// ============================================================
async function carregarAgendamentos() {
  if (!_admAutenticado) return;
  const filtroData      = document.getElementById('filtro-data')?.value      || '';
  const filtroTerapeuta = document.getElementById('filtro-terapeuta')?.value || '';
  const filtroMetodo    = document.getElementById('filtro-metodo')?.value    || '';
  const lista = document.getElementById('lista-agendamentos');
  if (!lista) return;

  lista.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  let query = supabase
    .from('agendamentos')
    .select('*, tipos_leitura(nome)')
    .order('data_agendamento', { ascending: false })
    .order('hora_agendamento', { ascending: false });

  if (filtroData)      query = query.eq('data_agendamento', filtroData);
  if (filtroTerapeuta) query = query.eq('terapeuta', filtroTerapeuta);
  if (filtroMetodo === '__null') query = query.is('metodo_pagamento', null);
  else if (filtroMetodo)        query = query.eq('metodo_pagamento', filtroMetodo);

  const { data, error } = await query;

  if (error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar agendamentos.</div>';
    console.error(error);
    return;
  }

  _agendamentosTodos = data || [];
  await calcularEstatisticas(_agendamentosTodos);
  _atualizarContadoresPills(_agendamentosTodos);

  const filtrados = _statusAtivo
    ? _agendamentosTodos.filter(a => a.status === _statusAtivo)
    : _agendamentosTodos;
  renderizarAgendamentos(filtrados, lista);

  _iniciarRealtime();
  _iniciarAutoRefresh();
}

function filtrarPorPill(status) {
  _statusAtivo = status;
  document.querySelectorAll('.adm-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.status === status);
  });
  const lista = document.getElementById('lista-agendamentos');
  if (!lista) return;
  const filtrados = status
    ? _agendamentosTodos.filter(a => a.status === status)
    : _agendamentosTodos;
  renderizarAgendamentos(filtrados, lista);
}

function _atualizarContadoresPills(todos) {
  const c = {};
  todos.forEach(a => { c[a.status] = (c[a.status] || 0) + 1; });
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? 0; };
  set('pill-count-pendente',  c.pendente || 0);
  set('pill-count-pago',      (c.pago || 0) + (c.confirmado || 0));
  set('pill-count-atendido',  c.atendido || 0);
  set('pill-count-cancelado', c.cancelado || 0);
}

// ============================================================
// Realtime — webhook Mercado Pago marca pago -> painel atualiza
// ============================================================
function _agendarRefresh() {
  clearTimeout(_refreshDebounce);
  _refreshDebounce = setTimeout(() => {
    if (_admAutenticado) carregarAgendamentos();
  }, 400);
}

function _iniciarRealtime() {
  if (_realtimeChannel) return;
  _realtimeChannel = supabase
    .channel('agendamentos-admin')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'agendamentos' },
      (payload) => {
        const novo = payload.new || {};
        const velho = payload.old || {};
        // Pagamento confirmado pelo webhook (pendente -> pago)
        if (payload.eventType === 'UPDATE' && velho.status === 'pendente' && novo.status === 'pago') {
          _toastAdmin('💰 Pagamento confirmado: ' + (novo.cliente_nome || 'cliente'), 'ok');
        }
        _agendarRefresh();
      })
    .subscribe();
}

function _pararRealtime() {
  if (!_realtimeChannel) return;
  supabase.removeChannel(_realtimeChannel);
  _realtimeChannel = null;
}

function _iniciarAutoRefresh() {
  if (_autoRefreshTimer) return;
  _autoRefreshTimer = setInterval(async () => {
    if (!_admAutenticado) return;
    const filtroData      = document.getElementById('filtro-data')?.value      || '';
    const filtroTerapeuta = document.getElementById('filtro-terapeuta')?.value || '';
    const filtroMetodo    = document.getElementById('filtro-metodo')?.value    || '';

    let query = supabase
      .from('agendamentos')
      .select('*, tipos_leitura(nome)')
      .order('data_agendamento', { ascending: false })
      .order('hora_agendamento', { ascending: false });

    if (filtroData)      query = query.eq('data_agendamento', filtroData);
    if (filtroTerapeuta) query = query.eq('terapeuta', filtroTerapeuta);
    if (filtroMetodo === '__null') query = query.is('metodo_pagamento', null);
    else if (filtroMetodo)        query = query.eq('metodo_pagamento', filtroMetodo);

    const { data, error } = await query;
    if (error || !data) return;

    _agendamentosTodos = data;
    await calcularEstatisticas(_agendamentosTodos);
    _atualizarContadoresPills(_agendamentosTodos);

    const filtrados = _statusAtivo
      ? _agendamentosTodos.filter(a => a.status === _statusAtivo)
      : _agendamentosTodos;
    const lista = document.getElementById('lista-agendamentos');
    if (lista) renderizarAgendamentos(filtrados, lista);
  }, 2 * 60 * 1000);
}

// ============================================================
// Estatísticas
// ============================================================
function _dataLocalISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function calcularEstatisticas(todos) {
  const hoje = _dataLocalISO();

  const agendamentosHoje  = todos.filter(a => a.data_agendamento === hoje).length;
  const pendentes         = todos.filter(a => a.status === 'pendente').length;
  const pagos             = todos.filter(a => ['pago','confirmado','atendido'].includes(a.status)).length;
  const leiturasPendentes = todos.filter(a => ['pago','confirmado'].includes(a.status)).length;

  // Total faturado no mês
  const mesAtual = hoje.slice(0, 7);
  const totalMes = todos
    .filter(a => a.data_agendamento?.startsWith(mesAtual) && ['pago','confirmado','atendido'].includes(a.status))
    .reduce((acc, a) => acc + Number(a.valor_final || 0), 0);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-hoje',    agendamentosHoje);
  set('stat-pendente',pendentes);
  set('stat-pagos',   pagos);
  set('stat-total',   `R$ ${totalMes.toFixed(2).replace('.', ',')}`);

  atualizarMascote(pendentes, pagos);
}

// Estado mais recente (alimenta o sorteio de frases ao trocar de tela).
let _mascoteEstado = { pagos: 0 };

const _MASCOTE_NEUTRAS = ['estou de olho por aqui...', 'só peidanno por aqui...'];
const _MASCOTE_GRANA   = ['ta com a grana né!! só de olho...', 'a grana ta entrando hein!'];

// Guarda o estado e fala. Chamado quando as estatísticas atualizam.
function atualizarMascote(pendentes, pagos) {
  _mascoteEstado = { pagos };
  falarMascote();
}

// Sorteia uma frase do pool do estado atual. Mesmo com um gatilho ativo o
// pool tem várias frases (+ neutras), então a mensagem não fica travada —
// trocar de tela re-sorteia.
function falarMascote() {
  const wrap  = document.getElementById('mascote-chefe');
  const balao = document.getElementById('mascote-balao');
  if (!wrap || !balao) return;

  const { pagos } = _mascoteEstado;
  const pool = pagos >= 8 ? [..._MASCOTE_GRANA, ..._MASCOTE_NEUTRAS] : _MASCOTE_NEUTRAS;

  const frase = pool[Math.floor(Math.random() * pool.length)];
  balao.textContent = frase;
  wrap.classList.toggle('mascote-grana', _MASCOTE_GRANA.includes(frase));
}

// ============================================================
// Mascote arrastável — o admin posiciona a bolinha onde quiser
// e ela fica parada lá (posição salva no localStorage).
// ============================================================
function tornarMascoteArrastavel() {
  const el = document.getElementById('mascote-chefe');
  if (!el || el.dataset.dragReady === '1') return;
  const handle = el.querySelector('.mascote-img');
  if (!handle) return;
  el.dataset.dragReady = '1';

  const KEY = 'mascote_pos';
  const MARGEM = 12;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // Área útil da tela: desconta a sidebar fixa (desktop) e a topbar (mobile).
  // No mobile a sidebar vira drawer (position: fixed) e não ocupa a lateral.
  function areaUtil() {
    let minLeft = 0, minTop = 0;
    const sb = document.querySelector('.adm-sidebar');
    if (sb) {
      const cs = getComputedStyle(sb);
      if (cs.position !== 'fixed' && cs.display !== 'none') {
        minLeft = Math.max(0, sb.getBoundingClientRect().right);
      }
    }
    const tb = document.querySelector('.adm-topbar');
    if (tb && getComputedStyle(tb).display !== 'none') {
      minTop = Math.max(0, tb.getBoundingClientRect().bottom);
    }
    return { minLeft, minTop, maxRight: window.innerWidth, maxBottom: window.innerHeight };
  }

  // Durante o arrasto o limite é a área útil (sem sidebar/topbar). O clamp
  // é pela bolinha, não pelo wrap — o balão invisível não cria barreira e a
  // bolinha encosta na borda da área verde sem entrar nela.
  function aplicarPos(left, top) {
    const a = areaUtil();
    const offX = handle.offsetLeft, offY = handle.offsetTop;
    const iw = handle.offsetWidth, ih = handle.offsetHeight;
    left = clamp(left, a.minLeft + 4 - offX, a.maxRight  - offX - iw - 4);
    top  = clamp(top,  a.minTop  + 4 - offY, a.maxBottom - offY - ih - 4);
    el.style.left   = left + 'px';
    el.style.top    = top + 'px';
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
  }

  // Canto mais próximo do centro da bolinha: 'tl' | 'tr' | 'bl' | 'br'
  function cantoMaisProximo() {
    const a = areaUtil();
    const r = handle.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const v = (cy - a.minTop)  < (a.maxBottom - cy) ? 't' : 'b';
    const h = (cx - a.minLeft) < (a.maxRight  - cx) ? 'l' : 'r';
    return v + h;
  }

  // Fixa o mascote num canto. Âncoras right/bottom nos cantos direito/baixo
  // pra acompanhar mudanças de tamanho do balão sem vazar da tela.
  function fixarCanto(canto) {
    const a = areaUtil();
    const esq = canto[1] === 'l', topo = canto[0] === 't';
    el.style.left   = esq  ? (a.minLeft + MARGEM) + 'px' : 'auto';
    el.style.right  = esq  ? 'auto' : MARGEM + 'px';
    el.style.top    = topo ? (a.minTop + MARGEM) + 'px'  : 'auto';
    el.style.bottom = topo ? 'auto' : MARGEM + 'px';
    // Nos cantos esquerdos a bolinha fica no canto e o balão abre pra direita
    el.classList.toggle('mascote-esquerda', esq);
  }

  let cantoAtual = 'br';

  // Restaura canto salvo (depois do layout calcular tamanhos)
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && /^[tb][lr]$/.test(saved.canto || '')) cantoAtual = saved.canto;
  } catch {}
  requestAnimationFrame(() => fixarCanto(cantoAtual));

  let arrastando = false, startX = 0, startY = 0, baseLeft = 0, baseTop = 0, snapTimer = 0;

  handle.addEventListener('pointerdown', (e) => {
    arrastando = true;
    clearTimeout(snapTimer);
    el.classList.remove('snapping');
    const r = el.getBoundingClientRect();
    baseLeft = r.left; baseTop = r.top;
    startX = e.clientX; startY = e.clientY;
    aplicarPos(baseLeft, baseTop); // troca âncora right/bottom → left/top
    try { handle.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('dragging');
    el.classList.add('balao-oculto'); // balão some durante o arrasto
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    aplicarPos(baseLeft + (e.clientX - startX), baseTop + (e.clientY - startY));
  });

  function fim(e) {
    if (!arrastando) return;
    arrastando = false;
    el.classList.remove('dragging');
    try { handle.releasePointerCapture(e.pointerId); } catch {}

    // Puxa pro canto mais próximo, com animação. O lado do balão já troca
    // aqui — invisível (balao-oculto), então sem pulo visual.
    cantoAtual = cantoMaisProximo();
    el.classList.toggle('mascote-esquerda', cantoAtual[1] === 'l');
    const a = areaUtil();
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = cantoAtual[1] === 'l' ? a.minLeft + MARGEM : a.maxRight  - w - MARGEM;
    const top  = cantoAtual[0] === 't' ? a.minTop  + MARGEM : a.maxBottom - h - MARGEM;
    el.classList.add('snapping');
    requestAnimationFrame(() => { el.style.left = left + 'px'; el.style.top = top + 'px'; });
    snapTimer = setTimeout(() => {
      el.classList.remove('snapping');
      fixarCanto(cantoAtual);
      el.classList.remove('balao-oculto'); // balão reaparece já do lado certo
    }, 320);
    try { localStorage.setItem(KEY, JSON.stringify({ canto: cantoAtual })); } catch {}
  }
  handle.addEventListener('pointerup', fim);
  handle.addEventListener('pointercancel', fim);

  // Reposiciona no canto quando a tela muda (resize / rotação / breakpoint)
  window.addEventListener('resize', () => {
    if (!arrastando) fixarCanto(cantoAtual);
  });
}

// ============================================================
// Renderização
// ============================================================
const DIAS_SEMANA_PT = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

function _rotuloDivisor(dataIso) {
  if (!dataIso) return 'Sem data';
  const [y, m, d] = dataIso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS_SEMANA_PT[dt.getDay()]}, ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}`;
}

function _agruparPorPedido(lista) {
  // Conta quantos agendamentos compartilham cada pedido_id
  const contagem = new Map();
  for (const ag of lista) {
    if (ag.pedido_id) contagem.set(ag.pedido_id, (contagem.get(ag.pedido_id) || 0) + 1);
  }

  const processados = new Set();
  const resultado = [];

  for (const ag of lista) {
    if (!ag.pedido_id || contagem.get(ag.pedido_id) === 1) {
      resultado.push({ tipo: 'single', ag, data_agendamento: ag.data_agendamento });
      continue;
    }
    if (processados.has(ag.pedido_id)) continue;
    processados.add(ag.pedido_id);
    const ags = lista.filter(a => a.pedido_id === ag.pedido_id);
    resultado.push({ tipo: 'grupo', pedido_id: ag.pedido_id, ags, data_agendamento: ag.data_agendamento });
  }

  return resultado;
}

function renderizarAgendamentos(lista, container) {
  if (!lista.length) {
    container.innerHTML = '<div class="ag-empty">Nenhum agendamento encontrado.</div>';
    return;
  }
  container.innerHTML = '';
  const itens = _agruparPorPedido(lista);
  let dataAtual = null;
  itens.forEach(item => {
    if (item.data_agendamento !== dataAtual) {
      dataAtual = item.data_agendamento;
      const divisor = document.createElement('div');
      divisor.className = 'adm-divisor-dia';
      divisor.innerHTML = `<span>${_esc(_rotuloDivisor(dataAtual))}</span>`;
      container.appendChild(divisor);
    }
    if (item.tipo === 'grupo') {
      container.appendChild(criarItemGrupo(item));
    } else {
      container.appendChild(criarItemAgendamento(item.ag));
    }
  });
}

function _esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function criarItemAgendamento(ag) {
  const item = document.createElement('div');
  item.className = 'adm-item';
  item.dataset.id = ag.id;

  const nomeTipo        = ag.tipos_leitura?.nome || '—';
  const data            = formatarData(ag.data_agendamento);
  const horaRaw         = ag.hora_agendamento?.slice(0,5) || '';
  const horaLabel       = (!horaRaw || horaRaw === '00:00') ? '(horário a combinar)' : `até as ${horaRaw}`;
  const valor           = `R$ ${Number(ag.valor_final || 0).toFixed(2).replace('.', ',')}`;
  const badge           = `<span class="adm-badge adm-badge-${_esc(ag.status)}">${_esc(STATUS_LABELS[ag.status] || ag.status)}</span>`;
  const terapeutaNome   = ag.terapeuta === 'matheus' ? 'Matheus' : ag.terapeuta === 'camila' ? 'Camila' : '';
  const badgeTerapeuta  = terapeutaNome ? `<span class="adm-badge adm-badge-terapeuta">${terapeutaNome}</span>` : '';

  const acoes = montarAcoes(ag);

  item.innerHTML = `
    <div class="adm-item-header" onclick="toggleDetalhes(this)">
      <div class="adm-item-info">
        <h4>${_esc(ag.cliente_nome)}</h4>
        <p>${_esc(nomeTipo)} — ${_esc(data)} ${_esc(horaLabel)}</p>
      </div>
      <div class="adm-item-right">
        <span style="font-weight:700; color:var(--primary)">${_esc(valor)}</span>
        ${badgeTerapeuta}
        ${badge}
        <span style="font-size:1.1rem; color:var(--text-muted)">▾</span>
      </div>
    </div>
    <div class="adm-item-details">
      <div class="adm-details-grid">
        <div class="adm-detail-item"><label>Chave do pedido</label><span style="font-family:monospace">${_esc(ag.chave_pedido)}</span></div>
        <div class="adm-detail-item"><label>WhatsApp</label><span>${_esc(ag.cliente_whatsapp || '—')}</span></div>
        <div class="adm-detail-item"><label>Nascimento</label><span>${_esc(formatarData(ag.cliente_nascimento))}</span></div>
        <div class="adm-detail-item"><label>Valor original</label><span>R$ ${Number(ag.valor_original||0).toFixed(2).replace('.', ',')}</span></div>
        <div class="adm-detail-item"><label>Desconto</label><span>R$ ${Number(ag.desconto_aplicado||0).toFixed(2).replace('.', ',')}${ag.aceitou_desconto_10 ? ' <span title="Desconto novo cliente" style="color:var(--primary);font-size:.75rem;">(10% novo cliente)</span>' : ''}</span></div>
        <div class="adm-detail-item"><label>Método pag.</label><span>${_esc(ag.metodo_pagamento || '—')}</span></div>
        <div class="adm-detail-item"><label>Pago em</label><span>${ag.pago_em ? _esc(formatarDatetime(ag.pago_em)) : '—'}</span></div>
        ${ag.cliente_observacoes ? `<div class="adm-detail-item" style="grid-column:1/-1"><label>Observações</label><span style="white-space:pre-wrap">${_esc(ag.cliente_observacoes)}</span></div>` : ''}
      </div>
      <div class="adm-item-actions">${acoes}</div>
    </div>`;

  return item;
}

function criarItemGrupo(grupo) {
  const { ags, pedido_id } = grupo;
  const ref = ags[0];

  const valorTotal = ags.reduce((s, a) => s + Number(a.valor_final || 0), 0);
  const valorStr = `R$ ${valorTotal.toFixed(2).replace('.', ',')}`;

  const ordemStatus = ['pendente', 'cancelado', 'pago', 'confirmado', 'atendido'];
  const statusGrupo = ags.reduce((pior, a) => {
    return ordemStatus.indexOf(a.status) < ordemStatus.indexOf(pior) ? a.status : pior;
  }, 'atendido');

  const badge      = `<span class="adm-badge adm-badge-${_esc(statusGrupo)}">${_esc(STATUS_LABELS[statusGrupo] || statusGrupo)}</span>`;
  const badgeGrupo = `<span class="adm-badge adm-badge-grupo">${ags.length} leituras</span>`;

  const leituras = ags.map(ag => {
    const nomeTipo   = ag.tipos_leitura?.nome || '—';
    const data       = formatarData(ag.data_agendamento);
    const horaRaw    = ag.hora_agendamento?.slice(0, 5) || '';
    const horaLabel  = (!horaRaw || horaRaw === '00:00') ? 'a combinar' : `até ${horaRaw}`;
    const valor      = `R$ ${Number(ag.valor_final || 0).toFixed(2).replace('.', ',')}`;
    const terapeuta  = ag.terapeuta === 'matheus' ? 'Matheus' : ag.terapeuta === 'camila' ? 'Camila' : ag.terapeuta || '—';
    const badgeSt    = `<span class="adm-badge adm-badge-${_esc(ag.status)} adm-badge-sm">${_esc(STATUS_LABELS[ag.status] || ag.status)}</span>`;
    return `<div class="adm-grupo-leitura">
      <div class="adm-grupo-leitura-info">
        <strong>${_esc(nomeTipo)}</strong>
        <span>${_esc(data)} ${_esc(horaLabel)} · ${_esc(terapeuta)}</span>
      </div>
      <div class="adm-grupo-leitura-right">
        <span>${_esc(valor)}</span>
        ${badgeSt}
      </div>
    </div>`;
  }).join('');

  const item = document.createElement('div');
  item.className = 'adm-item adm-item-grupo';
  item.dataset.pedidoId = pedido_id;

  item.innerHTML = `
    <div class="adm-item-header" onclick="toggleDetalhes(this)">
      <div class="adm-item-info">
        <h4>${_esc(ref.cliente_nome)} ${badgeGrupo}</h4>
        <p>Pedido · ${_esc(ref.chave_pedido || '—')}</p>
      </div>
      <div class="adm-item-right">
        <span style="font-weight:700; color:var(--primary)">${_esc(valorStr)}</span>
        ${badge}
        <span style="font-size:1.1rem; color:var(--text-muted)">▾</span>
      </div>
    </div>
    <div class="adm-item-details">
      <div style="margin-bottom:14px;">
        <div class="adm-grupo-label">Leituras do pedido</div>
        <div class="adm-grupo-leituras">${leituras}</div>
      </div>
      <div class="adm-details-grid">
        <div class="adm-detail-item"><label>WhatsApp</label><span>${_esc(ref.cliente_whatsapp || '—')}</span></div>
        <div class="adm-detail-item"><label>Nascimento</label><span>${_esc(formatarData(ref.cliente_nascimento))}</span></div>
        <div class="adm-detail-item"><label>Método pag.</label><span>${_esc(ref.metodo_pagamento || '—')}</span></div>
        <div class="adm-detail-item"><label>Pago em</label><span>${ref.pago_em ? _esc(formatarDatetime(ref.pago_em)) : '—'}</span></div>
      </div>
      <div class="adm-item-actions">${montarAcoesGrupo(ags)}</div>
    </div>`;

  return item;
}

function montarAcoesGrupo(ags) {
  const ids       = ags.map(a => a.id);
  const temPendente = ags.some(a => a.status === 'pendente');
  const temPago     = ags.some(a => ['pago', 'confirmado'].includes(a.status));
  let html = '';

  if (temPendente) {
    html += `<button class="ag-btn ag-btn-primary ag-btn-sm" onclick="marcarGrupoComoPago(${JSON.stringify(ids)},'${escapeAttr(ags[0].chave_pedido || '')}')">✅ Marcar todos como Pagos</button>`;
  }
  if (temPago) {
    html += `<button class="ag-btn ag-btn-secondary ag-btn-sm" onclick="marcarGrupoComoAtendido(${JSON.stringify(ids)})">🌙 Marcar todos como Atendidos</button>`;
  }

  const comFone = ags.find(a => a.cliente_whatsapp?.replace(/\D/g, '').length >= 10);
  if (comFone) {
    const fone = comFone.cliente_whatsapp;
    const nome = comFone.cliente_nome || '';
    const qtd  = ags.length;
    const data = formatarData(ags[0].data_agendamento);
    html += `<button class="ag-btn ag-btn-whatsapp ag-btn-sm" onclick="abrirWhatsApp('${escapeAttr(fone)}','${escapeAttr(nome)}','pedido com ${qtd} leituras','${data}','')">📱 WhatsApp</button>`;
  }

  return html;
}

function montarAcoes(ag) {
  const id      = ag.id;
  const fone    = ag.cliente_whatsapp || '';
  const nome    = ag.cliente_nome     || '';
  const tipo    = ag.tipos_leitura?.nome || 'Leitura';
  const data    = formatarData(ag.data_agendamento);
  const horaBtn = (() => { const h = ag.hora_agendamento?.slice(0,5) || ''; return (!h || h === '00:00') ? '' : h; })();

  let html = '';

  if (ag.status === 'pendente') {
    html += `<button class="ag-btn ag-btn-primary ag-btn-sm" onclick="marcarComoPago('${id}','${escapeAttr(ag.chave_pedido||'')}')">✅ Marcar como Pago</button>`;
    html += `<button class="ag-btn ag-btn-danger ag-btn-sm" onclick="apagarAgendamento('${id}')">🗑 Apagar</button>`;
  }
  if (['pago','confirmado'].includes(ag.status)) {
    html += `<button class="ag-btn ag-btn-secondary ag-btn-sm" onclick="marcarComoAtendido('${id}')">🌙 Marcar como Atendido</button>`;
  }
  if (ag.status !== 'cancelado' && ag.status !== 'atendido') {
    html += `<button class="ag-btn ag-btn-danger ag-btn-sm" onclick="cancelarAgendamento('${id}')">✖ Cancelar</button>`;
  }

  if (fone.replace(/\D/g,'').length >= 10) {
    html += `<button class="ag-btn ag-btn-whatsapp ag-btn-sm" onclick="abrirWhatsApp('${escapeAttr(fone)}','${escapeAttr(nome)}','${escapeAttr(tipo)}','${data}','${escapeAttr(horaBtn)}')">📱 WhatsApp</button>`;
  }

  return html;
}

// ============================================================
// Ações de status
// ============================================================
async function marcarComoPago(id, chavePedido) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm('Marcar pedido como pago?')) return;
  const agora = new Date().toISOString();
  const { error: errAg } = await supabase
    .from('agendamentos')
    .update({ status: 'pago', pago_em: agora })
    .eq('chave_pedido', chavePedido)
    .eq('status', 'pendente'); // não reativa leituras canceladas/atendidas do mesmo pedido
  if (errAg) { _toastAdmin('Erro: ' + errAg.message, 'erro'); return; }
  const { error: errPed } = await supabase
    .from('pedidos')
    .update({ status: 'pago', pago_em: agora, metodo_pagamento: 'pix' })
    .eq('chave_pedido', chavePedido)
    .eq('status', 'pendente');
  if (errPed) { _toastAdmin('Erro ao atualizar pedido: ' + errPed.message, 'erro'); return; }
  _toastAdmin('✅ Pedido marcado como pago!', 'ok');
  carregarAgendamentos();
}

async function marcarComoAtendido(id) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm('Marcar agendamento como atendido?')) return;
  const { error } = await supabase.from('agendamentos').update({ status: 'atendido', atendido_em: new Date().toISOString() }).eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  _toastAdmin('✅ Marcado como atendido!', 'ok');
  carregarAgendamentos();
}

async function _devolverVagaEspecialSeAplicavel(ag) {
  if (!ag?.agendamento_especial) return;
  if (ag.status === 'cancelado') return;
  if (!ag.terapeuta || !ag.data_agendamento) return;
  await supabase.rpc('incrementar_vagas_restantes', {
    p_profissional: ag.terapeuta,
    p_data: ag.data_agendamento,
  });
}

async function cancelarAgendamento(id) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm('Cancelar este agendamento? Esta ação não pode ser desfeita.')) return;
  const ag = _agendamentosTodos.find(a => String(a.id) === String(id));
  const { error } = await supabase.from('agendamentos').update({ status: 'cancelado' }).eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  await _devolverVagaEspecialSeAplicavel(ag);
  _toastAdmin('✅ Agendamento cancelado.', 'ok');
  carregarAgendamentos();
}

async function marcarGrupoComoPago(ids, chavePedido) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm(`Marcar ${ids.length} agendamento(s) como pagos?`)) return;
  const agora = new Date().toISOString();
  const { error } = await supabase.from('agendamentos')
    .update({ status: 'pago', pago_em: agora })
    .in('id', ids)
    .eq('status', 'pendente');
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  // Atualiza também o pedido pai (senão o polling do cliente nunca confirma)
  if (chavePedido) {
    const { error: errPed } = await supabase.from('pedidos')
      .update({ status: 'pago', pago_em: agora, metodo_pagamento: 'pix' })
      .eq('chave_pedido', chavePedido)
      .eq('status', 'pendente');
    if (errPed) { _toastAdmin('Erro ao atualizar pedido: ' + errPed.message, 'erro'); return; }
  }
  _toastAdmin('✅ Marcados como pagos!', 'ok');
  carregarAgendamentos();
}

async function marcarGrupoComoAtendido(ids) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm(`Marcar ${ids.length} agendamento(s) como atendidos?`)) return;
  const { error } = await supabase.from('agendamentos')
    .update({ status: 'atendido', atendido_em: new Date().toISOString() })
    .in('id', ids);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  _toastAdmin('✅ Marcados como atendidos!', 'ok');
  carregarAgendamentos();
}

async function apagarAgendamento(id) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm('Apagar este agendamento permanentemente? Esta ação não pode ser desfeita.')) return;
  const ag = _agendamentosTodos.find(a => String(a.id) === String(id));
  const { error } = await supabase.from('agendamentos').delete().eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  await _devolverVagaEspecialSeAplicavel(ag);
  _toastAdmin('✅ Agendamento apagado.', 'ok');
  carregarAgendamentos();
}

// ============================================================
// WhatsApp
// ============================================================
function abrirWhatsApp(fone, nome, tipo, data, hora) {
  const numero = String(fone || '').replace(/\D/g,'');
  if (numero.length < 10) { _toastAdmin('WhatsApp do cliente não cadastrado.', 'aviso'); return; }
  // Considera 55 como DDI somente se o número tiver 12-13 dígitos (DDI + DDD + número).
  const dest = (numero.startsWith('55') && numero.length >= 12) ? numero : `55${numero}`;
  const horaTexto = (!hora || hora === '00:00') ? '' : ` até as ${hora}`;
  const msg = `Olá ${nome}! 😊\nRecebi seu pedido de ${tipo} para o dia ${data}${horaTexto}.\nEstá tudo confirmado! Combinaremos o horário por aqui. 🌙✨\nCocar Sagrado`;
  window.open(`https://wa.me/${dest}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ============================================================
// Exportar CSV
// ============================================================
async function exportarRelatorio() {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  const { data, error } = await supabase
    .from('agendamentos')
    .select('*, tipos_leitura(nome)')
    .order('data_agendamento', { ascending: false });

  if (error || !data) { _toastAdmin('Erro ao exportar relatório.', 'erro'); return; }

  const cols = ['Chave', 'Cliente', 'Nascimento', 'WhatsApp', 'Tipo', 'Data', 'Hora', 'Valor Original', 'Desconto', 'Valor Final', 'Status', 'Método Pag.', 'Pago em', 'Atendido em', 'Criado em'];
  const rows = data.map(a => [
    a.chave_pedido,
    a.cliente_nome,
    a.cliente_nascimento,
    a.cliente_whatsapp,
    a.tipos_leitura?.nome || '',
    a.data_agendamento,
    a.hora_agendamento?.slice(0,5) || '',
    a.valor_original,
    a.desconto_aplicado,
    a.valor_final,
    a.status,
    a.metodo_pagamento || '',
    a.pago_em || '',
    a.atendido_em || '',
    a.created_at,
  ].map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','));

  const csv  = [cols.join(','), ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `agendamentos_${_dataLocalISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// UI helpers
// ============================================================
function toggleDetalhes(header) {
  const det = header.nextElementSibling;
  if (!det) return;
  const aberto = det.classList.toggle('open');
  header.querySelector('span:last-child').textContent = aberto ? '▴' : '▾';
}

function formatarData(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function formatarDatetime(str) {
  const d = new Date(str);
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, "\\'")
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-atualizar')?.addEventListener('click', () => {
    clearInterval(_autoRefreshTimer); // sem isso cada clique acumulava um interval extra
    _autoRefreshTimer = null;
    carregarAgendamentos();
  });
  document.getElementById('btn-exportar')?.addEventListener('click', exportarRelatorio);
  document.getElementById('filtro-data')?.addEventListener('change', carregarAgendamentos);
  document.getElementById('filtro-terapeuta')?.addEventListener('change', carregarAgendamentos);
  document.getElementById('filtro-metodo')?.addEventListener('change', carregarAgendamentos);
  document.getElementById('adm-logout-btn')?.addEventListener('click', _fazerLogout);
  tornarMascoteArrastavel();
  // Trocar de tela (qualquer link da nav) re-sorteia a fala do mascote.
  document.querySelector('.adm-nav')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) setTimeout(falarMascote, 0);
  });
});
