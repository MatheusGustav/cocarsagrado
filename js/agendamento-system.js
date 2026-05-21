/* ============================================================
   COCAR SAGRADO — Sistema de Agendamento (Sistema de Vagas)
   ============================================================ */

const Estado = {
  tipoSelecionado: null,
  dataSelecionada: null,
  horarioSelecionado: null,
  serviceId: null,
};

const DIAS_PT  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ============================================================
// SELETOR DE QUANTIDADE
// ============================================================

let _tiposCache    = null;
let _seletorTipo   = null;
let _seletorQty    = 1;

const WHATSAPP_TERAPEUTA = {
  matheus: '5528999476620',
  camila:  '5527998528483',
};

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

function calcularPrecoFinal(precoOriginal) {
  const preco = parseFloat(precoOriginal) || 0;
  if (localStorage.getItem('aceitouDesconto10') === 'true') {
    const final = Math.round(preco * 90) / 100;
    return { final, desconto: preco - final };
  }
  if (Estado.serviceId && typeof _configCache !== 'undefined' && _configCache?.promocoes) {
    const servico = _configCache.promocoes.find(p => p.id === Estado.serviceId);
    if (servico?.descontoAtivo && servico.percentualDesconto > 0) {
      const pct   = servico.percentualDesconto;
      const final = Math.round(preco * (100 - pct)) / 100;
      return { final, desconto: preco - final };
    }
  }
  return { final: preco, desconto: 0 };
}

async function abrirSeletor(ref) {
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

  _seletorTipo     = tipo;
  Estado.serviceId = tipo.slug || tipo.id;
  _seletorQty      = 1;

  const tiersEl    = document.getElementById('seletor-tiers');
  const qtyEl      = document.getElementById('seletor-qty-wrap');
  const resumoEl   = document.getElementById('seletor-resumo');
  const btnConfirm = document.getElementById('seletor-btn-confirm');

  document.getElementById('seletor-nome').textContent     = tipo.nome;
  document.getElementById('seletor-pergunta').textContent = tipo.especial
    ? 'Confirme para escolher a data'
    : 'Quantas sessões?';

  if (tiersEl) { tiersEl.innerHTML = ''; tiersEl.style.display = 'none'; }
  qtyEl.style.display    = _tipoMaxQty(tipo) === 1 ? 'none' : 'flex';
  resumoEl.style.display = 'flex';
  _atualizarResumoSeletor();
  btnConfirm.removeAttribute('disabled');

  document.getElementById('seletor-overlay').classList.add('open');
  document.body.classList.add('seletor-aberto');
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
    const opt = document.createElement('div');
    opt.className = 'seletor-tier-opt';
    opt.innerHTML = `
      <span class="tier-label">${_escCat(tier.tier_label || tier.nome)}</span>
      <div class="tier-info">
        <span class="tier-duracao">⏱ ${tier.duracao_minutos} min</span>
        <span class="tier-preco">R$ ${final.toFixed(0)}</span>
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
}

function _atualizarResumoSeletor() {
  const tipo = _seletorTipo;
  if (!tipo) return;
  const total    = tipo.preco_original  * _seletorQty;
  const durTotal = tipo.duracao_minutos * _seletorQty;
  const { final } = calcularPrecoFinal(total);

  document.getElementById('seletor-qty').textContent     = _seletorQty;
  document.getElementById('seletor-preco').textContent   = `R$ ${final.toFixed(0)}`;
  document.getElementById('seletor-duracao').textContent = _formatarDuracao(durTotal);
}

function _formatarDuracao(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}min` : `${h}h`;
}

function alterarQty(delta) {
  const max = _tipoMaxQty(_seletorTipo);
  _seletorQty = Math.max(1, Math.min(max, _seletorQty + delta));
  _atualizarResumoSeletor();
}

function fecharSeletor() {
  document.getElementById('seletor-overlay')?.classList.remove('open');
  document.body.classList.remove('seletor-aberto');
}

