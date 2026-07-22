/* ============================================================
   COCAR SAGRADO — Sistema de Agendamento (Sistema de Vagas)
   ============================================================ */

const Estado = {
  tipoSelecionado: null,
  dataSelecionada: null,
  horarioSelecionado: null,
  serviceId: null,
  // Carrinho multi-leitura
  carrinho: [],
  cupom: null, // { codigo, valor } — desconto R$ fixo no total do pedido
  dadosPessoais: { nome: '', nascimento: '', whatsapp: '', email: '' },
};

// Desconto do cupom limitado à base ELEGÍVEL (nunca deixa o pedido negativo).
// Naipes da Pomba Gira não entram em cupom (leitura sem desconto), então a
// base é a soma das leituras não-naipe. Mantém front e RPC em sincronia.
function _cupomDesconto(itens) {
  if (!Estado.cupom) return 0;
  const base = (Array.isArray(itens) ? itens : [])
    .filter(i => !_ehNaipe(i.tipo))
    .reduce((s, i) => s + (Number(i.valor_final) || 0), 0);
  return Math.min(Estado.cupom.valor, base);
}

const DIAS_PT  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const _BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtBRL(v) { return _BRL.format(Number(v) || 0); }

// ============================================================
// SELETOR DE QUANTIDADE
// ============================================================

let _tiposCache    = null;
let _seletorTipo   = null;
let _seletorQty    = 1;

// ============================================================
// NAIPES DA POMBA GIRA — leitura com preço progressivo
// Cliente escolhe 1 naipe (tema) e de 1 a 4 perguntas. Cada pergunta
// extra custa R$4 a menos, mas soma as anteriores: 30 / 56 / 78 / 96.
// Sem desconto (progressão já é o único "desconto"). Slug do catálogo abaixo.
// ============================================================
const NAIPE_SLUG   = 'naipes-da-pombo-gira';
const NAIPE_MAX_Q  = 4;
const NAIPE_CUSTO  = [30, 26, 22, 18]; // custo da 1ª, 2ª, 3ª, 4ª pergunta
const NAIPES = [
  { id: 'copas',   simbolo: '♥', nome: 'Copas',   cor: 'vermelho', desc: 'amor, relacionamentos, família, vínculos afetivos' },
  { id: 'ouros',   simbolo: '♦', nome: 'Ouros',   cor: 'vermelho', desc: 'dinheiro, prosperidade, bens materiais, negócios' },
  { id: 'paus',    simbolo: '♣', nome: 'Paus',    cor: 'preto',    desc: 'trabalho, carreira, ação, conquistas, força de vontade' },
  { id: 'espadas', simbolo: '♠', nome: 'Espadas', cor: 'preto',    desc: 'espiritualidade, mediunidade, conflitos internos, clareza mental' },
];

// Preço acumulado para N perguntas (1..4).
function precoNaipe(qtd) {
  const n = Math.max(1, Math.min(NAIPE_MAX_Q, parseInt(qtd, 10) || 1));
  let total = 0;
  for (let i = 0; i < n; i++) total += NAIPE_CUSTO[i];
  return total;
}

function _ehNaipe(tipo) {
  return !!(tipo && (tipo.isNaipe || tipo.slug === NAIPE_SLUG));
}

let _seletorNaipe     = null; // naipe (tema) escolhido no seletor
let _seletorNaipeBase = null; // o tipo do catálogo (id, terapeuta, slug…)

const WHATSAPP_TERAPEUTA = {
  matheus: '5528999476620',
  camila:  '5527998528483',
};

// Fecha o dia atual N minutos antes do ate_horario para dar tempo de processar/entregar
const CUTOFF_BUFFER_MIN = 60;

async function _garantirTipos(forcar) {
  if (_tiposCache && !forcar) return _tiposCache;
  if (typeof supabase === 'undefined' || !supabase) {
    console.error('Supabase não carregado — verifique a conexão com a CDN.');
    return [];
  }
  const { data, error } = await supabase
    .from('tipos_leitura')
    .select('*')
    .eq('ativo', true)
    .not('terapeuta', 'is', null)
    .order('ordem')
    .order('nome');
  if (error) {
    console.error('Erro ao carregar tipos:', error);
    return [];
  }
  _tiposCache = data || [];
  return _tiposCache;
}

function _tipoMaxQty(t) {
  return t.especial ? 1 : 5;
}

function _numeroDePerguntas(tipo) {
  if (!tipo?.requerPergunta && !tipo?.requer_pergunta) return 0;
  const n = parseInt(tipo.num_perguntas, 10);
  if (Number.isFinite(n) && n > 0) return Math.min(20, n);
  // Fallback (registros antigos sem a coluna): tenta extrair do nome
  const fonte = `${tipo.tier_label || ''} ${tipo.nome || ''}`;
  const m = fonte.match(/(\d+)\s*pergunta/i);
  return m ? Math.max(1, Math.min(20, parseInt(m[1], 10))) : 1;
}

function _coletarObservacoes(tipo) {
  const n = _numeroDePerguntas(tipo);
  if (n === 0) return null;
  const partes = [];
  for (let i = 1; i <= n; i++) {
    const v = document.getElementById(`f-obs-${i}`)?.value?.trim();
    if (v) partes.push(n === 1 ? v : `${i}. ${v}`);
  }
  return partes.length ? partes.join('\n') : null;
}

// ---- Naipes: perguntas dinâmicas na tela da leitura --------------------
// Lê os textos já digitados (preserva ao adicionar/remover campos).
function _lerNaipeVals() {
  return Array.from(document.querySelectorAll('#f-obs-group textarea')).map(t => t.value);
}

// Recalcula o preço (30/56/78/96) conforme a qtd de campos e atualiza o resumo.
function _atualizarValorNaipe() {
  const tipo = Estado.tipoSelecionado;
  if (!_ehNaipe(tipo)) return;
  const n = document.querySelectorAll('#f-obs-group textarea').length || 1;
  tipo.num_perguntas  = n;
  tipo.preco_original = precoNaipe(n);
  atualizarResumo();
}

