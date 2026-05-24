/* ============================================================
   COCAR SAGRADO — Controle do Modal de Agendamento
   Depende de: agendamento-system.js (Estado, calcularPrecoFinal,
   _garantirTipos, carregarCalendario, MESES_PT)
   ============================================================ */

const _CHECKOUT_URL  = 'https://demxedudbislzausvhwx.supabase.co/functions/v1/infinitypay-checkout';
const MODAL_WISE     = 'cocarsagrado@gmail.com';

let _dadosPagamento = null;
let _calendarioOk   = false;

// ============================================================
// Abrir / Fechar
// ============================================================
function abrirModal(tipo) {
  if (tipo) Estado.tipoSelecionado = tipo;
  const overlay = document.getElementById('modalAgendamento');
  if (!overlay) return;
  // Salva foco pra restaurar depois
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.setAttribute('data-last-focus', '');
  }

  const obsGroup = document.getElementById('f-obs-group');
  if (obsGroup) {
    const n = (tipo && tipo.requerPergunta) ? _numeroDePerguntas(tipo) : 0;
    obsGroup.innerHTML = '';
    if (n === 0) {
      obsGroup.style.display = 'none';
    } else {
      obsGroup.style.display = '';
      for (let i = 1; i <= n; i++) {
        const id  = `f-obs-${i}`;
        const lbl = document.createElement('label');
        lbl.htmlFor    = id;
        lbl.textContent = n === 1 ? 'Pergunta/Questão *' : `Pergunta ${i} *`;
        const ta = document.createElement('textarea');
        ta.id          = id;
        ta.name        = `obs${i}`;
        ta.required    = true;
        ta.rows        = 3;
        ta.placeholder = n === 1
          ? 'Escreva sua pergunta ou questão para a leitura...'
          : `Escreva a pergunta ${i}...`;
        obsGroup.appendChild(lbl);
        obsGroup.appendChild(ta);
      }
    }
  }

  overlay.classList.add('open');
  document.body.classList.add('modal-aberto');
  overlay.querySelector('.modal-body')?.scrollTo({ top: 0 });
  irParaPasso(1);
}

function fecharModal() {
  const overlay = document.getElementById('modalAgendamento');
  overlay?.classList.remove('open');
  document.body.classList.remove('modal-aberto');
  // Restaura foco pro gatilho
  const trigger = document.querySelector('[data-last-focus]');
  if (trigger) { trigger.focus(); trigger.removeAttribute('data-last-focus'); }
  setTimeout(_resetarModal, 360);
}

function _resetarModal() {
  if (typeof Estado !== 'undefined') {
    Estado.tipoSelecionado = null;
    Estado.dataSelecionada = null;
  }
  _dadosPagamento = null;
  _calendarioOk   = false;

  document.getElementById('form-dados')?.reset();
  document.querySelectorAll('.ag-card.selected, .ag-day-card.selected, .ag-slot.selected, .ag-vagas-card.selected')
    .forEach(el => el.classList.remove('selected'));

  _mostrarTela(1, false);
  _irParaPassoBase && _irParaPassoBase(1);
}

// ============================================================
// Navegação entre as 2 telas
// ============================================================
function _syncOuterSteps(num) {
  ['modal-step-1', 'modal-step-2', 'modal-step-3'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i + 1 === num)  el.classList.add('active');
    if (i + 1 < num)    el.classList.add('done');
  });
}

