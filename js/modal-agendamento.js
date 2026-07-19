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
  if (obsGroup && _ehNaipe(tipo)) {
    // Naipes: começa com 1 pergunta; botão "＋" adiciona até 4 (preço ao vivo).
    _renderNaipePerguntas(['']);
  } else if (obsGroup) {
    const n = (tipo && tipo.requerPergunta) ? _numeroDePerguntas(tipo) : 0;
    obsGroup.innerHTML = '';
    if (n === 0) {
      obsGroup.style.display = 'none';
    } else {
      obsGroup.style.display = '';
      const hint = document.createElement('p');
      hint.className = 'ag-obs-hint';
      hint.textContent = 'Conte a situação com suas palavras e o que você quer saber. Não existe pergunta errada. 🌿';
      obsGroup.appendChild(hint);
      for (let i = 1; i <= n; i++) {
        const id  = `f-obs-${i}`;
        const lbl = document.createElement('label');
        lbl.htmlFor    = id;
        lbl.textContent = n === 1 ? 'Sua pergunta *' : `Pergunta ${i} *`;
        const ta = document.createElement('textarea');
        ta.id          = id;
        ta.name        = `obs${i}`;
        ta.required    = true;
        ta.rows        = 3;
        ta.placeholder = 'Ex.: Como fica minha vida amorosa nos próximos meses? O que preciso enxergar agora?';
        obsGroup.appendChild(lbl);
        obsGroup.appendChild(ta);
      }
    }
  }

  // Ajusta o subtítulo da tela de confirmação ao tipo (com/sem perguntas)
  const sub2 = document.getElementById('secao2-sub');
  if (sub2) {
    sub2.textContent = (tipo && (tipo.requerPergunta || _ehNaipe(tipo)))
      ? 'Escreva suas perguntas com calma — são elas que guiam a leitura.'
      : 'Confira os detalhes antes de continuar.';
  }

  overlay.classList.add('open');
  document.body.classList.add('modal-aberto');
  overlay.querySelector('.modal-body')?.scrollTo({ top: 0 });
  // Move o foco para dentro do modal (aguarda a animação de entrada)
  setTimeout(() => overlay.querySelector('.modal-container')?.focus(), 380);

  irParaPasso(1);
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
  // Reaberto dentro da janela de 360ms (ex.: clicar "Retomar pagamento" logo
  // após fechar)? Não reseta — senão zera _dadosPagamento e expulsa o cliente
  // da tela de pagamento recém-aberta de volta pro passo 1.
  if (document.getElementById('modalAgendamento')?.classList.contains('open')) return;
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

// Mapeia o passo interno (0..3) ou a tela de pagamento ao indicador externo
// (1=Data, 2=Leitura, 3=Pagamento). Fluxo atual:
//   passo 1 = calendário          → "Data"
//   passo 0 = dados pessoais      → "Leitura"
//   passo 2 = perguntas           → "Leitura"
//   passo 3 = revisão do carrinho → "Leitura"
//   tela 2  = pagamento           → "Pagamento"
function _passoToOuter(passo) {
  if (passo === 1) return 1;
  if (passo === 0 || passo === 2 || passo === 3) return 2;
  return 1;
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
    // Descobre o passo interno ativo (lê data-passo, não o índice na NodeList)
    const ativo = document.querySelector('.ag-section.active');
    const passo = ativo ? Number(ativo.dataset.passo) : 1;
    _syncOuterSteps(_passoToOuter(passo));
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
window.redirecionarParaPagamento = function(chave, carrinhoSnap, cupomSnap) {
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
      observacoes: (typeof _coletarObservacoes === 'function' ? _coletarObservacoes(tipo) : null),
      valor_original: tipo.preco_original,
      desconto_aplicado: desconto,
      valor_final: final,
    }];
  }
  lista = lista || [];

  // Cupom (R$ fixo). Só as leituras ELEGÍVEIS (não-naipe) entram na base:
  // Naipes da Pomba Gira não aceita cupom. Cap e rateio ficam em sincronia
  // com _cupomDesconto (front) e a RPC criar_pedido (que capa e rateia só
  // entre os filhos elegíveis) — senão o link cobra a menor que o banco e o
  // webhook nunca confirma. Distribui em centavos entre os itens elegíveis
  // para a soma dos items[] bater com o total (a InfinitePay soma os items).
  const cents      = lista.map(i => Math.round((i.valor_final || 0) * 100));
  const totalCents = cents.reduce((s, c) => s + c, 0);
  const eligIdx    = lista.map((i, idx) => (!_ehNaipe(i.tipo) ? idx : -1)).filter(idx => idx >= 0);
  const eligBase   = eligIdx.reduce((s, idx) => s + cents[idx], 0);
  const cupomCents = (cupomSnap && eligBase > 0)
    ? Math.min(Math.round((cupomSnap.valor || 0) * 100), eligBase)
    : 0;

  const descCents = cents.map(() => 0);
  let restanteCupom = cupomCents;
  eligIdx.forEach((idx, k) => {
    if (k === eligIdx.length - 1) { descCents[idx] = restanteCupom; return; } // último elegível abate o resto
    const d = eligBase > 0 ? Math.floor(cupomCents * cents[idx] / eligBase) : 0;
    descCents[idx] = d;
    restanteCupom -= d;
  });

  const items = lista.map((item, idx) => ({
    description: item.tipo.tier_label || item.tipo.nome,
    price: ((cents[idx] - descCents[idx]) / 100).toFixed(2),
  }));
  const labelLeitura = items.map(i => i.description).join(' + ');
  const totalCobrar  = (totalCents - cupomCents) / 100;

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
  }).join('\n') + (cupomCents > 0
    ? `\n🏷️ Cupom ${cupomSnap.codigo}: -R$ ${(cupomCents / 100).toFixed(2).replace('.', ',')}`
    : '');

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
    valor:     totalCobrar.toFixed(2).replace('.', ','),
    nome,
    nascimento: nascFmt,
    obs: '',
    whatsapp,
  };

  sessionStorage.setItem('agendamento', JSON.stringify(_dadosPagamento));
  _salvarPedidoPendente(_dadosPagamento);

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