// (Re)desenha os campos de pergunta a partir de um array de valores.
function _renderNaipePerguntas(vals) {
  const g = document.getElementById('f-obs-group');
  if (!g) return;
  const n = Math.max(1, Math.min(NAIPE_MAX_Q, vals.length));
  g.style.display = '';
  g.innerHTML = '';

  const hint = document.createElement('p');
  hint.className = 'ag-obs-hint';
  hint.textContent = 'Conte a situação com suas palavras e o que você quer saber. Não existe pergunta errada. 🌿';
  g.appendChild(hint);

  for (let idx = 0; idx < n; idx++) {
    const i = idx + 1;
    const row = document.createElement('div');
    row.className = 'naipe-pergunta-row';

    const head = document.createElement('div');
    head.className = 'naipe-pergunta-head';
    const lbl = document.createElement('label');
    lbl.htmlFor = `f-obs-${i}`;
    lbl.textContent = n === 1 ? 'Pergunta/Questão *' : `Pergunta ${i} *`;
    head.appendChild(lbl);

    // Selo com o custo desta pergunta (1ª = preço cheio; extras = quanto somam).
    const preco = document.createElement('span');
    preco.className = idx === 0 ? 'naipe-pergunta-preco' : 'naipe-pergunta-preco extra';
    preco.textContent = idx === 0 ? fmtBRL(NAIPE_CUSTO[0]) : `+ ${fmtBRL(NAIPE_CUSTO[idx])}`;
    head.appendChild(preco);

    if (n > 1) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'naipe-pergunta-rm';
      rm.setAttribute('aria-label', `Remover pergunta ${i}`);
      rm.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg>';
      rm.addEventListener('click', () => {
        const cur = _lerNaipeVals();
        cur.splice(idx, 1);
        _renderNaipePerguntas(cur);
        _atualizarValorNaipe();
      });
      head.appendChild(rm);
    }
    row.appendChild(head);

    const ta = document.createElement('textarea');
    ta.id = `f-obs-${i}`;
    ta.name = `obs${i}`;
    ta.required = true;
    ta.rows = 3;
    ta.placeholder = 'Ex.: Como fica meu relacionamento nos próximos meses?';
    ta.value = vals[idx] || '';
    row.appendChild(ta);

    g.appendChild(row);
  }

  if (n < NAIPE_MAX_Q) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'naipe-add-btn';
    // Mostra quanto a próxima pergunta custa (cada extra sai mais barata)
    add.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Adicionar outra pergunta · ${fmtBRL(NAIPE_CUSTO[n])}`;
    add.addEventListener('click', () => {
      const cur = _lerNaipeVals();
      cur.push('');
      _renderNaipePerguntas(cur);
      _atualizarValorNaipe();
    });
    g.appendChild(add);
  }
}

function _lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function _lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* private browsing */ }
}

// ============================================================
// LEMBRAR CLIENTE (localStorage)
// Regra do Matheus (2026-07-19, substitui a de 2026-07-02): guest
// TAMBÉM é lembrado — nome, dados, E-MAIL e aceite dos termos ficam
// no aparelho pra não pedir de novo a cada pedido. O e-mail repetido
// é o que mantém leituras e áudios no mesmo "dono" até ele criar
// conta (reivindicar_pedidos). Logado espelha o perfil; só o logout
// REAL apaga tudo (aparelho compartilhado).
// ============================================================
const CLIENTE_LOCAL_KEY = 'cocar_cliente_v1';

// Versão dos termos de uso. Conta: aceite 1× guardado no perfil; se mudar
// aqui, o login pede re-aceite. Guest: aceite 1× guardado no aparelho
// (localStorage), também amarrado à versão. Incremente a cada mudança.
const TERMOS_VERSAO = '1.0';
window.TERMOS_VERSAO = TERMOS_VERSAO;

function _clienteLocal() {
  try { return JSON.parse(_lsGet(CLIENTE_LOCAL_KEY) || '{}') || {}; }
  catch { return {}; }
}
function _mesclarClienteLocal(patch) {
  _lsSet(CLIENTE_LOCAL_KEY, JSON.stringify({ ..._clienteLocal(), ...patch }));
}

function salvarDadosPessoaisLocal() {
  const email = (document.getElementById('f-email')?.value || '').trim().toLowerCase();
  const dados = {
    nome: document.getElementById('f-nome')?.value?.trim() || '',
    nasc: document.getElementById('f-nasc')?.value?.trim() || '',
    ddi:  document.getElementById('f-ddi')?.value || '+55',
    fone: document.getElementById('f-fone')?.value?.trim() || '',
  };
  if (!dados.nome) return;
  // Logado tem o campo oculto/vazio — mescla pra não apagar o e-mail salvo.
  if (email) dados.email = email;
  _mesclarClienteLocal(dados);
}

function restaurarDadosPessoaisLocal() {
  const dados = _clienteLocal();

  const nome = document.getElementById('f-nome');
  const nasc = document.getElementById('f-nasc');
  const ddi  = document.getElementById('f-ddi');
  const fone = document.getElementById('f-fone');
  const mail = document.getElementById('f-email');
  // Só preenche campos vazios — nunca sobrescreve o que o cliente já digitou.
  if (nome && !nome.value && dados.nome) nome.value = dados.nome;
  if (nasc && !nasc.value && dados.nasc) nasc.value = dados.nasc;
  if (ddi  && dados.ddi) ddi.value = dados.ddi;
  if (fone && !fone.value && dados.fone) fone.value = dados.fone;
  if (mail && !mail.value && dados.email) mail.value = dados.email;
}

function esquecerDadosPessoaisLocal() {
  try { localStorage.removeItem(CLIENTE_LOCAL_KEY); } catch { /* ignore */ }
}

// Aceite de termos do guest: 1× por aparelho, amarrado à versão atual.
// Logado nunca usa isso — o aceite dele mora no perfil (_csTermosOk).
function _termosGuestOk() {
  return !window._csLogado && _clienteLocal().termos === TERMOS_VERSAO;
}
function _salvarTermosLocal() {
  _mesclarClienteLocal({ termos: TERMOS_VERSAO });
}

// Localiza a promoção do serviço. O admin salva grupos com id sem prefixo
// ('amarracao'), mas o site usa 'grupo:amarracao' — aceita os dois formatos.
function _promoDoServico(serviceId) {
  if (!serviceId || typeof _configCache === 'undefined' || !_configCache?.promocoes) return null;
  return _configCache.promocoes.find(p => p.id === serviceId || `grupo:${p.id}` === serviceId) || null;
}

function calcularPrecoFinal(precoOriginal) {
  const preco = parseFloat(precoOriginal) || 0;
  const servico = _promoDoServico(Estado.serviceId);
  if (servico?.descontoAtivo && servico.percentualDesconto > 0) {
    const pct   = servico.percentualDesconto;
    const final = Math.round(preco * (100 - pct)) / 100;
    return { final, desconto: preco - final };
  }
  return { final: preco, desconto: 0 };
}

// Preço aplicando o desconto promocional do serviço, se houver.
function _precoComPromoServico(precoOriginal, serviceId) {
  const preco = parseFloat(precoOriginal) || 0;
  const servico = _promoDoServico(serviceId);
  if (servico?.descontoAtivo && servico.percentualDesconto > 0) {
    return Math.round(preco * (100 - servico.percentualDesconto)) / 100;
  }
  return preco;
}

// Recebe itens com { valor_original, preco_base } e devolve cada um com
// valor_final / desconto_aplicado calculados. O preço já vem com a promoção
// do serviço aplicada (preco_base), então aqui é só consolidar os valores.
function _aplicarDescontosCarrinho(itens) {
  return itens.map((it) => {
    const original = parseFloat(it.valor_original) || 0;
    const final    = it.preco_base ?? original;
    return {
      ...it,
      valor_final: final,
      desconto_aplicado: original - final,
    };
  });
}

async function abrirSeletor(ref) {
  // Salva elemento que tinha foco pra restaurar depois
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.setAttribute('data-last-focus', '');
  }
  // Zera seleção de naipe pendente (evita vazar pro confirmarSeletor de outro serviço)
  _seletorNaipe     = null;
  _seletorNaipeBase = null;
  let tipos;
  try {
    tipos = await _garantirTipos();
  } catch (err) {
    console.error('abrirSeletor: falha ao carregar tipos', err);
    mostrarAlerta('Erro de conexão. Verifique sua internet e tente novamente.', 'error');
    return;
  }

  const isGrupo = typeof ref === 'string' && ref.startsWith('grupo:');
  if (isGrupo) {
    const grupoSlug = ref.slice(6);
    const tiers = tipos
      .filter(t => t.grupo_slug === grupoSlug)
      .sort((a, b) => Number(a.preco_original) - Number(b.preco_original));
    if (!tiers.length) {
      mostrarAlerta('Serviço temporariamente indisponível. Tente novamente.', 'error');
      return;
    }
    return _abrirSeletorGrupo(grupoSlug, tiers);
  }

  const tipo = typeof ref === 'number'
    ? tipos.find(t => t.id === ref)
    : tipos.find(t => t.slug === ref || t.id === Number(ref));

  if (!tipo) {
    console.warn('Tipo não encontrado:', ref);
    mostrarAlerta('Serviço temporariamente indisponível. Tente novamente.', 'error');
    return;
  }

  if (_ehNaipe(tipo)) {
    return _abrirSeletorNaipes(tipo);
  }

  _seletorTipo     = tipo;
  Estado.serviceId = tipo.slug || tipo.id;
  _seletorQty      = 1;

  const tiersEl    = document.getElementById('seletor-tiers');
  const qtyEl      = document.getElementById('seletor-qty-wrap');
  const resumoEl   = document.getElementById('seletor-resumo');
  const btnConfirm = document.getElementById('seletor-btn-confirm');

  document.getElementById('seletor-nome').textContent     = tipo.nome;
  document.getElementById('seletor-pergunta').textContent = tipo.especial
    ? 'Confirme para escolher o dia'
    : 'Quantas sessões?';

  if (tiersEl) { tiersEl.innerHTML = ''; tiersEl.style.display = 'none'; }
  qtyEl.style.display    = _tipoMaxQty(tipo) === 1 ? 'none' : 'flex';
  resumoEl.style.display = 'flex';
  _atualizarResumoSeletor();
  btnConfirm.removeAttribute('disabled');

  document.getElementById('seletor-overlay').classList.add('open');
  document.body.classList.add('seletor-aberto');
  // Move o foco para dentro do diálogo
  setTimeout(() => document.querySelector('.seletor-card')?.focus(), 280);

  // Fecha com Escape (handler único; removido em fecharSeletor)
  document.addEventListener('keydown', _escSeletorHandler);
}

function _abrirSeletorGrupo(grupoSlug, tiers) {
  const principal = tiers[0];

  _seletorTipo     = null;
  _seletorQty      = 1;
  Estado.serviceId = `grupo:${grupoSlug}`;

  const tiersEl    = document.getElementById('seletor-tiers');
  const qtyEl      = document.getElementById('seletor-qty-wrap');
  const resumoEl   = document.getElementById('seletor-resumo');
  const btnConfirm = document.getElementById('seletor-btn-confirm');

  document.getElementById('seletor-nome').textContent     = _nomeGrupo(principal);
  document.getElementById('seletor-pergunta').textContent = principal.requer_pergunta
    ? 'Quantas perguntas?'
    : 'Escolha uma opção';

  tiersEl.innerHTML = '';
  tiers.forEach(tier => {
    const { final } = calcularPrecoFinal(tier.preco_original);
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'seletor-tier-opt';
    opt.innerHTML = `
      <span class="tier-label">${_escCat(tier.tier_label || tier.nome)}</span>
      <div class="tier-info">
        <span class="tier-preco">${fmtBRL(final)}</span>
      </div>`;
    opt.addEventListener('click', () => {
      tiersEl.querySelectorAll('.seletor-tier-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      _seletorTipo = tier;
      btnConfirm.removeAttribute('disabled');
    });
    tiersEl.appendChild(opt);
  });

  tiersEl.style.display  = 'flex';
  qtyEl.style.display    = 'none';
  resumoEl.style.display = 'none';
  btnConfirm.setAttribute('disabled', '');

  document.getElementById('seletor-overlay').classList.add('open');
  document.body.classList.add('seletor-aberto');
  // Move o foco para dentro do diálogo
  setTimeout(() => document.querySelector('.seletor-card')?.focus(), 280);

  // Fecha com Escape (handler único; removido em fecharSeletor)
  document.addEventListener('keydown', _escSeletorHandler);
}

// Seletor dos 4 naipes (tema). Preço só depende da qtd de perguntas, que é
// escolhida depois (na tela da leitura), então aqui mostramos "a partir de".
function _abrirSeletorNaipes(tipo) {
  _seletorTipo      = null;
  _seletorNaipe     = null;
  _seletorNaipeBase = tipo;
  _seletorQty       = 1;
  Estado.serviceId  = tipo.slug || tipo.id;

  const tiersEl    = document.getElementById('seletor-tiers');
  const qtyEl      = document.getElementById('seletor-qty-wrap');
  const resumoEl   = document.getElementById('seletor-resumo');
  const btnConfirm = document.getElementById('seletor-btn-confirm');

  document.getElementById('seletor-nome').textContent     = tipo.nome;
  document.getElementById('seletor-pergunta').textContent = 'Escolha o tema da sua leitura';

  const precoBase = fmtBRL(precoNaipe(1));
  tiersEl.innerHTML = '';
  NAIPES.forEach(naipe => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = `seletor-tier-opt naipe-opt naipe-${naipe.cor}`;
    opt.innerHTML = `
      <span class="naipe-top">
        <span class="tier-label"><span class="naipe-simbolo" aria-hidden="true">${naipe.simbolo}</span>${_escCat(naipe.nome)}</span>
        <span class="tier-preco"><small>a partir de</small>${precoBase}</span>
      </span>
      <span class="naipe-desc">${_escCat(naipe.desc)}</span>`;
    opt.addEventListener('click', () => {
      tiersEl.querySelectorAll('.seletor-tier-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      _seletorNaipe = naipe;
      btnConfirm.removeAttribute('disabled');
    });
    tiersEl.appendChild(opt);
  });

  tiersEl.style.display  = 'flex';
  qtyEl.style.display    = 'none';
  resumoEl.style.display = 'none';
  btnConfirm.setAttribute('disabled', '');

  document.getElementById('seletor-overlay').classList.add('open');
  document.body.classList.add('seletor-aberto');
  setTimeout(() => document.querySelector('.seletor-card')?.focus(), 280);
  document.addEventListener('keydown', _escSeletorHandler);
}

function _atualizarResumoSeletor() {
  const tipo = _seletorTipo;
  if (!tipo) return;
  const total    = tipo.preco_original * _seletorQty;
  const { final } = calcularPrecoFinal(total);

  document.getElementById('seletor-qty').textContent   = _seletorQty;
  document.getElementById('seletor-preco').textContent = fmtBRL(final);
}

function alterarQty(delta) {
  const max = _tipoMaxQty(_seletorTipo);
  _seletorQty = Math.max(1, Math.min(max, _seletorQty + delta));
  _atualizarResumoSeletor();
}

function _escSeletorHandler(e) {
  if (e.key === 'Escape') fecharSeletor();
}

function fecharSeletor() {
  _seletorNaipe     = null;
  _seletorNaipeBase = null;
  document.removeEventListener('keydown', _escSeletorHandler);
  document.getElementById('seletor-overlay')?.classList.remove('open');
  document.body.classList.remove('seletor-aberto');
  // Restaura foco pro gatilho
  const trigger = document.querySelector('[data-last-focus]');
  if (trigger) { trigger.focus(); trigger.removeAttribute('data-last-focus'); }
}

function confirmarSeletor() {
  // Naipes da Pomba Gira: tema escolhido; perguntas e preço vêm na tela seguinte.
  if (_seletorNaipe && _seletorNaipeBase) {
    const t = _seletorNaipeBase;
    const n = _seletorNaipe;
    const tipoFinal = {
      ...t,
      terapeuta:      t.terapeuta,
      especial:       false,
      requerPergunta: true,
      isNaipe:        true,
      naipe:          n.id,
      naipeLabel:     `${n.simbolo} ${n.nome}`,
      naipeDesc:      n.desc,
      num_perguntas:  1,
      preco_original: precoNaipe(1),
      nome:           `${t.nome} — ${n.simbolo} ${n.nome}`,
    };
    fecharSeletor();
    abrirModal(tipoFinal);
    return;
  }

  if (!_seletorTipo) return;

  const t = _seletorTipo;
  const tipoFinal = {
    ...t,
    terapeuta:       t.terapeuta,
    especial:        !!t.especial,
    requerPergunta:  !!t.requer_pergunta,
    preco_original:  t.preco_original * _seletorQty,
    nome: _seletorQty > 1 ? `${t.nome} (×${_seletorQty})` : t.nome,
  };

  fecharSeletor();
  abrirModal(tipoFinal);
}

// adicionarOutraLeitura está em modal-agendamento.js (onde _ofereceRetomar reside)

// ============================================================
// STEP 1 — Calendário de Vagas
// ============================================================
async function carregarCalendario() {
  const cal = document.getElementById('calendario');
  if (!cal) return;
  cal.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando disponibilidade…</div>';

  const profissional = Estado.tipoSelecionado?.terapeuta;
  if (!profissional) {
    cal.innerHTML = '<div class="ag-empty">Selecione um serviço primeiro.</div>';
    return;
  }

  try {
    const isEspecial = !!Estado.tipoSelecionado?.especial;
    const dias = isEspecial
      ? await _buscarDiasEspeciais(profissional, 90)
      : await _buscarDiasComVagas(profissional, 6);

    if (!dias.length) {
      const numero = WHATSAPP_TERAPEUTA[profissional] || '';
      cal.innerHTML = `
        <div class="ag-empty ag-empty-vagas">
          <p><strong>Nossa agenda está cheia por agora.</strong></p>
          <p style="font-size:.87rem; margin-top:4px;">Chame a gente no WhatsApp que avisamos assim que abrir um novo dia.</p>
          ${numero ? `<a href="https://wa.me/${numero}" target="_blank" rel="noopener" class="ag-btn ag-btn-whatsapp" style="margin-top:14px; display:inline-flex;"><svg class="ico" aria-hidden="true"><use href="#ico-balao"></use></svg> Avisar quando abrir vaga</a>` : ''}
        </div>`;
      return;
    }

    cal.innerHTML = '';
    cal.className = 'ag-vagas-lista';

    dias.forEach(({ data, vagas, ate_horario }) => {
      const [aY, aM, aD] = data.split('-').map(Number);
      const d = new Date(aY, aM - 1, aD);
      const card = document.createElement('div');
      card.className = 'ag-vagas-card';

      const entregaLabel = ate_horario ? `Chega até as ${ate_horario.slice(0, 5)}` : 'Chega ao longo do dia';
      const vagasText    = vagas === 1 ? 'Última vaga!' : (vagas <= 2 ? `Restam só ${vagas} vagas` : `${vagas} vagas`);
      const cls          = vagas <= 2 ? 'vagas-poucas' : 'vagas-ok';

      card.innerHTML = `
        <div class="ag-vagas-data">
          <span class="ag-vagas-dia-num">${d.getDate()}</span>
          <div class="ag-vagas-dia-info">
            <span class="ag-vagas-dia-nome">${DIAS_PT[d.getDay()]}</span>
            <span class="ag-vagas-mes">${MESES_PT[d.getMonth()]}</span>
          </div>
        </div>
        <div class="ag-vagas-info ${cls}">
          <span class="ag-vagas-entrega">${entregaLabel}</span>
          <span class="ag-vagas-badge">${vagasText}</span>
        </div>
        <span class="ag-vagas-action" aria-hidden="true">Escolher <svg class="ico" aria-hidden="true"><use href="#ico-seta-direita"></use></svg></span>`;

      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Agendar em ${DIAS_PT[d.getDay()]}, ${d.getDate()} de ${MESES_PT[d.getMonth()]} — ${vagasText}`);
      card.addEventListener('click', () => selecionarData(data, ate_horario, card));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selecionarData(data, ate_horario, card); } });
      cal.appendChild(card);
    });
  } catch (err) {
    console.error('carregarCalendario:', err);
    cal.innerHTML = '<div class="ag-empty">Erro ao carregar disponibilidade. Tente novamente.</div>';
  }
}

