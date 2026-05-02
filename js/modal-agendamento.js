/* ============================================================
   COCAR SAGRADO — Controle do Modal de Agendamento
   Depende de: agendamento-system.js (Estado, calcularPrecoFinal,
   carregarTiposLeitura, carregarCalendario, MESES_PT)
   ============================================================ */

const MODAL_WHATSAPP = '5527998528483'; 
const MODAL_PIX      = 'cocarsagrado@gmail.com';        
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
  overlay.classList.add('open');
  document.body.classList.add('modal-aberto');
  overlay.querySelector('.modal-body')?.scrollTo({ top: 0 });
  irParaPasso(1);
}

function fecharModal(forcar) {
  const temDados = (window.Estado && Estado.tipoSelecionado) ||
                   document.getElementById('f-nome')?.value?.trim();

  if (!forcar && temDados) {
    if (!confirm('Fechar? Os dados do agendamento serão perdidos.')) return;
  }

  const overlay = document.getElementById('modalAgendamento');
  overlay?.classList.remove('open');
  document.body.classList.remove('modal-aberto');
  setTimeout(_resetarModal, 360);
}

function _resetarModal() {
  if (window.Estado) {
    Estado.tipoSelecionado    = null;
    Estado.dataSelecionada    = null;
    Estado.horarioSelecionado = null;
  }
  _dadosPagamento = null;
  _calendarioOk   = false;

  document.getElementById('form-dados')?.reset();
  document.querySelectorAll('.ag-card.selected, .ag-day-card.selected, .ag-slot.selected')
    .forEach(el => el.classList.remove('selected'));

  _mostrarTela(1, false);
  _irParaPassoBase && _irParaPassoBase(1);
  _calendarioOk = false;
}

// ============================================================
// Navegação entre as 2 telas
// ============================================================
function _mostrarTela(num, animacao) {
  if (animacao === undefined) animacao = true;

  const t1 = document.getElementById('telaAgendamento');
  const t2 = document.getElementById('telaPagamento');
  const s1 = document.getElementById('modal-step-1');
  const s2 = document.getElementById('modal-step-2');
  if (!t1 || !t2) return;

  t1.classList.remove('active', 'slide-esquerda');
  t2.classList.remove('active', 'slide-esquerda');

  if (num === 1) {
    if (animacao) t1.classList.add('slide-esquerda');
    t1.classList.add('active');
    s1?.classList.remove('done');
    s1?.classList.add('active');
    s2?.classList.remove('active', 'done');
  } else {
    t2.classList.add('active');
    s1?.classList.remove('active');
    s1?.classList.add('done');
    s2?.classList.remove('done');
    s2?.classList.add('active');
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

  _dadosPagamento = {
    chave,
    tipo:     tipo.nome,
    data:     `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`,
    hora:     Estado.horarioSelecionado,
    duracao:  tipo.duracao_minutos,
    valor:    final.toFixed(2).replace('.', ','),
    nome:     document.getElementById('f-nome').value.trim(),
    whatsapp: document.getElementById('f-fone').value.trim(),
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
  set('modal-chave-pix',  MODAL_PIX);
  set('modal-email-wise', MODAL_WISE);

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
    .then(() => alert(msg))
    .catch(() => alert('Copie manualmente: ' + texto));
}

function copiarChavePedido() { _copiarTexto(_dadosPagamento?.chave || '', '✅ Chave copiada!'); }
function copiarPixModal()    { _copiarTexto(MODAL_PIX,  '✅ Chave PIX copiada!'); }
function copiarWiseModal()   { _copiarTexto(MODAL_WISE, '✅ E-mail Wise copiado!'); }

function avisarWhatsAppModal(metodo) {
  const ag = _dadosPagamento;
  if (!ag) return;

  const msgs = {
    pix:    `Olá! 😊 Fiz o pagamento via *PIX*.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data} às ${ag.hora}\n*Valor:* R$ ${ag.valor}\n\nPode confirmar o recebimento? 🙏`,
    cartao: `Olá! 😊 Gostaria de pagar via *cartão* meu agendamento.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data} às ${ag.hora}\n*Valor:* R$ ${ag.valor}\n\nPode me enviar o link de pagamento? 🙏`,
    wise:   `Olá! 😊 Realizei a transferência via *Wise*.\n\n*Pedido:* ${ag.chave}\n*Leitura:* ${ag.tipo}\n*Data:* ${ag.data} às ${ag.hora}\n*Valor:* R$ ${ag.valor}\n\nPode confirmar o recebimento? 🙏`,
  };

  window.open(`https://wa.me/${MODAL_WHATSAPP}?text=${encodeURIComponent(msgs[metodo])}`, '_blank');
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
