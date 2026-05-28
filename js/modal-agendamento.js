/* ============================================================
   COCAR SAGRADO — Controle do Modal de Agendamento
   Depende de: agendamento-system.js (Estado, calcularPrecoFinal,
   _garantirTipos, carregarCalendario, MESES_PT)
   ============================================================ */

const MODAL_WISE        = 'matheus7gustav@gmail.com';
const _IP_CHECKOUT_URL  = 'https://demxedudbislzausvhwx.supabase.co/functions/v1/infinitypay-checkout';

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

  // Se já tem dados pessoais ou itens no carrinho, pula section 0
  const passoInicial = (Estado.dadosPessoais.nome || Estado.carrinho.length > 0) ? 1 : 0;
  irParaPasso(passoInicial);
  _atualizarBotaoRetomar();
}

function fecharModal() {
  const overlay = document.getElementById('modalAgendamento');
  overlay?.classList.remove('open');
  document.body.classList.remove('modal-aberto');
  // Restaura foco pro gatilho
  const trigger = document.querySelector('[data-last-focus]');
  if (trigger) { trigger.focus(); trigger.removeAttribute('data-last-focus'); }
  setTimeout(_resetarModal, 360);
  _atualizarBotaoRetomar();
}

function _resetarModal() {
  if (typeof Estado !== 'undefined') {
    // Preserva carrinho e dadosPessoais entre aberturas (multi-leitura)
    Estado.tipoSelecionado = null;
    Estado.dataSelecionada = null;
    Estado.horarioSelecionado = null;
  }
  _dadosPagamento = null;
  _calendarioOk   = false;

  document.getElementById('form-dados')?.reset();
  document.querySelectorAll('.ag-card.selected, .ag-day-card.selected, .ag-slot.selected, .ag-vagas-card.selected')
    .forEach(el => el.classList.remove('selected'));

  _mostrarTela(1, false);

  // Volta para o passo adequado
  if (Estado?.dadosPessoais?.nome) {
    _irParaPassoBase && _irParaPassoBase(1);
  } else {
    _irParaPassoBase && _irParaPassoBase(0);
  }
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
window.redirecionarParaPagamento = function(chave, carrinhoSnap) {
  // Usa o snapshot do carrinho (capturado ANTES de salvar/limpar). Fallback:
  // estado atual e, por último, 1 item a partir de tipoSelecionado (legado).
  let lista = (Array.isArray(carrinhoSnap) && carrinhoSnap.length)
    ? carrinhoSnap
    : (Estado.carrinho.length ? _aplicarDescontosCarrinho(Estado.carrinho) : null);

  if (!lista && Estado.tipoSelecionado) {
    const tipo = Estado.tipoSelecionado;
    const { final, desconto } = calcularPrecoFinal(tipo.preco_original);
    lista = [{
      tipo,
      terapeuta: tipo.terapeuta || null,
      data: Estado.dataSelecionada,
      horario: Estado.horarioSelecionado || '00:00',
      duracao_minutos: tipo.duracao_minutos,
      observacoes: (typeof _coletarObservacoes === 'function' ? _coletarObservacoes(tipo) : null),
      valor_original: tipo.preco_original,
      desconto_aplicado: desconto,
      valor_final: final,
    }];
  }
  lista = lista || [];

  const totalFinal   = lista.reduce((s, i) => s + (i.valor_final || 0), 0);
  const duracaoTotal = lista.reduce((s, i) => s + (i.duracao_minutos || 0), 0);

  const items = lista.map(item => ({
    description: item.tipo.tier_label || item.tipo.nome,
    price: (item.valor_final || 0).toFixed(2),
  }));
  const labelLeitura = items.map(i => i.description).join(' + ');

  const nome = Estado.dadosPessoais.nome || document.getElementById('f-nome')?.value?.trim() || '';
  const whatsapp = Estado.dadosPessoais.whatsapp || (typeof obterWhatsappCompleto === 'function' ? obterWhatsappCompleto() : '');
  const nascRaw = Estado.dadosPessoais.nascimento || document.getElementById('f-nasc')?.value || '';
  const nascFmt = nascRaw
    ? (() => { const [y, m, dd] = nascRaw.split('-'); return `${dd}/${m}/${y}`; })()
    : '';

  // Detalhe por leitura (usado na mensagem manual de WhatsApp / Wise)
  const itensDetalhe = lista.map(item => {
    const [y, m, dd] = String(item.data).split('-');
    const dataFmt = (y && m && dd) ? `${dd}/${m}/${y}` : item.data;
    const hora = (item.horario && item.horario !== '00:00') ? ` até ${item.horario.slice(0,5)}` : '';
    const obsTxt = item.observacoes ? ` — ${String(item.observacoes).replace(/\n/g, ' | ')}` : '';
    return `• ${item.tipo.tier_label || item.tipo.nome} (${dataFmt}${hora})${obsTxt}`;
  }).join('\n');

  const dataLabel = lista.length === 1
    ? (() => { const [y, m, dd] = String(lista[0].data).split('-'); return `${parseInt(dd, 10)} de ${MESES_PT[parseInt(m, 10) - 1]} de ${y}`; })()
    : `${lista.length} leituras`;

  _dadosPagamento = {
    chave,
    tipo:      labelLeitura,
    items,
    itensDetalhe,
    terapeuta: lista[0]?.terapeuta || 'camila',
    data:      dataLabel,
    hora:      '',
    duracao:   duracaoTotal,
    valor:     totalFinal.toFixed(2).replace('.', ','),
    nome,
    nascimento: nascFmt,
    obs: '',
    whatsapp,
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
  if (typeof _atualizarBotaoRetomar === 'function') _atualizarBotaoRetomar();
}

async function _checarStatusPedido(chave) {
  if (typeof supabase === 'undefined' || !supabase) return null;
  try {
    const { data, error } = await supabase
      .rpc('pedido_status', { p_chave: chave });
    if (error) return null;
    return data || null;
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
window.descartarPedidoPendente = () => { _limparPedidoPendente(); mostrarAlerta('Pedido anterior descartado.', 'info'); _atualizarBotaoRetomar(); };

// ============================================================
// Botão flutuante "retomar" — permite voltar ao modal (revisão do
// carrinho OU tela de pagamento pendente) sem precisar escolher
// outra leitura. Aparece só com o modal fechado E havendo algo a
// retomar.
// ============================================================
function _abrirCarrinhoRevisao() {
  const overlay = document.getElementById('modalAgendamento');
  if (!overlay) return;
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.setAttribute('data-last-focus', '');
  }
  overlay.classList.add('open');
  document.body.classList.add('modal-aberto');
  _mostrarTela(1, false);
  irParaPasso(3);
  _atualizarBotaoRetomar();
}

function _atualizarBotaoRetomar() {
  let btn = document.getElementById('btn-retomar-pedido');
  const overlay = document.getElementById('modalAgendamento');
  const modalAberto = overlay?.classList.contains('open');

  const temPendente = !!_lerPedidoPendente();
  const temCarrinho = (typeof Estado !== 'undefined') && Array.isArray(Estado.carrinho) && Estado.carrinho.length > 0;
  const deveMostrar = !modalAberto && (temPendente || temCarrinho);

  if (!deveMostrar) {
    if (btn) btn.classList.remove('visivel');
    return;
  }

  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btn-retomar-pedido';
    btn.className = 'btn-retomar-pedido';
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (_lerPedidoPendente()) {
        _retomarPedidoPendente();
      } else {
        _abrirCarrinhoRevisao();
      }
      _atualizarBotaoRetomar();
    });
    document.body.appendChild(btn);
  }

  if (temPendente) {
    btn.innerHTML = '💳 Retomar pagamento';
  } else {
    const n = Estado.carrinho.length;
    btn.innerHTML = `🛒 Continuar pedido (${n})`;
  }
  btn.classList.add('visivel');
}