async function irParaPagamentoCarrinho() {
  if (Estado.carrinho.length === 0) {
    mostrarAlerta('Adicione pelo menos uma leitura ao pedido.', 'error');
    return;
  }

  // Sem aceite em dia (perfil OU aparelho), o checkbox é obrigatório
  // antes de pagar (guest novo, logado sem perfil ou termos velhos).
  const termosChk = document.getElementById('carrinho-termos');
  if (!window._csTermosOk && !_termosGuestOk() && !(termosChk && termosChk.checked)) {
    mostrarAlerta('Aceite os Termos de Uso para continuar.', 'error');
    return;
  }

  const btn = document.getElementById('btn-ir-pagar');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="ag-btn-spinner" aria-hidden="true"></span> Salvando seu pedido…';
  }

  // Calcula os itens (com desconto distribuído) ANTES de salvar/limpar o carrinho.
  // Esse mesmo snapshot alimenta a tela de pagamento.
  const itens = _aplicarDescontosCarrinho(Estado.carrinho);
  const cupomSnap = Estado.cupom; // capturado antes de limpar

  try {
    const chave = await salvarMultiplosAgendamentos(itens);
    Estado.carrinho = [];
    Estado.cupom = null;
    // Guest: aceite fica no aparelho — próximos pedidos não repetem o checkbox.
    if (termosChk?.checked) _salvarTermosLocal();
    if (termosChk) termosChk.checked = false;
    _renderizarCarrinho();
    if (chave) redirecionarParaPagamento(chave, itens, cupomSnap);
  } catch (err) {
    console.error('irParaPagamentoCarrinho:', err);
    const msg = err?.userMessage ? err.message : 'Erro ao salvar. Tente novamente.';
    mostrarAlerta(msg, 'error');
    if (btn) { btn.disabled = false; _atualizarBotoesCarrinho(); }
  }
}

window.irParaPagamentoCarrinho = irParaPagamentoCarrinho;

