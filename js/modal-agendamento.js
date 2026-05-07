/* ============================================================
   COCAR SAGRADO — Controle do Modal de Agendamento
   Depende de: agendamento-system.js (Estado, calcularPrecoFinal,
   carregarTiposLeitura, carregarCalendario, MESES_PT)
   ============================================================ */

const MODAL_PIX      = 'cocarsagrado@gmail.com';
const _CHECKOUT_URL  = 'https://demxedudbislzausvhwx.supabase.co/functions/v1/infinitypay-checkout';
const MODAL_WISE     = 'cocarsagrado@gmail.com';
const MODAL_NOME     = 'Cocar Sagrado';   // máx 25 chars — nome na conta PIX
const MODAL_CIDADE   = 'Guarapari';       // máx 15 chars

// ============================================================
// PIX BR Code (EMV) — geração de payload e QR Code dinâmico
// ============================================================
function _pixCrc16(str) {
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

function gerarPayloadPix(chave, nome, cidade, valor, txid) {
  const f = (id, v) => `${id}${String(v.length).padStart(2,'0')}${v}`;
  const mai = f('00','BR.GOV.BCB.PIX') + f('01', chave);
  const txidSanitized = (txid || '***').replace(/[^A-Za-z0-9]/g,'').substring(0,25) || '***';
  const add = f('05', txidSanitized);
  let payload =
    f('00','01') +
    f('26', mai) +
    f('52','0000') +
    f('53','986') +
    f('54', valor.toFixed(2)) +
    f('58','BR') +
    f('59', nome.substring(0,25)) +
    f('60', cidade.substring(0,15)) +
    f('62', add) +
    '6304';
  return payload + _pixCrc16(payload).toString(16).toUpperCase().padStart(4,'0');
}

function _renderizarQrCode(payload) {
  const el = document.getElementById('pag-qrcode');
  if (!el) return;
  el.innerHTML = '';
  if (typeof QRCode === 'undefined') {
    el.textContent = 'QR Code indisponível';
    return;
  }
  new QRCode(el, {
    text: payload,
    width: 200,
    height: 200,
    colorDark: '#013718',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

let _dadosPagamento = null;
let _calendarioOk   = false;

// ============================================================
// Abrir / Fechar
// ============================================================
function abrirModal(tipo) {
  if (tipo) Estado.tipoSelecionado = tipo;
  const overlay = document.getElementById('modalAgendamento');
  if (!overlay) return;

  const obsGroup = document.getElementById('f-obs')?.closest('.ag-form-group');
  const obsField = document.getElementById('f-obs');
  if (obsGroup && obsField) {
    const mostrar = !!(tipo && tipo.requerPergunta);
    obsGroup.style.display = mostrar ? '' : 'none';
    obsField.required = mostrar;
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
  const d = new Date(Estado.dataSelecionada + 'T00:00:00');

  const nascRaw = document.getElementById('f-nasc')?.value || '';
  const nascFmt = nascRaw
    ? (() => { const [y, m, dd] = nascRaw.split('-'); return `${dd}/${m}/${y}`; })()
    : '';

  _dadosPagamento = {
    chave,
    tipo:      tipo.nome,
    terapeuta: tipo.terapeuta || 'camila',
    data:      `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`,
    hora:      'A combinar via WhatsApp',
    duracao:   tipo.duracao_minutos,
    valor:     final.toFixed(2).replace('.', ','),
    nome:       document.getElementById('f-nome').value.trim(),
    nascimento: nascFmt,
    obs:        document.getElementById('f-obs')?.value?.trim() || '',
    whatsapp:   document.getElementById('f-fone').value.trim(),
  };

  sessionStorage.setItem('agendamento', JSON.stringify(_dadosPagamento));

  _preencherTelaPagamento();
  _mostrarTela(2);
};

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
  const _lb = document.getElementById('cartao-link-box');
  const _eb = document.getElementById('cartao-erro-box');
  const _gb = document.getElementById('cartao-gerar-btn');
  if (_lb) _lb.style.display = 'none';
  if (_eb) _eb.style.display = 'none';
  if (_gb) { _gb.disabled = false; _gb.textContent = '🔗 Gerar link de pagamento'; }
  set('modal-chave-pix',  ag.chave);
  set('modal-email-wise', MODAL_WISE);

  const valorNum = parseFloat(ag.valor.replace(',', '.'));
  const txid = ag.chave.replace(/[^A-Za-z0-9]/g, '').substring(0, 25);
  const payload = gerarPayloadPix(MODAL_PIX, MODAL_NOME, MODAL_CIDADE, valorNum, txid);
  _dadosPagamento.pixPayload = payload;
  set('modal-chave-pix', payload.substring(0, 40) + '…');
  _renderizarQrCode(payload);

  trocarAbaPagamento('pix');
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
}

function _copiarTexto(texto, msg) {
  navigator.clipboard.writeText(texto)
    .then(() => mostrarAlerta(msg, 'success'))
    .catch(() => mostrarAlerta('Copie manualmente: ' + texto, 'info'));
}

function copiarChavePedido() { _copiarTexto(_dadosPagamento?.chave || '', '✅ Chave copiada!'); }
function copiarPixModal()    { _copiarTexto(_dadosPagamento?.pixPayload || '', '✅ Código PIX copiado!'); }
function copiarWiseModal()   { _copiarTexto(MODAL_WISE, '✅ E-mail Wise copiado!'); }

function avisarWhatsAppModal(metodo) {
  const ag = _dadosPagamento;
  if (!ag) return;

  const infoCliente = `*Nome:* ${ag.nome}\n*Nascimento:* ${ag.nascimento}${ag.obs ? `\n*Pergunta/Questão:* ${ag.obs}` : ''}`;
  const msgs = {
    pix:    `Olá! 😊 Fiz o pagamento via *PIX*.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode confirmar o recebimento? Combinaremos o horário por aqui! 🙏`,
    cartao: `Olá! 😊 Gostaria de pagar via *cartão* meu agendamento.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode me enviar o link de pagamento? Combinaremos o horário por aqui! 🙏`,
    wise:   `Olá! 😊 Realizei a transferência via *Wise*.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode confirmar o recebimento? Combinaremos o horário por aqui! 🙏`,
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
});

// ============================================================
// Mercado Pago — geração de link de pagamento por cartão
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