function confirmarSeletor() {
  if (!_seletorTipo) return;

  const t = _seletorTipo;
  const tipoFinal = {
    ...t,
    terapeuta:       t.terapeuta,
    especial:        !!t.especial,
    requerPergunta:  !!t.requer_pergunta,
    preco_original:  t.preco_original  * _seletorQty,
    duracao_minutos: t.duracao_minutos * _seletorQty,
    nome: _seletorQty > 1 ? `${t.nome} (×${_seletorQty})` : t.nome,
  };

  fecharSeletor();
  abrirModal(tipoFinal);
}

// ============================================================
// STEP 1 — Calendário de Vagas
// ============================================================
async function carregarCalendario() {
  const cal = document.getElementById('calendario');
  if (!cal) return;
  cal.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando disponibilidade...</div>';

  const profissional = Estado.tipoSelecionado?.terapeuta;
  if (!profissional) {
    cal.innerHTML = '<div class="ag-empty">Selecione um serviço primeiro.</div>';
    return;
  }

  try {
    const isEspecial = !!Estado.tipoSelecionado?.especial;
    const dias = isEspecial
      ? await _buscarDiasEspeciais(profissional, 90)
      : await _buscarDiasComVagas(profissional, 2);

    if (!dias.length) {
      const numero = WHATSAPP_TERAPEUTA[profissional] || '';
      cal.innerHTML = `
        <div class="ag-empty ag-empty-vagas">
          <p>Nenhuma data disponível nos próximos 3 dias.</p>
          <p style="font-size:.85rem; margin-top:4px;">Entre em contato para verificar disponibilidade especial.</p>
          ${numero ? `<a href="https://wa.me/${numero}" target="_blank" rel="noopener" class="ag-btn ag-btn-whatsapp" style="margin-top:14px; display:inline-flex;">💬 Falar no WhatsApp</a>` : ''}
        </div>`;
      return;
    }

    cal.innerHTML = '';
    cal.className = 'ag-vagas-lista';

    dias.forEach(({ data, vagas, ate_horario }) => {
      const d = new Date(data + 'T00:00:00');
      const card = document.createElement('div');
      card.className = 'ag-vagas-card';

      const h = ate_horario ? parseInt(ate_horario.slice(0, 2)) : null;
      const horarioLabel = h !== null ? `até ${h}h` : '';
      const vagasText    = vagas === 1 ? '1 vaga disponível' : `${vagas} vagas disponíveis`;
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
          <span class="ag-vagas-badge">${vagasText}${horarioLabel ? ' (' + horarioLabel + ')' : ''}</span>
        </div>
        <span class="ag-vagas-action" aria-hidden="true">→</span>`;

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

async function _buscarDiasComVagas(profissional, diasParaFrente) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = dataParaISO(hoje);
  const dataFim    = dataParaISO(new Date(hoje.getTime() + diasParaFrente * 86400000));

  const [
    { data: overrides },
    { data: agendados },
  ] = await Promise.all([
    supabase.from('disponibilidade_override').select('*').eq('profissional', profissional).gte('data', dataInicio).lte('data', dataFim),
    supabase.from('agendamentos').select('data_agendamento').eq('terapeuta', profissional).gte('data_agendamento', dataInicio).lte('data_agendamento', dataFim).in('status', ['pago','confirmado','atendido','pendente']),
  ]);

  const overrideMap = {};
  (overrides || []).forEach(o => { overrideMap[o.data] = o; });

  const contagemMap = {};
  (agendados || []).forEach(a => {
    contagemMap[a.data_agendamento] = (contagemMap[a.data_agendamento] || 0) + 1;
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
        if (i === 0 && ov.ate_horario) {
          const [h, m] = ov.ate_horario.split(':').map(Number);
          const limite = new Date(); limite.setHours(h, m, 0, 0);
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
  setTimeout(() => irParaPasso(2), 250);
}

// ============================================================
// STEP 2 — Formulário
// ============================================================
function atualizarResumo() {
  const tipo = Estado.tipoSelecionado;
  const data = Estado.dataSelecionada;
  if (!tipo || !data) return;

  const { final, desconto } = calcularPrecoFinal(tipo.preco_original);
  const d = new Date(data + 'T00:00:00');

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('res-tipo',    tipo.nome);
  set('res-data',    `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`);
  const horaLabel = Estado.horarioSelecionado ? `até as ${Estado.horarioSelecionado.slice(0,5)}h` : '';
  set('res-hora',    horaLabel);
  set('res-duracao', _formatarDuracao(tipo.duracao_minutos));
  set('res-valor',   `R$ ${final.toFixed(2).replace('.', ',')}`);

  const linhaDesc = document.getElementById('res-desconto-linha');
  if (linhaDesc) linhaDesc.style.display = desconto > 0 ? 'flex' : 'none';
  set('res-desconto', `- R$ ${desconto.toFixed(2).replace('.', ',')}`);
}

function processarFormulario(e) {
  e.preventDefault();
  if (!validarFormulario()) return;

  const btn = document.getElementById('btn-pagar');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  salvarAgendamento()
    .then(chave => { if (chave) redirecionarParaPagamento(chave); })
    .catch(err => {
      console.error('salvarAgendamento:', err);
      mostrarAlerta('Erro ao salvar agendamento. Tente novamente.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Continuar para Pagamento'; }
    });
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
  const campos = [
    { id: 'f-nome', minLen: 3,  msg: 'Nome deve ter pelo menos 3 caracteres.' },
    { id: 'f-nasc', date: true, msg: 'Data de nascimento inválida.' },
    { id: 'f-fone', minLen: 6,  msg: 'Número inválido.' },
  ];
  if (Estado.tipoSelecionado?.requerPergunta) {
    campos.push({ id: 'f-obs', minLen: 3, msg: 'Descreva sua pergunta/questão.' });
  }
  campos.forEach(({ id, minLen, date, msg }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('error');
    const val = el.value.trim();
    const invalido = date
      ? (() => {
          if (!val) return true;
          const d = new Date(val);
          if (isNaN(d.getTime())) return true;
          const hoje = new Date();
          const minData = new Date(hoje.getFullYear() - 120, hoje.getMonth(), hoje.getDate());
          const maxData = new Date(hoje.getFullYear() - 10,  hoje.getMonth(), hoje.getDate());
          return d > hoje || d > maxData || d < minData;
        })()
      : id === 'f-fone'
        ? val.replace(/\D/g,'').length < minLen
        : val.length < minLen;
    if (invalido) { el.classList.add('error'); mostrarErroField(el, msg); ok = false; }
  });
  return ok;
}

function mostrarErroField(input, msg) {
  let span = input.nextElementSibling;
  if (!span || !span.classList.contains('ag-error-msg')) {
    span = document.createElement('span');
    span.className = 'ag-error-msg';
    input.parentNode.insertBefore(span, input.nextSibling);
  }
  span.textContent = msg;
  setTimeout(() => { if (span) span.remove(); }, 3000);
}

async function salvarAgendamento() {
  const tipo = Estado.tipoSelecionado;
  const { final, desconto } = calcularPrecoFinal(tipo.preco_original);
  const chave = await gerarChavePedido();

  const payload = {
    chave_pedido:        chave,
    tipo_leitura_id:     tipo.id,
    terapeuta:           tipo.terapeuta || null,
    cliente_nome:        document.getElementById('f-nome').value.trim(),
    cliente_nascimento:  document.getElementById('f-nasc')?.value || null,
    cliente_whatsapp:    obterWhatsappCompleto(),
    cliente_observacoes: document.getElementById('f-obs')?.value?.trim() || null,
    data_agendamento:    Estado.dataSelecionada,
    hora_agendamento:    '00:00',
    duracao_minutos:     tipo.duracao_minutos,
    valor_original:      tipo.preco_original,
    desconto_aplicado:   desconto,
    valor_final:         final,
    aceitou_desconto_10:  localStorage.getItem('aceitouDesconto10') === 'true',
    agendamento_especial: !!(Estado.tipoSelecionado?.especial),
    status:               'pendente',
  };

  const { error } = await supabase.from('agendamentos').insert(payload);
  if (error) throw error;

  if (payload.agendamento_especial) {
    await supabase.rpc('decrementar_vagas_restantes', {
      p_profissional: payload.terapeuta,
      p_data: payload.data_agendamento,
    });
  }

  return chave;
}

async function gerarChavePedido(tentativas = 0) {
  if (tentativas > 5) throw new Error('Falha ao gerar chave única');
  const chave = gerarChaveAleatoria();
  const { data, error } = await supabase
    .from('agendamentos').select('id').eq('chave_pedido', chave).maybeSingle();
  if (error) throw error;
  if (data) return gerarChavePedido(tentativas + 1);
  return chave;
}

function gerarChaveAleatoria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bloco = (n) => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CS-${bloco(4)}-${bloco(4)}-${bloco(4)}`;
}

function redirecionarParaPagamento(chave) {
  console.warn('redirecionarParaPagamento não foi substituído — verifique se modal-agendamento.js carregou corretamente.');
  mostrarAlerta('Erro interno ao redirecionar para pagamento. Recarregue a página.', 'error');
}

// ============================================================
// Navegação entre passos (1=Data, 2=Dados)
// ============================================================
function irParaPasso(num) {
  document.querySelectorAll('.ag-section').forEach((s, i) => {
    s.classList.toggle('active', i + 1 === num);
  });
  document.querySelectorAll('.ag-step').forEach((s, i) => {
    s.classList.remove('active','done');
    if (i + 1 === num) s.classList.add('active');
    if (i + 1 < num)   s.classList.add('done');
  });

  if (num === 2) atualizarResumo();

  document.querySelector('.ag-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
// Helpers
// ============================================================
function dataParaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function mostrarAlerta(msg, tipo = 'info') {
  const div = document.createElement('div');
  div.className = `ag-alert ag-alert-${tipo}`;
  div.textContent = msg;
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

async function renderizarCatalogoSite() {
  const grid = document.getElementById('catGrid');
  if (!grid) return;

  const tipos = await _garantirTipos();
  if (!tipos.length) {
    grid.innerHTML = '<div class="ag-empty">Nenhuma leitura disponível no momento.</div>';
    return;
  }

  const itens = _agruparCatalogo(tipos);

  grid.innerHTML = itens.map(item => {
    if (item.kind === 'grupo') {
      const p     = item.principal;
      const nome  = _nomeGrupo(p);
      const img   = p.imagem_url
        ? `<img src="${_escCat(p.imagem_url)}" alt="${_escCat(nome)}" class="cat-img" loading="lazy">`
        : `<div class="cat-img cat-img--placeholder" aria-hidden="true">✦</div>`;
      const desc  = p.descricao ? `<p class="cat-desc">${_escDesc(p.descricao)}</p>` : '';
      const tiers = item.tiers.map(t => `
        <span><span>${_escCat(t.tier_label || t.nome)}</span><strong>${_formatarPrecoCat(t.preco_original)}</strong></span>
      `).join('');

      return `
        <article class="cat-card" data-category="${_escCat(p.terapeuta)}" data-service-id="grupo:${_escCat(item.grupo_slug)}">
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
    const img     = t.imagem_url
      ? `<img src="${_escCat(t.imagem_url)}" alt="${_escCat(t.nome)}" class="cat-img" loading="lazy">`
      : `<div class="cat-img cat-img--placeholder" aria-hidden="true">✦</div>`;
    const desc    = t.descricao ? `<p class="cat-desc">${_escDesc(t.descricao)}</p>` : '';
    const onclick = t.slug ? `abrirSeletor('${_escCat(slug)}')` : `abrirSeletor(${t.id})`;

    return `
      <article class="cat-card" data-category="${_escCat(t.terapeuta)}" data-service-id="${_escCat(slug)}">
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
  }).join('');

  if (typeof inicializarFiltrosCatalogo === 'function') inicializarFiltrosCatalogo();
  if (typeof renderizarDescontos === 'function') renderizarDescontos();
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  renderizarCatalogoSite();

  const fone = document.getElementById('f-fone');
  if (fone) aplicarMascaraFone(fone);

  const form = document.getElementById('form-dados');
  if (form) form.addEventListener('submit', processarFormulario);

  const seletorOverlay = document.getElementById('seletor-overlay');
  if (seletorOverlay) {
    seletorOverlay.addEventListener('click', e => {
      if (e.target === seletorOverlay) fecharSeletor();
    });
  }
});