async function _buscarDiasComVagas(profissional, diasParaFrente) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = dataParaISO(hoje);
  const dataFim    = dataParaISO(new Date(hoje.getTime() + diasParaFrente * 86400000));

  const [
    { data: overrides },
    { data: contagens },
  ] = await Promise.all([
    supabase.from('disponibilidade_override').select('*').eq('profissional', profissional).gte('data', dataInicio).lte('data', dataFim),
    supabase.rpc('contar_agendamentos_por_data', {
      p_terapeuta: profissional,
      p_inicio:    dataInicio,
      p_fim:       dataFim,
    }),
  ]);

  const overrideMap = {};
  (overrides || []).forEach(o => { overrideMap[o.data] = o; });

  const contagemMap = {};
  (contagens || []).forEach(c => {
    contagemMap[c.data_agendamento] = Number(c.total) || 0;
  });

  const dias = [];
  for (let i = 0; i <= diasParaFrente; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    const str    = dataParaISO(d);
    const usadas = contagemMap[str] || 0;

    const ov = overrideMap[str];
    if (ov && ov.ativo) {
      const restantes = Math.max(0, ov.vagas_total - usadas);
      if (restantes > 0) {
        if (i === 0) {
          const ateH = ov.ate_horario || '18:00';
          const [h, m] = ateH.split(':').map(Number);
          const limite = new Date(); limite.setHours(h, m, 0, 0);
          limite.setMinutes(limite.getMinutes() - CUTOFF_BUFFER_MIN);
          if (new Date() >= limite) continue;
        }
        dias.push({ data: str, vagas: restantes, ate_horario: ov.ate_horario });
      }
    }
  }

  return dias;
}

async function _buscarDiasEspeciais(profissional, diasParaFrente) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = dataParaISO(hoje);
  const dataFim    = dataParaISO(new Date(hoje.getTime() + diasParaFrente * 86400000));

  const { data: especiais } = await supabase
    .from('disponibilidade_especial')
    .select('*')
    .eq('profissional', profissional)
    .gte('data', dataInicio)
    .lte('data', dataFim)
    .gt('vagas_restantes', 0);

  const agora = new Date();
  const hojeStr = dataParaISO(new Date());
  const dias = (especiais || []).filter(e => {
    if (!e.ativo) return false;
    if (e.data === hojeStr && e.ate_horario) {
      const [h, m] = e.ate_horario.split(':').map(Number);
      const limite = new Date(); limite.setHours(h, m, 0, 0);
      limite.setMinutes(limite.getMinutes() - CUTOFF_BUFFER_MIN);
      if (agora >= limite) return false;
    }
    return true;
  }).map(e => ({
    data: e.data,
    vagas: e.vagas_restantes,
    ate_horario: e.ate_horario,
  }));

  return dias.sort((a, b) => a.data.localeCompare(b.data));
}

function selecionarData(dataStr, ateHorario, cardEl) {
  document.querySelectorAll('#calendario .ag-vagas-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  Estado.dataSelecionada = dataStr;
  Estado.horarioSelecionado = ateHorario || null;
  // Se dados pessoais já preenchidos (2ª leitura do carrinho), pula direto para perguntas
  const proximoPasso = Estado.dadosPessoais.nome ? 2 : 0;
  setTimeout(() => irParaPasso(proximoPasso), 250);
}

// ============================================================
// STEP 2 — Formulário
// ============================================================
function atualizarResumo() {
  const tipo = Estado.tipoSelecionado;
  const data = Estado.dataSelecionada;
  if (!tipo || !data) return;

  // Simula esta leitura entrando no carrinho para refletir o preço real.
  // Naipes não entram em promoção: preço = progressão (30/56/78/96).
  const tentativa = {
    valor_original: tipo.preco_original,
    preco_base: _ehNaipe(tipo)
      ? tipo.preco_original
      : _precoComPromoServico(tipo.preco_original, Estado.serviceId),
  };
  const simulado = _aplicarDescontosCarrinho([...Estado.carrinho, tentativa]);
  const esta = simulado[simulado.length - 1];
  const final = esta.valor_final;
  const desconto = esta.desconto_aplicado;

  const [rY, rM, rD] = data.split('-').map(Number);
  const d = new Date(rY, rM - 1, rD);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('res-tipo',    tipo.nome);
  set('res-data',    `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`);
  const horaLabel = Estado.horarioSelecionado ? `até as ${Estado.horarioSelecionado.slice(0,5)}` : 'no dia';
  set('res-hora',    horaLabel);
  set('res-valor',   fmtBRL(final));

  const linhaDesc = document.getElementById('res-desconto-linha');
  if (linhaDesc) linhaDesc.style.display = desconto > 0 ? 'flex' : 'none';
  set('res-desconto', `- ${fmtBRL(desconto)}`);
}

function processarFormulario(e) {
  e.preventDefault();
  if (!validarFormulario()) return;

  adicionarAoCarrinho();
}

function adicionarAoCarrinho() {
  const tipo = Estado.tipoSelecionado;
  if (!tipo || !Estado.dataSelecionada) return;

  // Limite de 4 leituras por pedido (o botão do catálogo não passa pelo
  // btn-add-leitura desabilitado, então o guard precisa ficar aqui também)
  if (Estado.carrinho.length >= 4) {
    mostrarAlerta('Máximo de 4 leituras por pedido. Finalize este pedido antes de adicionar mais.', 'error');
    irParaPasso(3);
    return;
  }

  let obs = _coletarObservacoes(tipo);
  // Pessoas envolvidas (campo opcional acima das perguntas): entra no topo
  // das observações — a Camila vê tudo junto no painel. Leitura sem
  // perguntas (obs vazia) vira "Leitura para: fulano".
  const pessoas = document.getElementById('f-pessoas')?.value?.trim();
  if (pessoas) {
    obs = obs ? `Pessoas envolvidas:\n${pessoas}\n\n${obs}` : `Leitura para: ${pessoas}`;
  }
  // Naipes: registra o naipe (tema) escolhido no topo das observações.
  if (_ehNaipe(tipo) && tipo.naipeLabel) {
    const cabecalho = `Naipe: ${tipo.naipeLabel} — ${tipo.naipeDesc}`;
    obs = obs ? `${cabecalho}\n\n${obs}` : cabecalho;
  }

  const item = {
    tipo,
    serviceId: Estado.serviceId,
    terapeuta: tipo.terapeuta || null,
    data: Estado.dataSelecionada,
    horario: Estado.horarioSelecionado || '00:00',
    observacoes: obs,
    valor_original: tipo.preco_original,
    preco_base: _ehNaipe(tipo)
      ? tipo.preco_original
      : _precoComPromoServico(tipo.preco_original, Estado.serviceId),
    agendamento_especial: !!tipo.especial,
    num_perguntas: _numeroDePerguntas(tipo),
  };

  Estado.carrinho.push(item);
  Estado.tipoSelecionado = null;
  Estado.dataSelecionada = null;
  Estado.horarioSelecionado = null;

  // Limpa campos de pergunta para evitar colisão de IDs na próxima leitura
  const obsGroup = document.getElementById('f-obs-group');
  if (obsGroup) {
    const textareas = obsGroup.querySelectorAll('textarea');
    textareas.forEach(ta => ta.value = '');
  }
  const pessoasEl = document.getElementById('f-pessoas');
  if (pessoasEl) pessoasEl.value = '';

  _renderizarCarrinho();
  irParaPasso(3);
}

function _renderizarCarrinho() {
  const container = document.getElementById('carrinho-lista');
  if (!container) return;

  if (Estado.carrinho.length === 0) {
    container.innerHTML = '<p class="ag-empty" style="padding:16px;">Seu pedido está vazio por enquanto. 🌱</p>';
    _atualizarBotoesCarrinho();
    return;
  }

  const itens = _aplicarDescontosCarrinho(Estado.carrinho);
  const totalOriginal = itens.reduce((s, i) => s + (parseFloat(i.valor_original) || 0), 0);
  const totalDesconto = itens.reduce((s, i) => s + i.desconto_aplicado, 0);
  const totalFinal    = itens.reduce((s, i) => s + i.valor_final, 0);

  let html = '';
  itens.forEach((item, idx) => {
    const dataStr = item.data;
    const [aY, aM, aD] = dataStr.split('-').map(Number);
    const d = new Date(aY, aM - 1, aD);
    const nome = item.tipo.tier_label || item.tipo.nome;
    const entregaLabel = item.horario && item.horario !== '00:00'
      ? `Chega até as ${item.horario.slice(0,5)}`
      : 'Chega no dia';
    html += `
      <div class="cart-item">
        <div class="cart-item-header">
          <strong>${_escCat(nome)}</strong>
          <button class="cart-item-remove" data-idx="${idx}" aria-label="Remover leitura" type="button"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg></button>
        </div>
        <div class="cart-item-details">
          <span>${d.getDate()} de ${MESES_PT[d.getMonth()]}</span>
          <span>${entregaLabel}</span>
        </div>
        <div class="cart-item-price">${fmtBRL(item.valor_final)}</div>
      </div>`;
  });

  const cupomDesc     = _cupomDesconto(itens);
  const totalComCupom = totalFinal - cupomDesc;

  html += `<div class="cart-total">
    <div class="cart-total-row">
      <span>Subtotal</span><span>${fmtBRL(totalOriginal)}</span>
    </div>`;
  if (totalDesconto > 0) {
    html += `<div class="cart-total-row cart-total-desc">
      <span>Desconto</span><span>- ${fmtBRL(totalDesconto)}</span>
    </div>`;
  }
  if (cupomDesc > 0) {
    html += `<div class="cart-total-row cart-total-desc">
      <span>Cupom ${_escCat(Estado.cupom.codigo)}</span><span>- ${fmtBRL(cupomDesc)}</span>
    </div>`;
  }
  html += `<div class="cart-total-row cart-total-final">
      <span>Total</span><span>${fmtBRL(totalComCupom)}</span>
    </div>
  </div>`;

  // Campo de cupom (comunidade): aplica desconto fixo no total.
  if (Estado.cupom) {
    html += `<div class="cart-cupom cart-cupom-ok">
      <span><svg class="ico" aria-hidden="true"><use href="#ico-etiqueta"></use></svg> Cupom <strong>${_escCat(Estado.cupom.codigo)}</strong> aplicado</span>
      <button type="button" class="cart-cupom-remover" onclick="removerCupom()">Remover</button>
    </div>`;
  } else {
    html += `<div class="cart-cupom">
      <input type="text" id="f-cupom" class="cart-cupom-input" placeholder="Tem um cupom?"
             autocomplete="off" maxlength="32" onkeydown="if(event.key==='Enter'){event.preventDefault();aplicarCupom();}">
      <button type="button" class="ag-btn ag-btn-outline cart-cupom-btn" onclick="aplicarCupom()">Aplicar</button>
    </div>
    <p class="cart-cupom-msg" id="cupom-msg" role="alert" aria-live="polite"></p>`;
  }

  html += `<p class="cart-entrega-aviso"><svg class="ico" aria-hidden="true"><use href="#ico-balao"></use></svg> Sua leitura será enviada por WhatsApp até o horário indicado em cada item.</p>`;

  container.innerHTML = html;

  // Eventos de remover
  container.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      Estado.carrinho.splice(idx, 1);
      // Carrinho vazio: limpa o cupom para não reaplicar (sem revalidar) num
      // carrinho novo — evita cupom-fantasma e cobrança a menor no naipe.
      if (Estado.carrinho.length === 0) Estado.cupom = null;
      _renderizarCarrinho();
      _atualizarBotoesCarrinho();
      if (Estado.carrinho.length === 0) irParaPasso(1);
    });
  });

  _atualizarBotoesCarrinho();
}

