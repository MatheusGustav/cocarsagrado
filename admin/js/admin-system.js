/* ============================================================
   COCAR SAGRADO — Painel Admin
   ============================================================ */

// Lista padrão de terapeutas; sobrescrita pela config 'terapeutas' no banco
// (configuracoes.valor = [{id, nome, whatsapp}]) quando existir. O CHECK de
// terapeuta nas tabelas continua valendo — gente nova ainda exige migration.
let _TERAPEUTAS = [
  { id: 'matheus', nome: 'Matheus', whatsapp: '5528999476620' },
  { id: 'camila',  nome: 'Camila',  whatsapp: '5527998528483' },
];

function listaTerapeutas() { return _TERAPEUTAS; }
function terapeutaNome(id) { return _TERAPEUTAS.find(t => t.id === id)?.nome || id || ''; }

async function _carregarTerapeutas() {
  try {
    const { data } = await supabase
      .from('configuracoes').select('valor').eq('chave', 'terapeutas').maybeSingle();
    if (Array.isArray(data?.valor) && data.valor.length) {
      _TERAPEUTAS = data.valor.filter(t => t?.id && t?.nome);
    }
  } catch { /* mantém os padrões */ }
  _popularFiltroTerapeuta();
}

function _popularFiltroTerapeuta() {
  const sel = document.getElementById('filtro-terapeuta');
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' +
    _TERAPEUTAS.map(t => `<option value="${escapeAttr(t.id)}">${_esc(t.nome)}</option>`).join('');
  sel.value = atual;
}

let _agendamentosTodos = [];
let _lancamentosStats  = [];   // lançamentos manuais (p/ o card "Faturado no mês")
let _statusAtivo       = 'pendente';
let _buscaTexto        = '';
let _janelaDias        = 90;   // janela de busca; 0 = sem corte (tudo)
let _primeiroLoad      = true;
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
  document.getElementById('adm-esqueci-senha')?.addEventListener('click', _enviarResetSenha);
  document.getElementById('adm-reset-btn')?.addEventListener('click', _salvarNovaSenha);

  // Link de recuperação do e-mail abre o painel com este evento
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') _mostrarTelaReset();
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
  _carregarTerapeutas();
  if (typeof _abrirSecaoInicial === 'function') {
    _abrirSecaoInicial();   // abre a seção do hash (#agendamentos, #vagas, ...)
  } else {
    carregarAgendamentos();
  }
}