// Retorna: status (string) | null = pedido não existe | undefined = erro de
// rede/RPC (inconclusivo — não descartar o pedido pendente nesse caso).
async function _checarStatusPedido(chave) {
  if (typeof supabase === 'undefined' || !supabase) return undefined;
  try {
    const { data, error } = await supabase
      .rpc('pedido_status', { p_chave: chave });
    if (error) return undefined;
    return data || null;
  } catch { return undefined; }
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
    btn.innerHTML = '<img src="images/credit-card.webp" alt="" width="18" height="18" style="display:block"><span>Retomar pagamento</span>';
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
  overlay.style.alignItems = 'center';
  overlay.style.padding = '20px';
  overlay.innerHTML = `
    <div class="pendente-card">
      <h3>Você tem um pedido esperando pagamento</h3>
      <p><strong>Pedido:</strong> ${_escCat(ag.chave)}<br><strong>Leitura:</strong> ${_escCat(ag.tipo)}<br><strong>Valor:</strong> R$ ${_escCat(ag.valor)}</p>
      <p class="pendente-aviso">Se você já fez o PIX ou está pagando, continue esse pedido — criar outro pode gerar cobrança em dobro.</p>
      <div class="pendente-acoes">
        <button class="ag-btn ag-btn-primary" id="_retomarBtn">Continuar esse pedido</button>
        <button class="ag-btn ag-btn-ghost" id="_novoBtn">Descartar e começar outro</button>
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
  const flx = document.getElementById('pag-fluxo');
  const suc = document.getElementById('pag-sucesso');
  if (flx) flx.hidden = true;
  if (suc) suc.hidden = false;
  _limparPedidoPendente();
  document.querySelector('#modalAgendamento .modal-body')
    ?.scrollTo({ top: 0, behavior: 'smooth' });
}

function _preencherTelaPagamento() {
  const ag = _dadosPagamento;
  if (!ag) return;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  // Recibo: uma linha por leitura + entrega (quando é 1 leitura só)
  const itensBox = document.getElementById('pag-resumo-itens');
  if (itensBox) {
    const items = Array.isArray(ag.items) ? ag.items : [];
    let html = items.map(i =>
      `<div class="pag-resumo-linha"><span>${_escCat(i.description)}</span><strong>R$ ${_escCat(String(i.price).replace('.', ','))}</strong></div>`
    ).join('');
    if (!items.length) {
      html = `<div class="pag-resumo-linha"><span>${_escCat(ag.tipo || 'Leitura')}</span><strong>R$ ${_escCat(ag.valor)}</strong></div>`;
    }
    if (items.length <= 1 && ag.data) {
      html += `<div class="pag-resumo-linha"><span>Entrega</span><strong>${_escCat(ag.data)}</strong></div>`;
    }
    itensBox.innerHTML = html;
  }
  set('modal-r-valor', `R$ ${ag.valor}`);
  set('modal-valor-wise', `R$ ${ag.valor}`);
  set('modal-email-wise', MODAL_WISE);
  const chaveEl = document.getElementById('pag-chave');
  if (chaveEl) chaveEl.innerHTML = `Pedido <strong>${_escCat(ag.chave)}</strong>`;

  _pagVoltarMetodos(); // estado inicial: escolha da forma de pagar
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
  // Com leituras no pedido, o calendário ganha atalho de volta pra revisão
  if (num === 1) {
    const voltar = document.getElementById('cal-voltar-pedido');
    if (voltar) voltar.hidden = !(typeof Estado !== 'undefined' && Estado.carrinho.length > 0);
  }
  _irParaPassoBase(num);
  _syncOuterSteps(_passoToOuter(num));
  document.querySelector('#modalAgendamento .modal-body')
    ?.scrollTo({ top: 0, behavior: 'smooth' });
};

// ============================================================
// Funções de pagamento
// ============================================================
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
  const msgs = {
    pix:    `Olá! 😊 Fiz o pagamento via *PIX*.\n\n*Pedido:* ${ag.chave}\n${leituraBloco}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode confirmar o recebimento? Fico no aguardo da minha leitura no dia! 🙏`,
    cartao: `Olá! 😊 Realizei o pagamento via *cartão de crédito*.\n\n*Pedido:* ${ag.chave}\n${leituraBloco}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nFico no aguardo da minha leitura no dia! 🙏`,
    wise:   `Olá! 😊 Realizei a transferência via *Wise*.\n\n*Pedido:* ${ag.chave}\n${leituraBloco}\n*Valor:* R$ ${ag.valor}\n\n${infoCliente}\n\nPode confirmar o recebimento? Fico no aguardo da minha leitura no dia! 🙏`,
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

  // Focus trap: mantém Tab/Shift+Tab dentro do modal aberto
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !overlay.classList.contains('open')) return;
    const seçãoAtiva = overlay.querySelector('.modal-screen.active') || overlay;
    const focaveis = Array.from(seçãoAtiva.querySelectorAll(FOCUSABLE))
      .filter(el => el.offsetParent !== null && !el.hasAttribute('aria-hidden'));
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo   = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault(); ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault(); primeiro.focus();
    }
  });

  // "Estou fora do Brasil" abre/fecha as instruções da Wise
  const wiseToggle = document.getElementById('pag-wise-toggle');
  wiseToggle?.addEventListener('click', () => {
    const painel = document.getElementById('pag-wise');
    if (!painel) return;
    const abrir = painel.hidden;
    painel.hidden = !abrir;
    wiseToggle.setAttribute('aria-expanded', String(abrir));
    if (abrir) painel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Checa pedido pendente ao carregar (atualiza se foi pago via webhook)
  setTimeout(_verificarPedidoPendenteAoCarregar, 1500);
});

// ============================================================
// InfinitePay — pagamento em 1 toque (PIX e cartão de crédito)
// A aba é aberta JÁ no clique (gesto do usuário → sem bloqueio de
// pop-up) e recebe o checkout assim que o link fica pronto. Se o
// navegador bloquear mesmo assim, a tela de espera oferece o botão
// "Abrir pagamento".
// ============================================================
let _pagMetodoAtual = null;

function _pagVoltarMetodos() {
  const mostrar = (id, vis) => { const el = document.getElementById(id); if (el) el.hidden = !vis; };
  mostrar('pag-fluxo', true);
  mostrar('pag-metodos', true);
  mostrar('pag-espera', false);
  mostrar('pag-sucesso', false);
  mostrar('pag-erro-box', false);
  mostrar('pag-wise', false);
  document.getElementById('pag-wise-toggle')?.setAttribute('aria-expanded', 'false');
  ['pix', 'cartao'].forEach(m => {
    const b = document.getElementById(`pag-btn-${m}`);
    if (b) { b.disabled = false; b.classList.remove('carregando'); }
  });
}
window._pagVoltarMetodos = _pagVoltarMetodos;

function _pagMostrarEspera(abriuSozinho, url) {
  const met = document.getElementById('pag-metodos');
  const esp = document.getElementById('pag-espera');
  if (met) met.hidden = true;
  if (esp) esp.hidden = false;

  const titulo  = document.getElementById('pag-espera-titulo');
  const txt     = document.getElementById('pag-espera-txt');
  const reabrir = document.getElementById('pag-reabrir');
  if (reabrir) reabrir.href = url;
  if (abriuSozinho) {
    if (titulo)  titulo.textContent  = 'Seu pagamento abriu em outra aba';
    if (txt)     txt.textContent     = 'Termine por lá, no seu tempo. Assim que o pagamento cair, esta tela confirma sozinha.';
    if (reabrir) reabrir.textContent = 'Abrir pagamento de novo';
  } else {
    if (titulo)  titulo.textContent  = 'Seu pagamento está pronto';
    if (txt)     txt.textContent     = 'Toque no botão abaixo para abrir o checkout seguro. Quando o pagamento cair, esta tela confirma sozinha.';
    if (reabrir) reabrir.textContent = 'Abrir e pagar agora →';
  }
  document.querySelector('#modalAgendamento .modal-body')
    ?.scrollTo({ top: 0, behavior: 'smooth' });
}

async function pagarCom(metodo) {
  const ag = _dadosPagamento;
  if (!ag) return;

  const err = document.getElementById('pag-erro-box');
  if (err) err.hidden = true;

  // Abre a aba dentro do gesto do clique; o destino chega depois.
  let win = null;
  try { win = window.open('', '_blank'); } catch { win = null; }
  if (win) {
    try {
      win.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Preparando pagamento…</title></head><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#F7F3E8;color:#41513F;font-family:system-ui,sans-serif;font-size:17px"><p>🌿 Preparando seu pagamento seguro…</p></body></html>');
    } catch { /* melhor uma aba em branco do que quebrar o fluxo */ }
  }

  const btnAtivo = document.getElementById(`pag-btn-${metodo}`);
  if (btnAtivo) {
    btnAtivo.classList.add('carregando');
    const label = btnAtivo.querySelector('strong');
    if (label) { btnAtivo.dataset.labelOriginal = label.textContent; label.textContent = 'Preparando…'; }
  }
  ['pix', 'cartao'].forEach(m => {
    const b = document.getElementById(`pag-btn-${m}`);
    if (b) b.disabled = true;
  });

  try {
    const items = Array.isArray(ag.items) && ag.items.length
      ? ag.items.map(i => ({ description: i.description, price: parseFloat(String(i.price).replace(',', '.')) }))
      : [{ description: ag.tipo, price: parseFloat(String(ag.valor).replace(',', '.')) }];

    const res = await fetch(_IP_CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: ag.chave, nome: ag.nome, whatsapp: ag.whatsapp, metodo, items }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(typeof data.error === 'string' ? data.error : 'falha ao gerar link');

    _pagMetodoAtual = metodo;
    let abriu = false;
    if (win && !win.closed) {
      try { win.location = data.url; abriu = true; } catch { /* cai no botão manual */ }
    }
    _pagMostrarEspera(abriu, data.url);
  } catch (e) {
    if (win) { try { win.close(); } catch {} }
    if (err) {
      err.textContent = 'Não conseguimos preparar o pagamento agora. Espere alguns segundos e tente de novo — nada foi cobrado.';
      err.hidden = false;
    }
  } finally {
    ['pix', 'cartao'].forEach(m => {
      const b = document.getElementById(`pag-btn-${m}`);
      if (!b) return;
      b.disabled = false;
      b.classList.remove('carregando');
      const label = b.querySelector('strong');
      if (label && b.dataset.labelOriginal) label.textContent = b.dataset.labelOriginal;
    });
  }
}
window.pagarCom = pagarCom;
// aliases legados (nada mais chama, mas não custa manter)
window.gerarLinkPix    = () => pagarCom('pix');
window.gerarLinkCartao = () => pagarCom('cartao');

// Ajuda no meio do pagamento — mensagem neutra (não afirma que pagou)
window.pagAjudaWhatsApp = function () {
  const ag = _dadosPagamento;
  if (!ag) return;
  const msg = `Olá! 😊 Estou finalizando o pedido *${ag.chave}* (R$ ${ag.valor}) no site e preciso de uma ajudinha com o pagamento.`;
  const numero = WHATSAPP_TERAPEUTA[ag.terapeuta] || WHATSAPP_TERAPEUTA.camila;
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(msg)}`, '_blank');
};