// ============================================================
// CUPOM — valida via RPC validar_cupom (anon) e aplica no total.
// ============================================================
async function aplicarCupom() {
  const input = document.getElementById('f-cupom');
  const msg   = document.getElementById('cupom-msg');
  const codigo = (input?.value || '').trim().toUpperCase();
  if (!codigo) { if (msg) msg.textContent = 'Digite um código de cupom.'; return; }

  const btn = document.querySelector('.cart-cupom-btn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    const { data, error } = await supabase.rpc('validar_cupom', { p_codigo: codigo });
    const linha = Array.isArray(data) ? data[0] : data;
    if (error) throw error;
    if (linha?.valido) {
      Estado.cupom = { codigo, valor: Number(linha.valor_desconto) || 0 };
      _renderizarCarrinho();
    } else if (linha?.precisa_login) {
      // Cupom pessoal digitado deslogado: sem a dica, o dono legítimo
      // (que recebeu o código por e-mail) só veria "inválido".
      if (msg) msg.textContent = 'Esse cupom é pessoal — entre na sua conta (ícone no topo do site) e aplique de novo.';
      if (btn) { btn.disabled = false; btn.textContent = 'Aplicar'; }
    } else {
      if (msg) msg.textContent = 'Cupom inválido ou expirado.';
      if (btn) { btn.disabled = false; btn.textContent = 'Aplicar'; }
    }
  } catch (e) {
    console.error('aplicarCupom:', e);
    if (msg) msg.textContent = 'Erro ao validar o cupom. Tente novamente.';
    if (btn) { btn.disabled = false; btn.textContent = 'Aplicar'; }
  }
}

function removerCupom() {
  Estado.cupom = null;
  _renderizarCarrinho();
}

// Revalida o cupom aplicado quando a sessão muda (login/logout no drawer).
// Cupom pessoal validado logado morreria só na criar_pedido após o logout —
// erro genérico no fim do checkout. Aqui ele sai do carrinho na hora, avisando.
window._csRevalidarCupom = async function () {
  if (!Estado.cupom) return;
  try {
    const { data, error } = await supabase.rpc('validar_cupom', { p_codigo: Estado.cupom.codigo });
    if (error) return; // erro de rede: não pune o cupom
    const linha = Array.isArray(data) ? data[0] : data;
    if (!linha?.valido) {
      Estado.cupom = null;
      try { _renderizarCarrinho(); } catch (_) { /* carrinho fora da tela */ }
      const msg = document.getElementById('cupom-msg');
      if (msg) msg.textContent = 'O cupom saiu do pedido: ele é pessoal e a conta mudou.';
    }
  } catch (_) { /* melhor manter o cupom do que removê-lo por falha de rede */ }
};

window.aplicarCupom = aplicarCupom;
window.removerCupom = removerCupom;

function _atualizarBotoesCarrinho() {
  const addBtn   = document.getElementById('btn-add-leitura');
  const payBtn   = document.getElementById('btn-ir-pagar');
  const termosEl = document.getElementById('termosAceiteCarrinho');
  const termosChk = document.getElementById('carrinho-termos');
  if (addBtn) addBtn.disabled = Estado.carrinho.length >= 4;

  // Aceite em dia pula o checkbox: logado pelo perfil (_csTermosOk),
  // guest pelo aceite salvo no aparelho (1×, amarrado à versão). Logado
  // sem perfil completo ou com termos desatualizados vê — sem isso ele
  // pagaria sem aceite nenhum e o pedido ficaria sem prova no banco.
  const temItens = Estado.carrinho.length > 0;
  const exigeTermos = temItens && !window._csTermosOk && !_termosGuestOk();
  if (termosEl) termosEl.hidden = !exigeTermos;

  if (payBtn) {
    if (temItens) {
      const itens = _aplicarDescontosCarrinho(Estado.carrinho);
      const totalFinal = itens.reduce((s, i) => s + i.valor_final, 0);
      const total = totalFinal - _cupomDesconto(itens);
      const n = Estado.carrinho.length;
      const label = n === 1 ? '1 leitura' : `${n} leituras`;
      payBtn.style.display = '';
      // Trava o botão até aceitar os termos (quando exigido).
      payBtn.disabled = exigeTermos && !(termosChk && termosChk.checked);
      payBtn.innerHTML = `Pagar ${fmtBRL(total)} · ${label} <svg class="ico" aria-hidden="true"><use href="#ico-seta-direita"></use></svg>`;
    } else {
      payBtn.style.display = 'none';
    }
  }
  if (typeof window._atualizarBotaoRetomar === 'function') window._atualizarBotaoRetomar();
}
window._atualizarBotoesCarrinho = _atualizarBotoesCarrinho;

// Marcar/desmarcar o aceite reabilita/trava o botão de pagar na hora.
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'carrinho-termos') _atualizarBotoesCarrinho();
});

function _prepararDadosPessoais() {
  Estado.dadosPessoais = {
    nome: (document.getElementById('f-nome')?.value || '').trim(),
    nascimento: dataBrParaISO(document.getElementById('f-nasc')?.value || ''),
    whatsapp: obterWhatsappCompleto(),
    // Guest: chave da adoção futura do pedido (reivindicar_pedidos).
    // Logado: o campo fica oculto e o servidor usa o e-mail do JWT.
    email: (document.getElementById('f-email')?.value || '').trim().toLowerCase(),
  };
}

// ============================================================
// Trava de menor de idade (decisão 2026-07-21)
// ============================================================
// Menor de 18 não segue pro pagamento: o formulário escurece e o caminho
// vira o zap do terapeuta da leitura, onde o responsável manda a autorização.
// O atendimento do menor autorizado é combinado manualmente por lá.
function _calcularIdade(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const hoje = new Date();
  let idade = hoje.getFullYear() - y;
  const fezAniversario = (hoje.getMonth() + 1 > m) ||
    (hoje.getMonth() + 1 === m && hoje.getDate() >= d);
  if (!fezAniversario) idade--;
  return idade;
}

function _ehMenorDeIdade() {
  const iso = dataBrParaISO(document.getElementById('f-nasc')?.value || '');
  return iso ? _calcularIdade(iso) < 18 : false;
}