function _mostrarTela(num, animacao) {
  if (animacao === undefined) animacao = true;

  const t1 = document.getElementById('telaAgendamento');
  const t2 = document.getElementById('telaPagamento');
  if (!t1 || !t2) return;

  t1.classList.remove('active', 'slide-esquerda');
  t2.classList.remove('active', 'slide-esquerda');

  if (num === 1) {
    if (animacao) t1.classList.add('slide-esquerda');
    t1.classList.add('active');
    // Sync outer step to whichever inner section is currently active
    const innerIdx = Array.from(document.querySelectorAll('.ag-section'))
      .findIndex(s => s.classList.contains('active'));
    _syncOuterSteps(innerIdx >= 0 ? innerIdx + 1 : 1);
  } else {
    t2.classList.add('active');
    _syncOuterSteps(3);
  }

  document.querySelector('#modalAgendamento .modal-body')
    ?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// Override: mostra tela 2 em vez de redirecionar
// ============================================================
window.redirecionarParaPagamento = function(chave) {
  const tipo  = Estado.tipoSelecionado;
  const { final } = calcularPrecoFinal(tipo.preco_original);
  const [mY, mM, mD] = Estado.dataSelecionada.split('-').map(Number);
  const d = new Date(mY, mM - 1, mD);

  const nascRaw = document.getElementById('f-nasc')?.value || '';
  const nascFmt = nascRaw
    ? (() => { const [y, m, dd] = nascRaw.split('-'); return `${dd}/${m}/${y}`; })()
    : '';

  _dadosPagamento = {
    chave,
    tipo:      tipo.nome,
    terapeuta: tipo.terapeuta || 'camila',
    data:      `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`,
    hora:      Estado.horarioSelecionado ? `até as ${Estado.horarioSelecionado.slice(0,5)}` : '',
    duracao:   tipo.duracao_minutos,
    valor:     final.toFixed(2).replace('.', ','),
    nome:       document.getElementById('f-nome').value.trim(),
    nascimento: nascFmt,
    obs:        _coletarObservacoes(tipo) || '',
    whatsapp:   (typeof obterWhatsappCompleto === 'function' ? obterWhatsappCompleto() : document.getElementById('f-fone').value.trim()),
  };

  sessionStorage.setItem('agendamento', JSON.stringify(_dadosPagamento));
  _salvarPedidoPendente(_dadosPagamento);

  try { localStorage.setItem('aceitouDesconto10', 'false'); } catch {}
  try { localStorage.setItem('cocarsagrado_comprou', 'true'); } catch {}

  _preencherTelaPagamento();
  _mostrarTela(2);
};

// ============================================================
// Persistência de pedido pendente (retomar / bloquear duplicado)
// ============================================================
const PENDENTE_KEY = 'cocarsagrado_pedidoPendente';
const PENDENTE_MAX_MS = 30 * 60 * 1000; // 30 min

function _salvarPedidoPendente(dados) {
  try {
    localStorage.setItem(PENDENTE_KEY, JSON.stringify({
      criadoEm: Date.now(),
      dados,
    }));
  } catch {}
}

function _lerPedidoPendente() {
  try {
    const raw = localStorage.getItem(PENDENTE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.dados?.chave) return null;
    if (Date.now() - (obj.criadoEm || 0) > PENDENTE_MAX_MS) {
      localStorage.removeItem(PENDENTE_KEY);
      return null;
    }
    return obj;
  } catch { return null; }
}

function _limparPedidoPendente() {
  try { localStorage.removeItem(PENDENTE_KEY); } catch {}
}

async function _checarStatusPedido(chave) {
  if (typeof supabase === 'undefined' || !supabase) return null;
  try {
    const { data } = await supabase
      .from('agendamentos')
      .select('status')
      .eq('chave_pedido', chave)
      .maybeSingle();
    return data?.status || null;
  } catch { return null; }
}

async function _verificarPedidoPendenteAoCarregar() {
  const pend = _lerPedidoPendente();
  if (!pend) return;
  const status = await _checarStatusPedido(pend.dados.chave);
  if (status === 'pago') {
    mostrarAlerta('✅ Pagamento do pedido ' + pend.dados.chave + ' confirmado!', 'success');
    _limparPedidoPendente();
  } else if (status === 'cancelado' || status === null) {
    _limparPedidoPendente();
  }
}

function _retomarPedidoPendente() {
  const pend = _lerPedidoPendente();
  if (!pend) return false;
  _dadosPagamento = pend.dados;
  const overlay = document.getElementById('modalAgendamento');
  overlay?.classList.add('open');
  document.body.classList.add('modal-aberto');
  _preencherTelaPagamento();
  _mostrarTela(2, false);
  return true;
}

window.retomarPedidoPendente = _retomarPedidoPendente;
window.descartarPedidoPendente = () => { _limparPedidoPendente(); mostrarAlerta('Pedido anterior descartado.', 'info'); };

function _ofereceRetomar(onContinuarNovo) {
  const pend = _lerPedidoPendente();
  if (!pend) { onContinuarNovo(); return; }
  const ag = pend.dados;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.style.zIndex = '10000';
  overlay.innerHTML = `
    <div class="modal-container" style="max-width:440px;">
      <div class="modal-body" style="padding:28px;">
        <h3 style="margin-top:0;">⏳ Você tem um pedido pendente</h3>
        <p style="margin:12px 0;"><strong>Pedido:</strong> ${ag.chave}<br><strong>Leitura:</strong> ${ag.tipo}<br><strong>Valor:</strong> R$ ${ag.valor}</p>
        <p style="font-size:.9rem;color:var(--cor-texto-suave);">Se você já fez o PIX ou está pagando, retome o pedido atual. Criar um novo vai gerar cobrança duplicada.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:18px;">
          <button class="ag-btn ag-btn-primary" id="_retomarBtn">📲 Retomar pedido pendente</button>
          <button class="ag-btn" id="_novoBtn" style="background:transparent;border:1px solid var(--border);">Cancelar e criar novo</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#_retomarBtn').addEventListener('click', () => {
    overlay.remove();
    _retomarPedidoPendente();
  });
  overlay.querySelector('#_novoBtn').addEventListener('click', () => {
    overlay.remove();
    _limparPedidoPendente();
    onContinuarNovo();
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// Intercept abrirSeletor (mantém função original)
if (typeof window.abrirSeletor === 'function') {
  const _abrirSeletorOrig = window.abrirSeletor;
  window.abrirSeletor = function(ref) {
    _ofereceRetomar(() => _abrirSeletorOrig(ref));
  };
}

// ============================================================
// Polling de status (detecta webhook de PIX/Cartão)
// ============================================================
let _pollTimer = null;
function _iniciarPollStatus() {
  _pararPollStatus();
  const chave = _dadosPagamento?.chave;
  if (!chave) return;
  const tick = async () => {
    const overlay = document.getElementById('modalAgendamento');
    const tela2 = document.getElementById('telaPagamento');
    if (!overlay?.classList.contains('open') || !tela2?.classList.contains('active')) {
      _pararPollStatus();
      return;
    }
    const status = await _checarStatusPedido(chave);
    if (status === 'pago') {
      _mostrarPagamentoConfirmado();
      _pararPollStatus();
    }
  };
  _pollTimer = setInterval(tick, 5000);
  document.addEventListener('visibilitychange', _onVisibilityCheck);
}

function _pararPollStatus() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  document.removeEventListener('visibilitychange', _onVisibilityCheck);
}

function _onVisibilityCheck() {
  if (document.visibilityState === 'visible' && _dadosPagamento?.chave) {
    _checarStatusPedido(_dadosPagamento.chave).then(s => {
      if (s === 'pago') { _mostrarPagamentoConfirmado(); _pararPollStatus(); }
    });
  }
}

function _mostrarPagamentoConfirmado() {
  ['pix', 'cartao'].forEach(m => {
    const sb = document.getElementById(`${m}-status-box`);
    if (sb) sb.style.display = 'block';
  });
  _limparPedidoPendente();
  mostrarAlerta('✅ Pagamento confirmado!', 'success');
}

function _preencherTelaPagamento() {
  const ag = _dadosPagamento;
  if (!ag) return;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('modal-chave-pedido', ag.chave);
  set('modal-r-tipo',       ag.tipo);
  set('modal-r-data',       ag.data);
  set('modal-r-hora',       ag.hora);
  set('modal-r-duracao',    `${ag.duracao} min`);
  set('modal-r-valor',      `R$ ${ag.valor}`);

  ['pix', 'cartao', 'wise'].forEach(m => set(`modal-valor-${m}`, `R$ ${ag.valor}`));
  ['cartao', 'pix'].forEach(m => {
    const lb = document.getElementById(`${m}-link-box`);
    const eb = document.getElementById(`${m}-erro-box`);
    const sb = document.getElementById(`${m}-status-box`);
    const gb = document.getElementById(`${m}-gerar-btn`);
    if (lb) lb.style.display = 'none';
    if (eb) eb.style.display = 'none';
    if (sb) sb.style.display = 'none';
    if (gb) {
      gb.disabled = false;
      gb.textContent = m === 'pix' ? '🔗 Gerar link PIX' : '🔗 Gerar link de pagamento';
    }
  });
  set('modal-email-wise', MODAL_WISE);

  trocarAbaPagamento('pix');
  _iniciarPollStatus();
}

// ============================================================
// Override: lazy-load calendário + scroll interno do modal
// ============================================================
const _irParaPassoBase = window.irParaPasso;

window.irParaPasso = function(num) {
  if (num === 1 && !_calendarioOk) {
    _calendarioOk = true;
    carregarCalendario();
  }
  _irParaPassoBase(num);
  _syncOuterSteps(num);
  document.querySelector('#modalAgendamento .modal-body')
    ?.scrollTo({ top: 0, behavior: 'smooth' });
};

// ============================================================
// Funções de pagamento
// ============================================================
function trocarAbaPagamento(metodo) {
  ['pix', 'cartao', 'wise'].forEach(m => {
    const tab    = document.getElementById(`modal-tab-${m}`);
    const painel = document.getElementById(`modal-painel-${m}`);
    const ativo  = m === metodo;
    tab?.classList.toggle('active', ativo);
    tab?.setAttribute('aria-selected', ativo);
    painel?.classList.toggle('active', ativo);
  });
  _atualizarPantero(metodo);
}

function _atualizarPantero(metodo) {
  const balao = document.getElementById('pag-pantero-balao');
  if (!balao) return;
  const msgs = {
    pix:    'Gere o link PIX, pague pelo seu banco e pronto — a confirmação chega automaticamente pra gente 🖤',
    cartao: 'Pague pelo checkout que abrir e pronto — a confirmação chega automaticamente pra gente 🖤',
    wise:   'Depois de fazer a transferência, volte para esta página e clique em <strong>"Avisar sobre pagamento Wise"</strong>.',
  };
  balao.innerHTML = msgs[metodo] || msgs.pix;
}

function _copiarTexto(texto, msg) {
  navigator.clipboard.writeText(texto)
    .then(() => mostrarAlerta(msg, 'success'))
    .catch(() => mostrarAlerta('Copie manualmente: ' + texto, 'info'));
}

function copiarChavePedido() { _copiarTexto(_dadosPagamento?.chave || '', '✅ Chave copiada!'); }
function copiarWiseModal()   { _copiarTexto(MODAL_WISE, '✅ E-mail Wise copiado!'); }

function avisarWhatsAppModal(metodo) {
  const ag = _dadosPagamento;
  if (!ag) return;

  const infoCliente = `*Nome:* ${ag.nome}\n*Nascimento:* ${ag.nascimento}${ag.obs ? `\n*Pergunta/Questão:* ${ag.obs}` : ''}`;
  const horaLinha = ag.hora ? `\n*Horário:* ${ag.hora}` : '';
  const msgs = {
    pix:    `Olá! 😊 Fiz o pagamento via *PIX*.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data}${horaLinha}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode confirmar o recebimento? Combinaremos o horário por aqui! 🙏`,
    cartao: `Olá! 😊 Gostaria de pagar via *cartão* meu agendamento.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data}${horaLinha}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode me enviar o link de pagamento? Combinaremos o horário por aqui! 🙏`,
    wise:   `Olá! 😊 Realizei a transferência via *Wise*.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data}${horaLinha}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode confirmar o recebimento? Combinaremos o horário por aqui! 🙏`,
  };

  const numero = WHATSAPP_TERAPEUTA[ag.terapeuta] || WHATSAPP_TERAPEUTA.camila;
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(msgs[metodo])}`, '_blank');
}