window._atualizarBotaoRetomar = _atualizarBotaoRetomar;
document.addEventListener('DOMContentLoaded', _atualizarBotaoRetomar);

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

// Adicionar outra leitura ao carrinho (fecha modal e reabre seletor)
window.adicionarOutraLeitura = function() {
  fecharModal();
  _ofereceRetomar(() => {
    document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth' });
  });
};

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
  set('modal-r-tipo',       ag.tipo);
  set('modal-r-data',       ag.data);
  set('modal-r-hora',       ag.hora);
  set('modal-r-duracao',    `${ag.duracao} min`);
  set('modal-r-valor',      `R$ ${ag.valor}`);

  ['pix', 'cartao', 'wise'].forEach(m => set(`modal-valor-${m}`, `R$ ${ag.valor}`));
  // Reset Pix
  const pixQrBox = document.getElementById('pix-qr-box');
  const pixErr   = document.getElementById('pix-erro-box');
  const pixSt    = document.getElementById('pix-status-box');
  const pixBtn   = document.getElementById('pix-gerar-btn');
  if (pixQrBox) { pixQrBox.style.display = 'none'; pixQrBox.innerHTML = ''; }
  if (pixErr)   pixErr.style.display = 'none';
  if (pixSt)    pixSt.style.display = 'none';
  if (pixBtn)   { pixBtn.disabled = false; pixBtn.textContent = '🔗 Gerar QR Code PIX'; }
  // Reset Cartão
  const cardLinkBox = document.getElementById('cartao-link-box');
  const cardErr     = document.getElementById('cartao-erro-box');
  const cardSt      = document.getElementById('cartao-status-box');
  const cardBtn     = document.getElementById('cartao-gerar-btn');
  if (cardLinkBox) cardLinkBox.style.display = 'none';
  if (cardErr)     cardErr.style.display = 'none';
  if (cardSt)      cardSt.style.display = 'none';
  if (cardBtn)     { cardBtn.disabled = false; cardBtn.textContent = '🔗 Gerar link de pagamento'; }
  set('modal-email-wise', MODAL_WISE);

  trocarAbaPagamento('pix');
  _iniciarPollStatus();
}