function _atualizarTravaMenor() {
  const form  = document.getElementById('form-dados-pessoais');
  const aviso = document.getElementById('f-nasc-menor');
  if (!form || !aviso) return;
  const menor = _ehMenorDeIdade();
  aviso.hidden = !menor;
  form.classList.toggle('menor-trava', menor);
  // pointer-events não segura Tab+Enter — o botão precisa de disabled de verdade
  const btn = form.querySelector('.ag-btn-primary');
  if (btn) btn.disabled = menor;
  if (menor) {
    const ter    = Estado.tipoSelecionado?.terapeuta;
    const numero = WHATSAPP_TERAPEUTA[ter] || WHATSAPP_TERAPEUTA.camila;
    const leitura = Estado.tipoSelecionado?.nome;
    const msg = `Olá! Quero agendar${leitura ? ` a leitura "${leitura}"` : ' uma leitura'} no Cocar Sagrado, mas tenho menos de 18 anos. Como faço para meu responsável enviar a autorização?`;
    const link = document.getElementById('f-nasc-menor-zap');
    if (link) link.href = `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
  }
}

function validarDadosPessoais() {
  // Menor: nem valida o resto — devolve o olhar pro aviso.
  if (_ehMenorDeIdade()) {
    _atualizarTravaMenor();
    document.getElementById('f-nasc-menor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  let ok = true;
  const campos = [
    { id: 'f-nome', minLen: 3, msg: 'Nome deve ter pelo menos 3 caracteres.' },
    { id: 'f-nasc', date: true, msg: 'Data de nascimento inválida.' },
    { id: 'f-fone', fone: true, msg: 'Número inválido.' },
  ];
  // E-mail só é exigido de guest — logado nem vê o campo (vai o da conta).
  if (!window._csLogado) campos.push({ id: 'f-email', email: true, msg: 'E-mail inválido.' });
  campos.forEach(({ id, minLen, date, email, fone, msg }) => {
    const el = document.getElementById(id);
    if (!el) return;
    _limparErroField(el);
    const val = el.value.trim();
    const invalido = date
      ? (() => {
          const iso = dataBrParaISO(val);
          if (!iso) return true;
          const [y, m, dd] = iso.split('-').map(Number);
          const d = new Date(y, m - 1, dd);
          // rejeita datas inexistentes (ex.: 31/02) que o Date "corrige"
          if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== dd) return true;
          const hoje = new Date();
          const minData = new Date(hoje.getFullYear() - 120, hoje.getMonth(), hoje.getDate());
          const maxData = new Date(hoje.getFullYear() - 10, hoje.getMonth(), hoje.getDate());
          return d > hoje || d > maxData || d < minData;
        })()
      : email
        ? !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)
        : fone
          ? (() => {
              // Conta só dígitos — "(27) 9" tem 6 caracteres mas 3 dígitos,
              // e passava na regra antiga de minLen (contava a máscara).
              const digitos = val.replace(/\D/g, '').length;
              // +55: DDD + 8/9 dígitos. Outros DDIs (campo livre): mínimo 6.
              return document.getElementById('f-ddi')?.value === '+55'
                ? digitos < 10
                : digitos < 6;
            })()
          : val.length < minLen;
    if (invalido) { el.classList.add('error'); mostrarErroField(el, msg); ok = false; }
  });
  if (!ok) _focarPrimeiroErro();
  return ok;
}

function _focarPrimeiroErro() {
  document.querySelector('.ag-form input.error, .ag-form textarea.error, .ag-form select.error')?.focus();
}

function confirmarDadosPessoais() {
  if (!validarDadosPessoais()) return;
  _prepararDadosPessoais();
  // Todo mundo é lembrado no aparelho (guest incluso — decisão 2026-07-19):
  // e-mail repetido é o que mantém os áudios no mesmo dono.
  salvarDadosPessoaisLocal();
  irParaPasso(2);
}

function irParaRevisao() {
  irParaPasso(3);
}

async function salvarMultiplosAgendamentos(itensPre) {
  const whatsapp = Estado.dadosPessoais.whatsapp;

  // Itens já com a promoção do serviço aplicada.
  const itens = itensPre || _aplicarDescontosCarrinho(Estado.carrinho);
  const chave = await gerarChavePedido();
  const totalFinal = itens.reduce((s, i) => s + i.valor_final, 0);
  const cupomDesc  = _cupomDesconto(itens);
  const totalCobrar = totalFinal - cupomDesc;
  const nome = Estado.dadosPessoais.nome;
  const nascimento = Estado.dadosPessoais.nascimento || null;

  // Monta os itens para a RPC. A RPC criar_pedido (SECURITY DEFINER) insere o
  // pedido pai + N agendamentos numa única transação. Necessária porque anon
  // não tem SELECT em pedidos (LGPD), então .insert().select() falharia. Se
  // um trigger BEFORE INSERT der RAISE (sem vaga), a transação inteira faz
  // rollback automático.
  const payloadItens = itens.map((item) => ({
    tipo_leitura_id: item.tipo.id,
    terapeuta: item.terapeuta,
    observacoes: item.observacoes,
    data: item.data,
    horario: item.horario,
    valor_original: item.valor_original,
    desconto_aplicado: item.desconto_aplicado,
    valor_final: item.valor_final,
    agendamento_especial: item.agendamento_especial,
    num_perguntas: item.num_perguntas ?? null, // naipe: amarra o preço à qtd de perguntas no servidor
  }));

  const { error: rpcErr } = await supabase.rpc('criar_pedido', {
    p_chave: chave,
    p_nome: nome,
    p_nascimento: nascimento,
    p_whatsapp: whatsapp,
    p_email: Estado.dadosPessoais.email || null,
    p_valor_total: totalCobrar,
    p_itens: payloadItens,
    p_cupom_codigo: Estado.cupom?.codigo || null,
    // Prova de aceite gravada no pedido. Logado com perfil em dia o
    // servidor usa a versão do perfil; guest vale o aceite do aparelho
    // ou do checkbox. null = sem aceite — fica registrado.
    p_termos_versao: (window._csTermosOk || _termosGuestOk() || document.getElementById('carrinho-termos')?.checked)
      ? window.TERMOS_VERSAO : null,
  });

  if (rpcErr) {
    if (/sem vagas/i.test(rpcErr.message)) {
      const err = new Error('Uma das leituras ficou sem vagas para a data escolhida. Nenhum agendamento foi criado — escolha outra data e tente de novo.');
      err.userMessage = true;
      throw err;
    }
    throw rpcErr;
  }

  // Limpa carrinho
  Estado.carrinho = [];

  return chave;
}

function validarFormulario() {
  if (!Estado.dataSelecionada) {
    mostrarAlerta('Selecione uma data antes de continuar.', 'error');
    setTimeout(() => irParaPasso(1), 2000);
    return false;
  }

  const dataAgendamento = new Date(Estado.dataSelecionada + 'T23:59:00');
  if (dataAgendamento <= new Date()) {
    mostrarAlerta('Esta data já passou. Selecione uma nova data.', 'error');
    setTimeout(() => irParaPasso(1), 2000);
    return false;
  }

  let ok = true;
  // Só valida perguntas aqui (dados pessoais são validados em section 0)
  if (Estado.tipoSelecionado?.requerPergunta) {
    const n = _numeroDePerguntas(Estado.tipoSelecionado);
    for (let i = 1; i <= n; i++) {
      const el = document.getElementById(`f-obs-${i}`);
      if (!el) continue;
      _limparErroField(el);
      const val = el.value.trim();
      if (val.length < 3) {
        el.classList.add('error');
        mostrarErroField(el, n > 1 ? `Descreva a pergunta ${i}.` : 'Descreva sua pergunta/questão.');
        ok = false;
      }
    }
  }
  if (!ok) _focarPrimeiroErro();
  return ok;
}

function mostrarErroField(input, msg) {
  let span = input.nextElementSibling;
  if (!span || !span.classList.contains('ag-error-msg')) {
    span = document.createElement('span');
    span.className = 'ag-error-msg';
    span.setAttribute('role', 'alert');
    span.setAttribute('aria-live', 'polite');
    input.parentNode.insertBefore(span, input.nextSibling);
  }
  span.textContent = msg;
  // Limpa ao começar a digitar/corrigir
  if (!input.dataset.errClearBound) {
    input.dataset.errClearBound = '1';
    const limpar = () => _limparErroField(input);
    input.addEventListener('input', limpar);
    input.addEventListener('change', limpar);
  }
}

function _limparErroField(input) {
  input.classList.remove('error');
  const span = input.nextElementSibling;
  if (span && span.classList.contains('ag-error-msg')) span.remove();
}

// (Removida a antiga salvarAgendamento de 1 leitura: o fluxo agora é sempre
//  via carrinho → pedido pai + agendamentos filhos em salvarMultiplosAgendamentos.)

async function gerarChavePedido(tentativas = 0) {
  if (tentativas > 5) throw new Error('Falha ao gerar chave única');
  const chave = gerarChaveAleatoria();
  const { data: existe, error } = await supabase
    .rpc('chave_pedido_existe', { p_chave: chave });
  if (error) throw error;
  if (existe) return gerarChavePedido(tentativas + 1);
  return chave;
}

function gerarChaveAleatoria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // A chave funciona como token do pedido (pedido_status, order_nsu): usa CSPRNG
  // para não ser previsível/enumerável. Fallback em Math.random só se crypto faltar.
  const rand = (n) => {
    if (globalThis.crypto?.getRandomValues) {
      const buf = new Uint32Array(n);
      globalThis.crypto.getRandomValues(buf);
      return Array.from(buf, (v) => chars[v % chars.length]).join('');
    }
    return Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };
  return `CS-${rand(4)}-${rand(4)}-${rand(4)}`;
}

function redirecionarParaPagamento(chave) {
  console.warn('redirecionarParaPagamento não foi substituído — verifique se modal-agendamento.js carregou corretamente.');
  const err = new Error('Erro interno ao redirecionar para pagamento. Recarregue a página.');
  err.userMessage = true;
  throw err;
}

// ============================================================
// Navegação entre passos (1=Data, 2=Dados)
// ============================================================
// Campo de e-mail: logado nunca vê (vai o da conta). Guest digita 1× —
// nas próximas o campo some e mostra qual e-mail está valendo, com
// "Trocar" pra abrir o campo de novo (aparelho de outra pessoa).
function _atualizarCampoEmail(forcarCampo = false) {
  const grupo    = document.getElementById('f-email-group');
  const lembrado = document.getElementById('f-email-lembrado');
  if (!grupo) return;
  const input = document.getElementById('f-email');
  const salvo = window._csLogado ? '' : (_clienteLocal().email || '');
  if (input && !input.value && salvo) input.value = salvo;
  grupo.hidden = !!window._csLogado || (!!salvo && !forcarCampo);
  if (lembrado) {
    lembrado.hidden = !!window._csLogado || !salvo || forcarCampo;
    const alvo = document.getElementById('f-email-salvo');
    if (alvo) alvo.textContent = salvo;
  }
}

function irParaPasso(num) {
  // num 1 = calendário (primeiro), 0 = dados pessoais, 2 = perguntas/resumo, 3 = revisão carrinho
  document.querySelectorAll('.ag-section').forEach((s) => {
    const idx = parseInt(s.dataset.passo, 10);
    s.classList.toggle('active', idx === num);
  });

  if (num === 0) _atualizarCampoEmail();

  if (num === 2) atualizarResumo();
  if (num === 3 && typeof _renderizarCarrinho === 'function') _renderizarCarrinho();

  document.querySelector('.ag-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
// Helpers
// ============================================================
function dataParaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Ícone do alerta vem do tipo, não da mensagem — assim nenhuma string
// precisa carregar símbolo e o texto continua entrando como texto puro.
const ICO_ALERTA = { success: 'check-circulo', error: 'alerta', info: 'info' };

function mostrarAlerta(msg, tipo = 'info') {
  const div = document.createElement('div');
  div.className = `ag-alert ag-alert-${tipo}`;
  div.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  div.setAttribute('aria-live', 'polite');
  div.innerHTML = `<svg class="ico ag-alert-ico" aria-hidden="true"><use href="#ico-${ICO_ALERTA[tipo] || 'info'}"></use></svg>`;
  div.appendChild(document.createTextNode(msg));
  const main = document.querySelector('.ag-container') || document.body;
  main.prepend(div);
  setTimeout(() => div.remove(), 4000);
}

function obterWhatsappCompleto() {
  const ddi  = document.getElementById('f-ddi');
  const fone = document.getElementById('f-fone');
  const prefixo = ddi ? ddi.value : '+55';
  const numero  = fone ? fone.value.trim() : '';
  return `${prefixo} ${numero}`;
}

function aplicarMascaraFone(input) {
  const ddi = document.getElementById('f-ddi');

  function atualizar() {
    const isBR = !ddi || ddi.value === '+55';
    if (isBR) {
      let v = input.value.replace(/\D/g,'').slice(0,11);
      if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
      else if (v.length) v = `(${v}`;
      input.value = v;
      input.placeholder = '(27) 99999-9999';
    } else {
      input.value = input.value.replace(/[^\d\s\-().+]/g, '');
      input.placeholder = 'Número local';
    }
  }

  input.addEventListener('input', atualizar);
  if (ddi) {
    ddi.addEventListener('change', () => {
      input.value = '';
      atualizar();
    });
  }
}

// Máscara DD/MM/AAAA: permite digitar a data em qualquer dispositivo
// (o type="date" nativo no celular só abre o seletor, sem digitação).
function aplicarMascaraData(input) {
  input.addEventListener('input', () => {
    let v = input.value.replace(/\D/g, '').slice(0, 8);
    if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
    else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
    input.value = v;
  });
}

// "DD/MM/AAAA" → "AAAA-MM-DD" (ISO); '' se incompleta/inválida.
function dataBrParaISO(br) {
  const m = String(br || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
// Renderização dinâmica do catálogo no site
// ============================================================
function _escCat(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _escDesc(s) {
  return _escCat(s).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

function _formatarPrecoCat(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n)
    ? `R$&nbsp;${n}`
    : `R$&nbsp;${n.toFixed(2).replace('.', ',')}`;
}

function _agruparCatalogo(tipos) {
  const itens = [];
  const grupos = new Map();
  for (const t of tipos) {
    if (t.grupo_slug) {
      if (!grupos.has(t.grupo_slug)) {
        const item = { kind: 'grupo', grupo_slug: t.grupo_slug, principal: t, tiers: [] };
        grupos.set(t.grupo_slug, item);
        itens.push(item);
      }
      grupos.get(t.grupo_slug).tiers.push(t);
    } else {
      itens.push({ kind: 'single', tipo: t });
    }
  }
  for (const g of grupos.values()) {
    g.tiers.sort((a, b) => Number(a.preco_original) - Number(b.preco_original));
  }
  return itens;
}

function _nomeGrupo(principal) {
  if (!principal.tier_label) return principal.nome;
  const sep = principal.nome.indexOf(' – ');
  return sep > 0 ? principal.nome.slice(0, sep) : principal.nome;
}

// Monta a imagem do card. Aceita combo: duas URLs em imagem_url separadas
// por "|" → dois círculos na diagonal. 1 URL = card normal; nenhuma = placeholder.
function _catImg(imagem_url, nome) {
  const urls = String(imagem_url || '').split('|').map(s => s.trim()).filter(Boolean);
  if (urls.length >= 2) {
    return `<div class="cat-img-combo">
        <img src="${_escCat(urls[0])}" alt="${_escCat(nome)}" class="cat-img cat-img--combo-top" loading="lazy">
        <img src="${_escCat(urls[1])}" alt="" class="cat-img cat-img--combo-bottom" loading="lazy">
      </div>`;
  }
  if (urls.length === 1) {
    return `<img src="${_escCat(urls[0])}" alt="${_escCat(nome)}" class="cat-img" loading="lazy">`;
  }
  return `<div class="cat-img cat-img--placeholder" aria-hidden="true"><svg class="ico" aria-hidden="true"><use href="#ico-semente"></use></svg></div>`;
}

// Ranking de demanda (agendamentos pagos) por service_id — só a ordem,
// sem totais (volume de vendas é dado interno). Falha → Map vazio.
async function _buscarRankingCatalogo() {
  try {
    const { data, error } = await supabase.rpc('catalogo_ranking');
    if (error || !Array.isArray(data)) return new Map();
    return new Map(data.map((r, i) => [r.service_id, i]));
  } catch { return new Map(); }
}

const _TERAPEUTA_NOME = { matheus: 'Matheus', camila: 'Camila' };

// Monta o HTML de um card (grupo de tiers ou leitura simples).
function _catCardHTML(item) {
  if (item.kind === 'grupo') {
    const p     = item.principal;
    const nome  = _nomeGrupo(p);
    const img   = _catImg(p.imagem_url, nome);
    const desc  = p.descricao ? `<p class="cat-desc">${_escDesc(p.descricao)}</p>` : '';
    const tiers = item.tiers.map(t => `
      <span><span>${_escCat(t.tier_label || t.nome)}</span><strong>${_formatarPrecoCat(t.preco_original)}</strong></span>
    `).join('');
    const bucket = Number(item.tiers[0].preco_original) <= 50 ? ' ate50' : '';
    // Preço-base dos tiers vem de tipos_leitura (fonte única). A promoção só
    // aplica percentual/badge por cima (discount-system lê este data-*), então
    // catálogo e cobrança (RPC usa preco_original) nunca divergem.
    const baseTiers = _escCat(JSON.stringify(
      item.tiers.map(t => ({ label: t.tier_label || t.nome, preco: Number(t.preco_original) }))
    ));

    return `
      <article class="cat-card" data-category="${_escCat(p.terapeuta)} ${_escCat(p.modalidade || 'mensagem')}${bucket}" data-modalidade="${_escCat(p.modalidade || 'mensagem')}" data-service-id="grupo:${_escCat(item.grupo_slug)}" data-base-tiers="${baseTiers}">
        <div class="cat-card-img">${img}</div>
        <div class="cat-body">
          <h3 class="cat-name">${_escCat(nome)}</h3>
          ${desc}
        </div>
        <div class="cat-footer">
          <div class="cat-footer-tiers">${tiers}</div>
          <button class="cat-btn" onclick="abrirSeletor('grupo:${_escCat(item.grupo_slug)}')">Agendar</button>
        </div>
      </article>
    `;
  }

  const t       = item.tipo;
  const slug    = t.slug || `id-${t.id}`;
  const img     = _catImg(t.imagem_url, t.nome);
  const desc    = t.descricao ? `<p class="cat-desc">${_escDesc(t.descricao)}</p>` : '';
  const onclick = t.slug ? `abrirSeletor('${_escCat(slug)}')` : `abrirSeletor(${t.id})`;
  const bucket  = Number(t.preco_original) <= 50 ? ' ate50' : '';

  return `
    <article class="cat-card" data-category="${_escCat(t.terapeuta)} ${_escCat(t.modalidade || 'mensagem')}${bucket}" data-modalidade="${_escCat(t.modalidade || 'mensagem')}" data-service-id="${_escCat(slug)}" data-base-price="${Number(t.preco_original)}">
      <div class="cat-card-img">${img}</div>
      <div class="cat-body">
        <h3 class="cat-name">${_escCat(t.nome)}</h3>
        ${desc}
      </div>
      <div class="cat-footer">
        <span class="cat-footer-price">${_formatarPrecoCat(t.preco_original)}</span>
        <button class="cat-btn" onclick="${onclick}">Agendar</button>
      </div>
    </article>
  `;
}

async function renderizarCatalogoSite() {
  const grid = document.getElementById('catGrid');
  if (!grid) return;

  const tipos = await _garantirTipos();
  if (!tipos.length) {
    grid.innerHTML = '<div class="ag-empty">Nenhuma leitura disponível no momento.</div>';
    return;
  }

  // Agrupa em cards (grupos de tiers + simples) preservando a ordem do admin.
  const itens = _agruparCatalogo(tipos);

  // Bloca por terapeuta. Dentro do bloco vale a coluna `ordem` do admin;
  // a ordem DOS BLOCOS é sorteada 50/50 uma vez por sessão (abaixo), pra
  // nenhum terapeuta ficar sempre com a vitrine de cima.
  const blocos = [];
  const idxBloco = {};
  for (const item of itens) {
    const ter = (item.kind === 'grupo' ? item.principal.terapeuta : item.tipo.terapeuta) || '—';
    if (!(ter in idxBloco)) { idxBloco[ter] = blocos.length; blocos.push({ terapeuta: ter, itens: [] }); }
    blocos[idxBloco[ter]].itens.push(item);
  }

  // Sorteio estável na sessão: recarregar a página não embaralha de novo.
  let primeiro;
  try {
    primeiro = sessionStorage.getItem('cs_cat_primeiro');
    if (!(primeiro in _TERAPEUTA_NOME)) {
      primeiro = Math.random() < 0.5 ? 'camila' : 'matheus';
      sessionStorage.setItem('cs_cat_primeiro', primeiro);
    }
  } catch (_) {
    primeiro = Math.random() < 0.5 ? 'camila' : 'matheus';
  }
  // sort estável: empates mantêm a ordem do admin; bloco sem terapeuta ('—') vai pro fim.
  const _rankBloco = t => t === primeiro ? 0 : (t in _TERAPEUTA_NOME ? 1 : 2);
  blocos.sort((a, b) => _rankBloco(a.terapeuta) - _rankBloco(b.terapeuta));

  grid.innerHTML = blocos.map(b => {
    const nome   = _TERAPEUTA_NOME[b.terapeuta] || (b.terapeuta === '—' ? '' : b.terapeuta);
    const titulo = nome ? `Leituras com ${_escCat(nome)}` : 'Outras leituras';
    const avatar = _TERAPEUTA_NOME[b.terapeuta]
      ? `<img class="cat-group-avatar" src="images/perfil-${_escCat(b.terapeuta)}.webp" alt="" width="44" height="44" loading="lazy">`
      : '';
    return `
      <div class="cat-group" data-terapeuta="${_escCat(b.terapeuta)}">
        <div class="cat-group-head">
          ${avatar}
          <h3 class="cat-group-titulo">${titulo}</h3>
        </div>
        <div class="cat-grid">
          ${b.itens.map(_catCardHTML).join('')}
        </div>
      </div>`;
  }).join('');

  grid.removeAttribute('aria-busy');

  // Card inteiro clicável (o botão Agendar segue sendo o caminho primário)
  grid.querySelectorAll('.cat-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.cat-btn, a, button')) return;
      const sid = card.dataset.serviceId;
      if (!sid) return;
      abrirSeletor(sid.startsWith('id-') ? Number(sid.slice(3)) : sid);
    });
  });

  if (typeof inicializarFiltrosCatalogo === 'function') inicializarFiltrosCatalogo();
  if (typeof renderizarDescontos === 'function') renderizarDescontos();
  _destacarMaisProcurada();
  _configurarVerMaisCatalogo(grid);
}

// ---- "Ver mais" das descrições do catálogo ----------------------------------
// Injeta o botão SÓ nos cards cujo texto foi realmente cortado pelo clamp
// (medição scrollHeight vs clientHeight). Vale pra qualquer descrição do admin,
// hoje e no futuro — encurtou e coube, o botão some; aumentou e estourou, aparece.
let _verMaisGrid = null;
let _verMaisResizeHooked = false;

function _configurarVerMaisCatalogo(grid) {
  _verMaisGrid = grid;
  _medirVerMais();
  // Remede quando a fonte carrega (DM Sans entra via font-display:swap e muda a
  // altura → clamp pode passar a estourar) e no resize (o clamp corta por nº de
  // linhas, não de chars). _medirVerMais é idempotente.
  if (document.fonts?.ready) document.fonts.ready.then(_medirVerMais);
  if (!_verMaisResizeHooked) {
    _verMaisResizeHooked = true;
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(_medirVerMais, 150); });
  }
}

// Idempotente: limpa os botões antigos e remede. Chamada também pelo filtro do
// catálogo (script.js) quando um grupo antes oculto volta a aparecer.
function _medirVerMais() {
  const grid = _verMaisGrid;
  if (!grid) return;
  grid.querySelectorAll('.cat-vermais').forEach(b => b.remove());
  grid.querySelectorAll('.cat-desc').forEach(desc => {
    if (desc.offsetParent === null) return;                 // grupo oculto (filtro): mede 0×0; remede ao reexibir
    if (desc.scrollHeight - desc.clientHeight <= 2) return; // coube inteiro
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-vermais';
    btn.textContent = 'ver mais';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // não dispara o clique do card (abrirSeletor)
      _abrirDescPop(desc, btn);
    });
    desc.insertAdjacentElement('afterend', btn);
  });
}

// Painel flutuante único (no body) com a descrição completa. position:fixed
// posicionado sobre o card → flutua por cima dos vizinhos sem refluir o grid.
let _descPopEl = null, _descPopBtn = null;

function _abrirDescPop(desc, btn) {
  const card = desc.closest('.cat-card');
  if (!card) return;
  // toggle: clicar de novo no mesmo "ver mais" fecha
  if (_descPopBtn === btn && _descPopEl && _descPopEl.classList.contains('aberto')) {
    _fecharDescPop();
    return;
  }
  if (!_descPopEl) {
    _descPopEl = document.createElement('div');
    _descPopEl.className = 'cat-desc-pop';
    _descPopEl.setAttribute('role', 'dialog');
    document.body.appendChild(_descPopEl);
  }
  _descPopBtn = btn;
  btn.setAttribute('aria-expanded', 'true');
  _descPopEl.innerHTML =
    '<p class="cat-desc-pop-txt"></p>' +
    '<button type="button" class="cat-desc-pop-fechar">ver menos</button>';
  // innerHTML (não textContent) para preservar os <br> que _escDesc reconstruiu;
  // o conteúdo do card já vem escapado, então é seguro copiar.
  _descPopEl.querySelector('.cat-desc-pop-txt').innerHTML = desc.innerHTML;
  _descPopEl.querySelector('.cat-desc-pop-fechar')
    .addEventListener('click', (e) => { e.stopPropagation(); _fecharDescPop(); });

  // left/largura seguem o card; topo ancora na descrição (foto + nome ficam à mostra)
  const rc = card.getBoundingClientRect();
  const rd = desc.getBoundingClientRect();
  _descPopEl.style.left  = `${rc.left}px`;
  _descPopEl.style.width = `${rc.width}px`;
  _descPopEl.style.top   = `${rd.top}px`;
  // Descrição longa não pode estourar a viewport: limita a altura e rola por
  // dentro (o scroll interno não fecha o painel — ver _descPopScroll).
  _descPopEl.style.maxHeight = `${Math.max(120, window.innerHeight - rd.top - 16)}px`;
  _descPopEl.style.overflowY = 'auto';
  _descPopEl.classList.add('aberto');

  document.addEventListener('click', _descPopOutside, true);
  document.addEventListener('keydown', _descPopEsc);
  window.addEventListener('scroll', _descPopScroll, true);
  window.addEventListener('resize', _fecharDescPop);
}

// Rolar a PÁGINA fecha (o painel é fixed, ancorado no card, e desalinharia);
// rolar DENTRO do painel (descrição longa) não fecha.
function _descPopScroll(e) {
  if (_descPopEl && _descPopEl.contains(e.target)) return;
  _fecharDescPop();
}

function _fecharDescPop() {
  if (!_descPopEl) return;
  _descPopEl.classList.remove('aberto');
  if (_descPopBtn) { _descPopBtn.setAttribute('aria-expanded', 'false'); _descPopBtn = null; }
  document.removeEventListener('click', _descPopOutside, true);
  document.removeEventListener('keydown', _descPopEsc);
  window.removeEventListener('scroll', _descPopScroll, true);
  window.removeEventListener('resize', _fecharDescPop);
}

function _descPopOutside(e) {
  if (_descPopEl && !_descPopEl.contains(e.target) && !e.target.closest('.cat-vermais')) {
    _fecharDescPop();
  }
}

function _descPopEsc(e) {
  if (e.key === 'Escape') _fecharDescPop();
}

// Destaca o card da leitura com mais agendamentos pagos, UM POR TERAPEUTA
// (RPC agregada; anon não lê agendamentos). Falha silenciosa: sem dado, sem badge.
async function _destacarMaisProcurada() {
  try {
    const { data, error } = await supabase.rpc('leitura_mais_procurada');
    if (error || !data) return;
    for (const { service_id } of data) {
      if (!service_id) continue;
      const card = document.querySelector(`.cat-card[data-service-id="${CSS.escape(service_id)}"]`);
      if (!card) continue;
      card.classList.add('cat-card--destaque');
      const imgWrap = card.querySelector('.cat-card-img');
      if (imgWrap && !imgWrap.querySelector('.cat-badge--top')) {
        const b = document.createElement('span');
        b.className = 'cat-badge cat-badge--top';
        b.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-semente"></use></svg> Mais procurada';
        imgWrap.appendChild(b);
      }
    }
  } catch { /* destaque é opcional */ }
}

// ============================================================
// Init
// ============================================================
// Avisa antes de sair com leituras não pagas no carrinho
window.addEventListener('beforeunload', (e) => {
  if (typeof Estado !== 'undefined' && Estado.carrinho.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('DOMContentLoaded', () => {
  renderizarCatalogoSite();

  const fone = document.getElementById('f-fone');
  if (fone) aplicarMascaraFone(fone);

  const nasc = document.getElementById('f-nasc');
  if (nasc) {
    aplicarMascaraData(nasc);
    // Depois da máscara: quando este listener roda, o valor já está DD/MM/AAAA.
    nasc.addEventListener('input', _atualizarTravaMenor);
  }

  // Autofill de "Seus dados" pra todo mundo (guest incluso — decisão
  // 2026-07-19). O drawer "Minha conta" (que re-espelhava o perfil no
  // login) foi removido — cliente não loga mais; só o que está no
  // aparelho conta.
  restaurarDadosPessoaisLocal();
  _atualizarTravaMenor(); // autofill preenche sem disparar 'input' — menor lembrado não passa reto

  // "Trocar" reabre o campo de e-mail escondido (guest lembrado).
  document.getElementById('f-email-trocar')?.addEventListener('click', () => {
    _atualizarCampoEmail(true);
    document.getElementById('f-email')?.focus();
  });

  const form = document.getElementById('form-dados');
  if (form) form.addEventListener('submit', processarFormulario);

  const formPessoais = document.getElementById('form-dados-pessoais');
  if (formPessoais) formPessoais.addEventListener('submit', (e) => { e.preventDefault(); confirmarDadosPessoais(); });

  const seletorOverlay = document.getElementById('seletor-overlay');
  if (seletorOverlay) {
    seletorOverlay.addEventListener('click', e => {
      if (e.target === seletorOverlay) fecharSeletor();
    });
  }

  // Abre no calendário (passo 1) por padrão
  document.querySelectorAll('.ag-section').forEach(s => {
    const passo = parseInt(s.dataset.passo, 10);
    s.classList.toggle('active', passo === 1);
  });
});