// ============================================================
// Setup de eventos globais
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('modalAgendamento');
  if (!overlay) return;

  // ESC fecha
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) fecharModal();
  });

  // Clique no backdrop fecha
  overlay.addEventListener('click', e => {
    if (e.target === overlay) fecharModal();
  });

  // Checa pedido pendente ao carregar (atualiza se foi pago via webhook)
  setTimeout(_verificarPedidoPendenteAoCarregar, 1500);
});

// ============================================================
// InfinityPay — geração de link de pagamento por cartão
// ============================================================
async function gerarLinkCartao() {
  const ag = _dadosPagamento;
  if (!ag) return;
  const btn     = document.getElementById('cartao-gerar-btn');
  const linkBox = document.getElementById('cartao-link-box');
  const erroBox = document.getElementById('cartao-erro-box');
  btn.disabled = true;
  btn.textContent = '⏳ Gerando...';
  linkBox.style.display = 'none';
  erroBox.style.display = 'none';
  try {
    const res = await fetch(_CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: ag.chave, tipo: ag.tipo, valor: ag.valor, nome: ag.nome, whatsapp: ag.whatsapp }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error();
    document.getElementById('cartao-link-btn').href = data.url;
    linkBox.style.display = 'block';
    btn.textContent = '🔄 Gerar novo link';
    btn.disabled = false;
  } catch {
    erroBox.textContent = 'Não foi possível gerar o link. Tente novamente.';
    erroBox.style.display = 'block';
    btn.textContent = '🔗 Gerar link de pagamento';
    btn.disabled = false;
  }
}
window.gerarLinkCartao = gerarLinkCartao;

async function gerarLinkPix() {
  const ag = _dadosPagamento;
  if (!ag) return;
  const btn     = document.getElementById('pix-gerar-btn');
  const linkBox = document.getElementById('pix-link-box');
  const erroBox = document.getElementById('pix-erro-box');
  btn.disabled = true;
  btn.textContent = '⏳ Gerando...';
  linkBox.style.display = 'none';
  erroBox.style.display = 'none';
  try {
    const res = await fetch(_CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: ag.chave, tipo: ag.tipo, valor: ag.valor, nome: ag.nome, whatsapp: ag.whatsapp, methods: ['pix'] }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error();
    document.getElementById('pix-link-btn').href = data.url;
    linkBox.style.display = 'block';
    btn.textContent = '🔄 Gerar novo link PIX';
    btn.disabled = false;
  } catch {
    erroBox.textContent = 'Não foi possível gerar o link PIX. Tente novamente.';
    erroBox.style.display = 'block';
    btn.textContent = '🔗 Gerar link PIX';
    btn.disabled = false;
  }
}
window.gerarLinkPix = gerarLinkPix;