// ============================================================
// Recuperação de senha
// ============================================================
async function _enviarResetSenha() {
  const email   = document.getElementById('adm-email')?.value?.trim();
  const errorEl = document.getElementById('adm-login-error');
  const btn     = document.getElementById('adm-esqueci-senha');
  if (!errorEl) return;
  errorEl.style.color = '';
  if (!email) {
    errorEl.textContent = 'Preencha o e-mail acima e clique de novo para receber o link.';
    errorEl.style.display = 'block';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname,
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Esqueci minha senha'; }
  if (error) {
    errorEl.textContent = 'Erro ao enviar: ' + error.message;
  } else {
    errorEl.style.color = '#93AC8F';
    errorEl.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-check"></use></svg> Link de redefinição enviado! Confira seu e-mail.';
  }
  errorEl.style.display = 'block';
}

function _mostrarTelaReset() {
  document.getElementById('adm-login-screen').style.display = 'flex';
  document.getElementById('admin-content').style.display    = 'none';
  document.getElementById('adm-login-form').style.display   = 'none';
  document.getElementById('adm-esqueci-senha').style.display = 'none';
  document.getElementById('adm-mfa').style.display          = 'none';
  document.getElementById('adm-reset').style.display        = 'block';
}

async function _salvarNovaSenha() {
  const senha = document.getElementById('adm-reset-senha')?.value || '';
  const err   = document.getElementById('adm-reset-error');
  const btn   = document.getElementById('adm-reset-btn');
  if (err) err.style.display = 'none';
  if (senha.length < 8) {
    if (err) { err.textContent = 'A senha precisa de pelo menos 8 caracteres.'; err.style.display = 'block'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (btn) { btn.disabled = false; btn.textContent = 'Salvar nova senha'; }
  if (error) {
    if (err) { err.textContent = 'Erro: ' + error.message; err.style.display = 'block'; }
    return;
  }
  document.getElementById('adm-reset').style.display        = 'none';
  document.getElementById('adm-login-form').style.display   = '';
  document.getElementById('adm-esqueci-senha').style.display = '';
  await _avaliarSessao();
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
      qr.innerHTML = '<p style="color:#D2BA7C;font-size:.8rem;max-width:200px;text-align:center;">' +
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
  // Garante que o card volte ao formulário de senha (esconde MFA e reset).
  const form  = document.getElementById('adm-login-form');
  const mfa   = document.getElementById('adm-mfa');
  const reset = document.getElementById('adm-reset');
  const link  = document.getElementById('adm-esqueci-senha');
  if (form)  form.style.display  = '';
  if (mfa)   mfa.style.display   = 'none';
  if (reset) reset.style.display = 'none';
  if (link)  link.style.display  = '';
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

// Ícone do toast sai do tipo, não da mensagem — nenhuma string precisa
// carregar símbolo e o texto continua entrando como texto puro.
// Também usado por vagas-admin.js e vagas-especial-admin.js, que carregam
// depois deste arquivo em dashboard.html — não inverta a ordem das <script>.
const ICO_TOAST = { ok: 'check-circulo', erro: 'alerta', info: 'info' };

function _toastAdmin(msg, tipo) {
  const t = document.createElement('div');
  t.className = 'adm-toast adm-toast--' + (tipo || 'info');
  t.innerHTML = `<svg class="ico adm-toast-ico" aria-hidden="true"><use href="#ico-${ICO_TOAST[tipo] || 'info'}"></use></svg>`;
  t.appendChild(document.createTextNode(msg));
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
function _montarQueryAgendamentos() {
  const filtroData      = document.getElementById('filtro-data')?.value      || '';
  const filtroTerapeuta = document.getElementById('filtro-terapeuta')?.value || '';
  const filtroMetodo    = document.getElementById('filtro-metodo')?.value    || '';

  let query = supabase
    .from('agendamentos')
    .select('*, tipos_leitura(nome)')
    .order('data_agendamento', { ascending: false })
    .order('hora_agendamento', { ascending: false });

  if (filtroData) {
    query = query.eq('data_agendamento', filtroData);
  } else if (_janelaDias > 0) {
    const corte = new Date();
    corte.setDate(corte.getDate() - _janelaDias);
    query = query.gte('data_agendamento', _dataLocalISO(corte));
  }
  if (filtroTerapeuta) query = query.eq('terapeuta', filtroTerapeuta);
  if (filtroMetodo === '__null') query = query.is('metodo_pagamento', null);
  else if (filtroMetodo)        query = query.eq('metodo_pagamento', filtroMetodo);

  return query;
}

function _skeletonHTML() {
  return `<div class="adm-skeleton-item">
    <div class="adm-skeleton-bar adm-skeleton-bar--lg"></div>
    <div class="adm-skeleton-bar adm-skeleton-bar--md"></div>
    <div class="adm-skeleton-bar adm-skeleton-bar--sm"></div>
  </div>`.repeat(3);
}

// Lançamentos manuais dos últimos ~12 meses (entram no card de faturamento).
// Falha silenciosa: sem dado, o card mostra só as leituras.
async function _carregarLancamentosStats() {
  try {
    const inicio = new Date();
    inicio.setDate(1);
    inicio.setMonth(inicio.getMonth() - 11);
    const { data, error } = await supabase
      .from('lancamentos_financeiros')
      .select('valor, data, terapeuta')
      .gte('data', _dataLocalISO(inicio));
    if (error) return [];
    return data || [];
  } catch { return []; }
}

// Única função de carga: o primeiro load mostra skeleton; recargas
// (realtime, auto-refresh, ações) renderizam por cima, sem flicker.
async function carregarAgendamentos(opts = {}) {
  if (!_admAutenticado) return;
  const lista = document.getElementById('lista-agendamentos');
  if (!lista) return;

  if (_primeiroLoad) lista.innerHTML = _skeletonHTML();

  // Agendamentos + lançamentos manuais em paralelo (lançamentos entram no
  // card "Faturado no mês", igual ao Financeiro).
  const [{ data, error }, lancs] = await Promise.all([
    _montarQueryAgendamentos(),
    _carregarLancamentosStats(),
  ]);

  if (error) {
    if (!opts.silencioso) lista.innerHTML = '<div class="ag-empty">Erro ao carregar agendamentos.</div>';
    console.error(error);
    return;
  }

  _primeiroLoad = false;
  _agendamentosTodos = data || [];
  _lancamentosStats  = lancs || [];
  calcularEstatisticas(_agendamentosTodos);
  _atualizarContadoresPills(_agendamentosTodos);
  _renderizarListaFiltrada();
  _renderizarSemanaStrip();
  _atualizarCarregarMais();

  _iniciarRealtime();
  _iniciarAutoRefresh();
}

// Pill de status + busca textual aplicados em memória
function _filtrarLocal() {
  let lista = _agendamentosTodos;
  if (_statusAtivo) {
    lista = _statusAtivo === 'pago'
      ? lista.filter(a => ['pago', 'confirmado'].includes(a.status)) // contador da pill soma os dois
      : lista.filter(a => a.status === _statusAtivo);
  }
  if (_buscaTexto) {
    const q    = _buscaTexto.toLowerCase();
    const qDig = q.replace(/\D/g, '');
    lista = lista.filter(a =>
      (a.cliente_nome || '').toLowerCase().includes(q) ||
      (a.chave_pedido || '').toLowerCase().includes(q) ||
      (qDig.length >= 4 && (a.cliente_whatsapp || '').replace(/\D/g, '').includes(qDig))
    );
  }
  return lista;
}

function _renderizarListaFiltrada() {
  const lista = document.getElementById('lista-agendamentos');
  if (lista) renderizarAgendamentos(_filtrarLocal(), lista);
}

function filtrarPorPill(status) {
  _statusAtivo = status;
  document.querySelectorAll('.adm-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.status === status);
  });
  _renderizarListaFiltrada();
}

function limparFiltros() {
  _statusAtivo = '';
  _buscaTexto  = '';
  ['filtro-busca', 'filtro-data', 'filtro-terapeuta', 'filtro-metodo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.adm-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.status === '');
  });
  carregarAgendamentos();
}

function statCardHoje() {
  const el = document.getElementById('filtro-data');
  if (el) el.value = _dataLocalISO();
  filtrarPorPill('');
  carregarAgendamentos();
}

function _atualizarContadoresPills(todos) {
  const c = {};
  todos.forEach(a => { c[a.status] = (c[a.status] || 0) + 1; });
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? 0; };
  set('pill-count-todos',     todos.length);
  set('pill-count-pendente',  c.pendente || 0);
  set('pill-count-pago',      (c.pago || 0) + (c.confirmado || 0));
  set('pill-count-atendido',  c.atendido || 0);
  set('pill-count-cancelado', c.cancelado || 0);
}

// ============================================================
// Strip da semana — ocupação dos próximos 7 dias (query própria,
// independente do filtro de data; respeita o filtro de terapeuta)
// ============================================================
async function _renderizarSemanaStrip() {
  const wrap = document.getElementById('adm-semana-strip');
  if (!wrap) return;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const fim = new Date(hoje);
  fim.setDate(hoje.getDate() + 6);

  let query = supabase
    .from('agendamentos')
    .select('data_agendamento, status')
    .gte('data_agendamento', _dataLocalISO(hoje))
    .lte('data_agendamento', _dataLocalISO(fim));
  const filtroTerapeuta = document.getElementById('filtro-terapeuta')?.value || '';
  if (filtroTerapeuta) query = query.eq('terapeuta', filtroTerapeuta);

  const { data, error } = await query;
  if (error) return;

  const porDia = {};
  (data || []).forEach(a => {
    if (a.status === 'cancelado') return;
    porDia[a.data_agendamento] = (porDia[a.data_agendamento] || 0) + 1;
  });

  const filtroAtual = document.getElementById('filtro-data')?.value || '';
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    const iso = _dataLocalISO(d);
    const qtd = porDia[iso] || 0;
    const cls = ['adm-semana-chip'];
    if (i === 0)            cls.push('adm-semana-chip--hoje');
    if (filtroAtual === iso) cls.push('adm-semana-chip--ativa');
    html += `<button type="button" class="${cls.join(' ')}" onclick="filtrarPorDia('${iso}')" title="Ver agendamentos do dia">
      <span class="adm-semana-dia">${DIAS_SEMANA_PT[d.getDay()].slice(0, 3)}</span>
      <span class="adm-semana-num">${d.getDate()}</span>
      <span class="adm-semana-qtd"><strong>${qtd}</strong> leitura${qtd === 1 ? '' : 's'}</span>
    </button>`;
  }
  wrap.innerHTML = html;
}

// Clicar num dia filtra por ele; clicar de novo desliga o filtro.
function filtrarPorDia(iso) {
  const el = document.getElementById('filtro-data');
  if (!el) return;
  el.value = el.value === iso ? '' : iso;
  carregarAgendamentos();
}

function _atualizarCarregarMais() {
  const wrap = document.getElementById('adm-carregar-mais');
  const info = document.getElementById('adm-janela-info');
  if (!wrap) return;
  const filtroData = document.getElementById('filtro-data')?.value || '';
  const ativo = _janelaDias > 0 && !filtroData;
  wrap.style.display = ativo ? 'flex' : 'none';
  if (info) info.textContent = ativo ? `Mostrando os últimos ${_janelaDias} dias.` : '';
}

// ============================================================
// Realtime — webhook Mercado Pago marca pago -> painel atualiza
// ============================================================
function _agendarRefresh() {
  clearTimeout(_refreshDebounce);
  _refreshDebounce = setTimeout(() => {
    if (_admAutenticado) carregarAgendamentos({ silencioso: true });
  }, 400);
}

function _setRealtimeStatus(ok, txt) {
  const el = document.getElementById('adm-realtime');
  const t  = document.getElementById('adm-realtime-txt');
  if (!el) return;
  el.classList.toggle('adm-realtime--on',  ok === true);
  el.classList.toggle('adm-realtime--off', ok === false);
  if (t) t.textContent = txt;
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
          _toastAdmin('Pagamento confirmado: ' + (novo.cliente_nome || 'cliente'), 'ok');
        }
        _agendarRefresh();
      })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        _setRealtimeStatus(true, 'ao vivo');
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        _setRealtimeStatus(false, 'desconectado');
      }
    });
}