// ============================================================
// Override: lazy-load calendário + scroll interno do modal
// ============================================================
const _irParaPassoBase = window.irParaPasso;

window.irParaPasso = function(num) {
  // Carrega calendário ao entrar na section 1
  if (num === 1 && !_calendarioOk) {
    _calendarioOk = true;
    carregarCalendario();
  }
  _irParaPassoBase(num);
  // Mapeia inner passo → outer step
  const outerStep = num === 0 ? 1 : (num <= 2 ? 2 : 3);
  _syncOuterSteps(outerStep);
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
    pix:    'Gere o QR Code, pague pelo app do seu banco e depois avise no WhatsApp — confirmaremos o recebimento 🖤',
    cartao: 'Gere o link, pague pelo checkout que abrir e pronto — a confirmação chega automaticamente 🖤',
    wise:   'Depois de fazer a transferência, volte para esta página e clique em <strong>"Avisar sobre pagamento Wise"</strong>.',
  };
  balao.innerHTML = msgs[metodo] || msgs.pix;
}

function _copiarTexto(texto, msg) {
  navigator.clipboard.writeText(texto)
    .then(() => mostrarAlerta(msg, 'success'))
    .catch(() => mostrarAlerta('Copie manualmente: ' + texto, 'info'));
}

function copiarWiseModal()   { _copiarTexto(MODAL_WISE, '✅ E-mail Wise copiado!'); }