function _pararRealtime() {
  if (!_realtimeChannel) return;
  supabase.removeChannel(_realtimeChannel);
  _realtimeChannel = null;
  _setRealtimeStatus(false, 'desconectado');
}

function _iniciarAutoRefresh() {
  if (_autoRefreshTimer) return;
  _autoRefreshTimer = setInterval(() => carregarAgendamentos({ silencioso: true }), 2 * 60 * 1000);
}

// ============================================================
// Estatísticas
// ============================================================
function _dataLocalISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Os cards refletem a lista carregada (acompanham os filtros da tela).
// Com um dia filtrado, o card de faturamento diz o dia no rótulo.
function calcularEstatisticas(todos) {
  const hoje = _dataLocalISO();

  const agendamentosHoje  = todos.filter(a => a.data_agendamento === hoje).length;
  const pendentes         = todos.filter(a => a.status === 'pendente').length;
  const pagos             = todos.filter(a => ['pago','confirmado','atendido'].includes(a.status)).length;
  const leiturasPendentes = todos.filter(a => ['pago','confirmado'].includes(a.status)).length;

  const filtroData = document.getElementById('filtro-data')?.value || '';
  const pago = (a) => ['pago','confirmado','atendido'].includes(a.status);
  let rotuloTotal, total;
  if (filtroData) {
    const [, m, d] = filtroData.split('-');
    rotuloTotal = `Faturado em ${d}/${m}`;
    total = todos.filter(a => a.data_agendamento === filtroData && pago(a))
      .reduce((acc, a) => acc + Number(a.valor_final || 0), 0);
  } else {
    rotuloTotal = 'Faturado no mês';
    const mesAtual = hoje.slice(0, 7);
    total = todos.filter(a => a.data_agendamento?.startsWith(mesAtual) && pago(a))
      .reduce((acc, a) => acc + Number(a.valor_final || 0), 0);
  }

  // Soma os lançamentos manuais do período (avulsos somam, despesas são
  // negativas e subtraem) — alinha o card ao total do Financeiro.
  // Respeita os filtros da tela: terapeuta filtra lançamentos também; com
  // filtro de método de pagamento, lançamentos não entram (não têm método).
  const filtroTerapeuta = document.getElementById('filtro-terapeuta')?.value || '';
  const filtroMetodo    = document.getElementById('filtro-metodo')?.value    || '';
  if (!filtroMetodo) {
    total += (_lancamentosStats || [])
      .filter(l => filtroData ? l.data === filtroData : (l.data || '').startsWith(hoje.slice(0, 7)))
      .filter(l => !filtroTerapeuta || l.terapeuta === filtroTerapeuta)
      .reduce((acc, l) => acc + Number(l.valor || 0), 0);
  }

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-hoje',    agendamentosHoje);
  set('stat-pendente',pendentes);
  set('stat-pagos',   pagos);
  set('stat-total',   `R$ ${total.toFixed(2).replace('.', ',')}`);
  set('stat-total-label', rotuloTotal);
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
    const temFiltro = !!(_statusAtivo || _buscaTexto ||
      document.getElementById('filtro-data')?.value ||
      document.getElementById('filtro-terapeuta')?.value ||
      document.getElementById('filtro-metodo')?.value);
    container.innerHTML = `<div class="ag-empty">Nenhum agendamento encontrado.${
      temFiltro
        ? '<div class="adm-empty-acoes"><button class="ag-btn ag-btn-outline ag-btn-sm" onclick="limparFiltros()"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg> Limpar filtros</button></div>'
        : ''
    }</div>`;
    return;
  }
  container.innerHTML = '';
  const itens = _agruparPorPedido(lista);
  const porTerapeuta = _statusAtivo === 'pendente' || _statusAtivo === 'pago';
  if (porTerapeuta) {
    const ordemIds = _TERAPEUTAS.map(t => t.id);
    const idxTerapeuta = item => {
      const id = (item.tipo === 'grupo' ? item.ags[0] : item.ag).terapeuta || '';
      const i = ordemIds.indexOf(id);
      return id ? (i === -1 ? ordemIds.length : i) : ordemIds.length + 1; // sem terapeuta por último
    };
    // Estável: mantém a ordem por data (já vinda da query) e só reagrupa por terapeuta dentro de cada dia.
    itens.sort((a, b) => {
      if (a.data_agendamento !== b.data_agendamento) return 0;
      return idxTerapeuta(a) - idxTerapeuta(b);
    });
  }
  let dataAtual = null;
  let terapeutaAtual = undefined;
  itens.forEach(item => {
    if (item.data_agendamento !== dataAtual) {
      dataAtual = item.data_agendamento;
      terapeutaAtual = undefined;
      const divisor = document.createElement('div');
      divisor.className = 'adm-divisor-dia';
      divisor.innerHTML = `<span>${_esc(_rotuloDivisor(dataAtual))}</span>`;
      container.appendChild(divisor);
    }
    if (porTerapeuta) {
      const idTerapeuta = (item.tipo === 'grupo' ? item.ags[0] : item.ag).terapeuta || '';
      if (idTerapeuta !== terapeutaAtual) {
        terapeutaAtual = idTerapeuta;
        const nome = idTerapeuta ? terapeutaNome(idTerapeuta) : 'Sem terapeuta';
        const subdivisor = document.createElement('div');
        subdivisor.className = 'adm-divisor-terapeuta';
        subdivisor.innerHTML = `<span>${_esc(nome)}</span>`;
        container.appendChild(subdivisor);
      }
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
  const nomeTerapeuta   = ag.terapeuta ? terapeutaNome(ag.terapeuta) : '';
  const badgeTerapeuta  = nomeTerapeuta ? `<span class="adm-badge adm-badge-terapeuta">${_esc(nomeTerapeuta)}</span>` : '';

  // Complemento: pergunta adicional comprada depois, vinculada à leitura
  // original (leitura_origem_id). Não ocupa vaga — é a mesma sessão.
  const ehAdicao    = !!ag.leitura_origem_id;
  const badgeAdicao = ehAdicao
    ? `<span class="adm-badge adm-badge-adicao" title="Pergunta adicional comprada depois — responder junto com a leitura original"><svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> pergunta adicional</span>`
    : '';

  const acoes = montarAcoes(ag);

  item.innerHTML = `
    <div class="adm-item-header" onclick="toggleDetalhes(this)">
      <div class="adm-item-info">
        <h4>${_esc(ag.cliente_nome)}</h4>
        <p>${_esc(nomeTipo)} — ${_esc(data)} ${_esc(horaLabel)}</p>
      </div>
      <div class="adm-item-right">
        <span style="font-weight:700; color:var(--primary)">${_esc(valor)}</span>
        ${badgeAdicao}
        ${badgeTerapeuta}
        ${badge}
        <span class="adm-chevron" style="color:var(--text-muted)"><svg class="ico" aria-hidden="true"><use href="#ico-chevron-baixo"></use></svg></span>
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
        ${ehAdicao ? `<div class="adm-detail-item"><label>Adição à leitura</label><span>#${_esc(ag.leitura_origem_id)}${ag.num_perguntas ? ` · +${_esc(ag.num_perguntas)} pergunta${ag.num_perguntas > 1 ? 's' : ''}` : ''}</span></div>` : ''}
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
    const terapeuta  = ag.terapeuta ? terapeutaNome(ag.terapeuta) : '—';
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
        <span class="adm-chevron" style="color:var(--text-muted)"><svg class="ico" aria-hidden="true"><use href="#ico-chevron-baixo"></use></svg></span>
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
    html += `<button class="ag-btn ag-btn-primary ag-btn-sm" onclick="marcarGrupoComoPago(${JSON.stringify(ids)},'${escapeAttr(ags[0].chave_pedido || '')}')"><svg class="ico" aria-hidden="true"><use href="#ico-check"></use></svg> Marcar todos como Pagos</button>`;
  }
  if (temPago) {
    html += `<button class="ag-btn ag-btn-secondary ag-btn-sm" onclick="marcarGrupoComoAtendido(${JSON.stringify(ids)})"><svg class="ico" aria-hidden="true"><use href="#ico-lua"></use></svg> Marcar todos como Atendidos</button>`;
  }

  const comFone = ags.find(a => a.cliente_whatsapp?.replace(/\D/g, '').length >= 10);
  if (comFone) {
    const fone = comFone.cliente_whatsapp;
    const nome = comFone.cliente_nome || '';
    const qtd  = ags.length;
    const data = formatarData(ags[0].data_agendamento);
    html += `<button class="ag-btn ag-btn-whatsapp ag-btn-sm" onclick="abrirWhatsApp('${escapeAttr(fone)}','${escapeAttr(nome)}','pedido com ${qtd} leituras','${escapeAttr(data)}','')"><svg class="ico" aria-hidden="true"><use href="#ico-balao"></use></svg> WhatsApp</button>`;
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
    html += `<button class="ag-btn ag-btn-primary ag-btn-sm" onclick="marcarComoPago('${id}','${escapeAttr(ag.chave_pedido||'')}')"><svg class="ico" aria-hidden="true"><use href="#ico-check"></use></svg> Marcar como Pago</button>`;
    html += `<button class="ag-btn ag-btn-danger ag-btn-sm" onclick="apagarAgendamento('${id}')"><svg class="ico" aria-hidden="true"><use href="#ico-lixeira"></use></svg> Apagar</button>`;
  }
  if (['pago','confirmado'].includes(ag.status)) {
    html += `<button class="ag-btn ag-btn-secondary ag-btn-sm" onclick="marcarComoAtendido('${id}')"><svg class="ico" aria-hidden="true"><use href="#ico-lua"></use></svg> Marcar como Atendido</button>`;
  }
  if (ag.status !== 'cancelado' && ag.status !== 'atendido') {
    html += `<button class="ag-btn ag-btn-danger ag-btn-sm" onclick="cancelarAgendamento('${id}')"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg> Cancelar</button>`;
  }

  if (fone.replace(/\D/g,'').length >= 10) {
    html += `<button class="ag-btn ag-btn-whatsapp ag-btn-sm" onclick="abrirWhatsApp('${escapeAttr(fone)}','${escapeAttr(nome)}','${escapeAttr(tipo)}','${escapeAttr(data)}','${escapeAttr(horaBtn)}')"><svg class="ico" aria-hidden="true"><use href="#ico-balao"></use></svg> WhatsApp</button>`;
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
  _toastAdmin('Pedido marcado como pago!', 'ok');
  carregarAgendamentos();
}

async function marcarComoAtendido(id) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm('Marcar agendamento como atendido?')) return;
  const { error } = await supabase.from('agendamentos').update({ status: 'atendido', atendido_em: new Date().toISOString() }).eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  _toastAdmin('Marcado como atendido!', 'ok');
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
  _toastAdmin('Agendamento cancelado.', 'ok');
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
  _toastAdmin('Marcados como pagos!', 'ok');
  carregarAgendamentos();
}