function avisarWhatsAppModal(metodo) {
  const ag = _dadosPagamento;
  if (!ag) return;

  const infoCliente = `*Nome:* ${ag.nome}\n*Nascimento:* ${ag.nascimento}`;
  const leituraBloco = ag.itensDetalhe
    ? `*Leituras:*\n${ag.itensDetalhe}`
    : `*Leitura:* ${ag.tipo}\n*Data:* ${ag.data}${ag.hora ? `\n*Horário:* ${ag.hora}` : ''}`;
  const txidLine = ag.txid ? `\n*ID PIX:* ${ag.txid}` : '';
  const msgs = {
    pix:    `Olá! 😊 Fiz o pagamento via *PIX*.\n\n*Pedido:* ${ag.chave}${txidLine}\n${leituraBloco}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode confirmar o recebimento? Combinaremos o horário por aqui! 🙏`,
    cartao: `Olá! 😊 Realizei o pagamento via *cartão de crédito*.\n\n*Pedido:* ${ag.chave}\n${leituraBloco}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nCombinaremos o horário por aqui! 🙏`,
    wise:   `Olá! 😊 Realizei a transferência via *Wise*.\n\n*Pedido:* ${ag.chave}\n${leituraBloco}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode confirmar o recebimento? Combinaremos o horário por aqui! 🙏`,
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
// PIX — txid local + BR Code (EMV)
// ============================================================
function _crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc;
}

function _gerarBrCode(chave, nome, cidade, valorStr, txid) {
  const emv = (id, val) => id + String(val.length).padStart(2, '0') + val;
  const merchantInfo =
    emv('00', 'br.gov.bcb.pix') +
    emv('01', chave) +
    emv('05', txid.substring(0, 25));
  const payload =
    emv('00', '01') +
    emv('26', merchantInfo) +
    emv('52', '0000') +
    emv('53', '986') +
    emv('54', valorStr) +
    emv('58', 'BR') +
    emv('59', nome.substring(0, 25)) +
    emv('60', cidade.substring(0, 15)) +
    emv('62', emv('05', txid.substring(0, 25))) +
    '6304';
  const crc = _crc16(payload).toString(16).toUpperCase().padStart(4, '0');
  return payload + crc;
}

function _gerarTxid(chave) {
  const suffix = chave.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase().slice(-7);
  return ('COCAR' + suffix + ts).substring(0, 35);
}

function gerarLinkPix() {
  const ag = _dadosPagamento;
  if (!ag) return;
  const btn = document.getElementById('pix-gerar-btn');
  const qr  = document.getElementById('pix-qr-box');
  const err = document.getElementById('pix-erro-box');
  err.style.display = 'none';
  qr.style.display  = 'none';
  qr.innerHTML      = '';
  btn.disabled      = true;
  btn.textContent   = '⏳ Gerando...';

  try {
    const txid      = _gerarTxid(ag.chave);
    const valorNum  = parseFloat(String(ag.valor).replace(',', '.')) || 0;
    const valorStr  = valorNum.toFixed(2);
    const brCode    = _gerarBrCode(PIX_CHAVE, PIX_NOME, PIX_CIDADE, valorStr, txid);

    ag.txid = txid;
    sessionStorage.setItem('agendamento', JSON.stringify(ag));

    // QR Code
    const qrDiv = document.createElement('div');
    qrDiv.style.cssText = 'display:flex;justify-content:center;margin-bottom:12px;';
    const qrInner = document.createElement('div');
    qrInner.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:8px;background:#fff;';
    qrDiv.appendChild(qrInner);

    if (window.QRCode) {
      new window.QRCode(qrInner, { text: brCode, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
    } else {
      qrInner.textContent = 'Biblioteca QR não carregada';
    }

    // Código copia-e-cola
    const label = document.createElement('p');
    label.style.cssText = 'font-size:.85rem;color:var(--text-muted);margin:10px 0 6px;text-align:center;';
    label.textContent = 'Ou copie o código abaixo:';

    const ta = document.createElement('textarea');
    ta.id        = 'pix-qr-code';
    ta.readOnly  = true;
    ta.value     = brCode;
    ta.style.cssText = 'width:100%;font-size:.75rem;font-family:monospace;padding:8px;border:1px solid var(--border);border-radius:6px;resize:none;height:60px;background:#f8f8f8;box-sizing:border-box;';

    const copyBtn = document.createElement('button');
    copyBtn.className   = 'ag-btn ag-btn-copy ag-btn-sm';
    copyBtn.style.cssText = 'display:block;margin:8px auto 0;';
    copyBtn.textContent = '📋 Copiar código PIX';
    copyBtn.onclick     = copiarPixCodigo;

    const txidNote = document.createElement('p');
    txidNote.style.cssText = 'font-size:.78rem;color:var(--text-muted);margin-top:10px;text-align:center;';
    txidNote.innerHTML = `ID da transação: <strong>${txid}</strong>`;

    qr.appendChild(qrDiv);
    qr.appendChild(label);
    qr.appendChild(ta);
    qr.appendChild(copyBtn);
    qr.appendChild(txidNote);
    qr.style.display = 'block';

    btn.textContent = '🔄 Gerar novo QR Code';
    btn.disabled    = false;
  } catch (e) {
    err.textContent  = 'Não foi possível gerar o PIX: ' + (e?.message || 'tente novamente.');
    err.style.display = 'block';
    btn.textContent  = '🔗 Gerar QR Code PIX';
    btn.disabled     = false;
  }
}

function copiarPixCodigo() {
  const ta = document.getElementById('pix-qr-code');
  if (!ta?.value) return;
  _copiarTexto(ta.value, '✅ Código PIX copiado!');
}
window.copiarPixCodigo = copiarPixCodigo;
window.gerarLinkPix    = gerarLinkPix;

// ============================================================
// InfinitePay — link de checkout (cartão de crédito)
// ============================================================
async function gerarLinkCartao() {
  const ag = _dadosPagamento;
  if (!ag) return;
  const btn     = document.getElementById('cartao-gerar-btn');
  const linkBox = document.getElementById('cartao-link-box');
  const err     = document.getElementById('cartao-erro-box');
  btn.disabled     = true;
  btn.textContent  = '⏳ Gerando...';
  linkBox.style.display = 'none';
  err.style.display     = 'none';
  try {
    const items = Array.isArray(ag.items) && ag.items.length
      ? ag.items.map(i => ({ description: i.description, price: parseFloat(String(i.price).replace(',', '.')) }))
      : [{ description: ag.tipo, price: parseFloat(String(ag.valor).replace(',', '.')) }];

    const res = await fetch(_IP_CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: ag.chave, nome: ag.nome, whatsapp: ag.whatsapp, items }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(typeof data.error === 'string' ? data.error : 'falha ao gerar link');
    document.getElementById('cartao-link-btn').href = data.url;
    linkBox.style.display = 'block';
    btn.textContent = '🔄 Gerar novo link';
    btn.disabled    = false;
  } catch (e) {
    err.textContent  = 'Não foi possível gerar o link: ' + (e?.message || 'tente novamente.');
    err.style.display = 'block';
    btn.textContent  = '🔗 Gerar link de pagamento';
    btn.disabled     = false;
  }
}
window.gerarLinkCartao = gerarLinkCartao;