async function marcarGrupoComoAtendido(ids) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm(`Marcar ${ids.length} agendamento(s) como atendidos?`)) return;
  const { error } = await supabase.from('agendamentos')
    .update({ status: 'atendido', atendido_em: new Date().toISOString() })
    .in('id', ids);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  _toastAdmin('Marcados como atendidos!', 'ok');
  carregarAgendamentos();
}

async function apagarAgendamento(id) {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  if (!confirm('Apagar este agendamento permanentemente? Esta ação não pode ser desfeita.')) return;
  const ag = _agendamentosTodos.find(a => String(a.id) === String(id));
  const { error } = await supabase.from('agendamentos').delete().eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  await _devolverVagaEspecialSeAplicavel(ag);
  _toastAdmin('Agendamento apagado.', 'ok');
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

// Exporta a agenda de contatos (nome + WhatsApp únicos) — backup dos
// clientes. Une pedidos + agendamentos (clientes antigos podem existir
// só em agendamentos, de antes do sistema de pedidos); dedup pelo
// número normalizado.
async function exportarContatos() {
  if (!_admAutenticado) { _mostrarLogin(); return; }
  const [{ data: peds, error: e1 }, { data: ags, error: e2 }] = await Promise.all([
    supabase.from('pedidos').select('cliente_nome, cliente_whatsapp, criado_em'),
    supabase.from('agendamentos').select('cliente_nome, cliente_whatsapp, criado_em'),
  ]);

  if ((e1 && e2) || (!peds && !ags)) { _toastAdmin('Erro ao exportar contatos.', 'erro'); return; }

  const data = [...(peds || []), ...(ags || [])]
    .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));

  // Dedup pelo número (só dígitos); mantém o registro mais recente
  const vistos = new Map();
  data.forEach(p => {
    const k = String(p.cliente_whatsapp || '').replace(/\D/g, '');
    if (!k || vistos.has(k)) return;
    vistos.set(k, p);
  });

  const contatos = [...vistos.values()]
    .sort((a, b) => String(a.cliente_nome).localeCompare(String(b.cliente_nome), 'pt-BR'));

  const cols = ['Nome', 'WhatsApp', 'Último pedido em'];
  const rows = contatos.map(p => [
    p.cliente_nome,
    p.cliente_whatsapp,
    (p.criado_em || '').slice(0, 10),
  ].map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','));

  const csv  = [cols.join(','), ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `contatos_clientes_${_dataLocalISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  _toastAdmin(`${contatos.length} contato${contatos.length === 1 ? '' : 's'} exportado${contatos.length === 1 ? '' : 's'}!`, 'ok');
}

// ============================================================
// UI helpers
// ============================================================
// Botão que pisca um estado ("Salvo", "Erro") e volta ao normal.
// Ícone + texto ficam aqui para nenhum lugar reconstruir o rótulo na mão.
const _ESTADO_BTN = {
  salvar:   ['guardar',   'Salvar'],
  salvando: ['ampulheta', 'Salvando…'],
  salvo:    ['check',     'Salvo'],
  erro:     ['alerta',    'Erro'],
};
function _admBtnEstado(btn, estado) {
  if (!btn) return;
  const [nome, txt] = _ESTADO_BTN[estado] || _ESTADO_BTN.salvar;
  btn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#ico-${nome}"></use></svg> ${txt}`;
}

function toggleDetalhes(header) {
  const det = header.nextElementSibling;
  if (!det) return;
  const aberto = det.classList.toggle('open');
  const seta = header.querySelector('.adm-chevron use');
  if (seta) seta.setAttribute('href', aberto ? '#ico-chevron-cima' : '#ico-chevron-baixo');
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
  // Valor vai para dentro de onclick="fn('...')": escapa as DUAS camadas —
  // string JS entre aspas simples E atributo HTML entre aspas duplas.
  // A barra invertida PRECISA vir primeiro: senão um '\' no fim do valor
  // consome o \' e permite breakout da string JS → XSS armazenado (ex.: nome
  // de cliente malicioso executando no painel autenticado do admin).
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, "\\'")
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ');
}

// ============================================================
// Init
// ============================================================
let _buscaDebounce = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-atualizar')?.addEventListener('click', () => carregarAgendamentos());
  document.getElementById('btn-exportar')?.addEventListener('click', exportarRelatorio);
  document.getElementById('btn-exportar-contatos')?.addEventListener('click', exportarContatos);
  document.getElementById('filtro-data')?.addEventListener('change', () => carregarAgendamentos());
  document.getElementById('filtro-terapeuta')?.addEventListener('change', () => carregarAgendamentos());
  document.getElementById('filtro-metodo')?.addEventListener('change', () => carregarAgendamentos());
  document.getElementById('filtro-busca')?.addEventListener('input', (e) => {
    clearTimeout(_buscaDebounce);
    _buscaDebounce = setTimeout(() => {
      _buscaTexto = e.target.value.trim();
      _renderizarListaFiltrada();
    }, 200);
  });
  document.getElementById('btn-carregar-antigos')?.addEventListener('click', () => {
    // 90 -> 270 -> 450 -> ... até 2 anos; depois carrega tudo (0 = sem corte)
    _janelaDias = _janelaDias + 180 > 730 ? 0 : _janelaDias + 180;
    carregarAgendamentos();
  });
  document.getElementById('adm-logout-btn')?.addEventListener('click', _fazerLogout);
});
