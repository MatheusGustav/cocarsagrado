/* ============================================================
   COCAR SAGRADO — Admin: Áudios das leituras
   Gravador estilo celular (MediaRecorder): a admin escolhe o
   agendamento, grava (pausa/retoma), ouve o preview e salva no
   bucket privado "audios" + tabela audios_cliente (user_id vem
   de trigger no banco). Cliente logado ouve no drawer do site.
   ============================================================ */

let _audAgendamentos = [];   // cache da busca de agendamentos
let _audVerTodos     = false; // false = só pago/confirmado (a atender)
let _audContagem     = {};   // agendamento_id -> nº de áudios salvos
let _audTodos        = [];   // cache da aba "Áudios salvos"
let _audSelecionado  = null; // agendamento destino
let _audRecorder     = null;
let _audStream       = null;
let _audChunks       = [];
let _audBlob         = null;
let _audMime         = '';
let _audMs           = 0;    // duração acumulada (só enquanto grava)
let _audTimerInt     = null;
let _audPreviewUrl   = null;
let _audAudioCtx     = null; // Web Audio só pra desenhar a onda
let _audAnalyser     = null;
let _audAmostra      = null; // buffer reutilizado do analyser
let _audBarras       = [];   // 1 amplitude (0..1) a cada TICK de gravação
let _audResizeOk     = false;

const _AUD_TICK = 50; // ms por barra da onda (20 barras/s)

function _audEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _audMmSs(seg) {
  const s = Math.max(0, Math.round(Number(seg) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Timer grande estilo gravador de celular: MM:SS.cc
function _audMmSsCc(ms) {
  const t = Math.max(0, Number(ms) || 0);
  const s = Math.floor(t / 1000);
  const cc = Math.floor((t % 1000) / 10);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}

function _audDataBR(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// data_agendamento é date puro (YYYY-MM-DD) — cortar a string evita
// o shift de fuso do new Date()
function _audDataAgend(str) {
  const [a, m, d] = String(str || '').split('-');
  return d ? `${d}/${m}/${a}` : '';
}

// ============================================================
// Init da seção
// ============================================================
async function inicializarAudios() {
  const container = document.getElementById('audios-container');
  if (!container) return;

  container.innerHTML = `
    <div class="aud-tabs">
      <button type="button" class="aud-tab aud-tab--on" id="aud-tab-gravar" onclick="_audTrocarAba('gravar')">🎙 Gravar</button>
      <button type="button" class="aud-tab" id="aud-tab-todos" onclick="_audTrocarAba('todos')">🎧 Áudios salvos</button>
    </div>

    <div id="aud-aba-gravar">
      <div class="aud-passo" id="aud-tela-escolha">
        <div class="aud-passo-titulo">Para quem é o áudio?</div>
        <div class="aud-filtros">
          <button type="button" class="aud-filtro aud-filtro--on" id="aud-filtro-pendentes" onclick="_audFiltroStatus(false)">A atender</button>
          <button type="button" class="aud-filtro" id="aud-filtro-todos" onclick="_audFiltroStatus(true)">Todos (inclui atendidos)</button>
        </div>
        <input type="text" id="aud-busca" class="cup-input" autocomplete="off"
               placeholder="Buscar por nome, leitura ou WhatsApp…">
        <div id="aud-ag-lista" class="aud-ag-lista">
          <div class="ag-loading"><div class="ag-spinner"></div> Carregando…</div>
        </div>
      </div>

      <div class="aud-passo" id="aud-tela-gravar" style="display:none;">
        <div class="aud-gravador">
          <div class="aud-timer" id="aud-timer">00:00.00</div>
          <div class="aud-estado" id="aud-estado">Pronto para gravar</div>
          <canvas class="aud-onda" id="aud-onda"></canvas>
          <div class="aud-controles" id="aud-controles"></div>
          <div class="aud-preview" id="aud-preview"></div>
          <div class="aud-erro" id="aud-erro"></div>
        </div>
        <div class="aud-destino" id="aud-destino"></div>
        <div id="aud-lista" class="aud-lista"></div>
      </div>
    </div>

    <div id="aud-aba-todos" style="display:none;">
      <input type="text" id="aud-busca-todos" class="cup-input" autocomplete="off"
             placeholder="Buscar por cliente ou leitura…">
      <div id="aud-todos-lista" class="aud-lista" style="margin-top:10px;"></div>
    </div>`;

  document.getElementById('aud-busca').addEventListener('input', _audFiltrarLista);
  document.getElementById('aud-busca-todos').addEventListener('input', _audRenderTodos);
  if (!_audResizeOk) {
    _audResizeOk = true;
    window.addEventListener('resize', () => { _audOndaRedimensionar(); _audOndaDesenhar(); });
  }
  _audResetGravador();
  await _audCarregarAgendamentos();
}

// ============================================================
// Abas: Gravar ⇄ Áudios salvos
// ============================================================
function _audTrocarAba(aba) {
  // Sair da aba Gravar no meio de uma gravação descartaria áudio sem avisar
  if (aba === 'todos' && _audRecorder && _audRecorder.state !== 'inactive') {
    if (!confirm('Há uma gravação em andamento. Descartar?')) return;
    _audDescartarGravacao();
  }
  document.getElementById('aud-aba-gravar').style.display = aba === 'gravar' ? '' : 'none';
  document.getElementById('aud-aba-todos').style.display  = aba === 'todos'  ? '' : 'none';
  document.getElementById('aud-tab-gravar').classList.toggle('aud-tab--on', aba === 'gravar');
  document.getElementById('aud-tab-todos').classList.toggle('aud-tab--on', aba === 'todos');
  if (aba === 'todos') _audCarregarTodos();
}

// ============================================================
// Passo 1 — seletor de agendamento
// ============================================================
function _audFiltroStatus(verTodos) {
  if (verTodos === _audVerTodos) return;
  _audVerTodos = verTodos;
  document.getElementById('aud-filtro-pendentes').classList.toggle('aud-filtro--on', !verTodos);
  document.getElementById('aud-filtro-todos').classList.toggle('aud-filtro--on', verTodos);
  _audCarregarAgendamentos();
}

async function _audCarregarAgendamentos() {
  const lista = document.getElementById('aud-ag-lista');
  if (!lista) return;

  lista.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando…</div>';

  // Padrão: fila de quem falta atender. "Todos" inclui atendidos (regravar etc.)
  const status = _audVerTodos ? ['pago', 'confirmado', 'atendido'] : ['pago', 'confirmado'];
  const [ags, cnts] = await Promise.all([
    supabase
      .from('agendamentos')
      .select('id, cliente_nome, cliente_whatsapp, data_agendamento, status, leitura_origem_id, tipos_leitura(nome), pedidos(user_id)')
      .in('status', status)
      // fila: mais próximo primeiro; "todos": mais recente primeiro
      .order('data_agendamento', { ascending: !_audVerTodos })
      .limit(100),
    supabase.from('audios_cliente').select('agendamento_id'),
  ]);

  if (ags.error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar agendamentos.</div>';
    console.error('_audCarregarAgendamentos:', ags.error);
    return;
  }

  _audContagem = {};
  (cnts.data || []).forEach(r => {
    _audContagem[r.agendamento_id] = (_audContagem[r.agendamento_id] || 0) + 1;
  });

  _audAgendamentos = ags.data || [];
  _audRenderLista(_audAgendamentos);
}

function _audFiltrarLista() {
  const termo = (document.getElementById('aud-busca')?.value || '').trim().toLowerCase();
  if (!termo) { _audRenderLista(_audAgendamentos); return; }
  _audRenderLista(_audAgendamentos.filter(ag =>
    (ag.cliente_nome || '').toLowerCase().includes(termo) ||
    (ag.cliente_whatsapp || '').toLowerCase().includes(termo) ||
    (ag.tipos_leitura?.nome || '').toLowerCase().includes(termo)
  ));
}

function _audRenderLista(ags) {
  const lista = document.getElementById('aud-ag-lista');
  if (!lista) return;

  if (!ags.length) {
    lista.innerHTML = `<div class="ag-empty">${_audVerTodos
      ? 'Nenhum agendamento pago encontrado.'
      : 'Ninguém na fila 🎉 — todos os pagos já foram atendidos.'}</div>`;
    return;
  }

  lista.innerHTML = '';
  ags.forEach(ag => {
    const temConta = !!ag.pedidos?.user_id;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'aud-ag-item' + (_audSelecionado?.id === ag.id ? ' aud-ag-item--sel' : '');
    const n = _audContagem[ag.id] || 0;
    item.innerHTML = `
      <span class="aud-ag-nome">${_audEsc(ag.cliente_nome)}</span>
      <span class="aud-ag-meta">${_audEsc(ag.tipos_leitura?.nome || 'Leitura')}${ag.leitura_origem_id ? ' (＋ pergunta adicional)' : ''} · ${_audDataAgend(ag.data_agendamento)}</span>
      <span class="aud-ag-badges">
        <span class="aud-ag-badge ${temConta ? 'aud-ag-badge--conta' : 'aud-ag-badge--guest'}">
          ${temConta ? 'com conta' : 'sem conta — não aparece no site'}
        </span>
        ${n ? `<span class="aud-ag-badge aud-ag-badge--audios">🎧 ${n} áudio${n > 1 ? 's' : ''}</span>` : ''}
      </span>`;
    item.addEventListener('click', () => _audSelecionar(ag));
    lista.appendChild(item);
  });
}

async function _audSelecionar(ag) {
  _audSelecionado = ag;

  // A tela de escolha some; fica só o gravador + destino + histórico
  document.getElementById('aud-tela-escolha').style.display = 'none';
  const tela = document.getElementById('aud-tela-gravar');
  tela.style.display = '';
  document.getElementById('aud-destino').innerHTML = `
    <div class="aud-destino-info">
      <span class="aud-destino-nome">${_audEsc(ag.cliente_nome)}</span>
      <span class="aud-destino-meta">${_audEsc(ag.tipos_leitura?.nome || 'Leitura')}${ag.leitura_origem_id ? ' (＋ pergunta adicional)' : ''} · ${_audDataAgend(ag.data_agendamento)}</span>
    </div>
    <button type="button" class="ag-btn ag-btn-outline ag-btn-sm" onclick="_audVoltarEscolha()">↩ Trocar</button>`;
  _audResetGravador();
  _audOndaRedimensionar(); // o canvas nasce escondido (display:none); mede agora
  _audOndaDesenhar();
  await _audCarregarAudiosDoAgendamento();
  tela.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _audVoltarEscolha() {
  // Voltar no meio de uma gravação descartaria áudio sem avisar
  if (_audRecorder && _audRecorder.state !== 'inactive') {
    if (!confirm('Há uma gravação em andamento. Descartar e trocar de atendimento?')) return;
  }
  _audDescartarGravacao();
  _audSelecionado = null;
  document.getElementById('aud-tela-gravar').style.display = 'none';
  document.getElementById('aud-tela-escolha').style.display = '';
  _audFiltrarLista(); // re-render sem seleção marcada
}

// ============================================================
// Passo 2 — gravador (idle → gravando ⇄ pausado → preview)
// ============================================================
function _audSetEstado(txt) {
  const el = document.getElementById('aud-estado');
  if (el) el.textContent = txt;
}

function _audSetErro(txt) {
  const el = document.getElementById('aud-erro');
  if (el) el.textContent = txt || '';
}

function _audAtualizaTimer() {
  const el = document.getElementById('aud-timer');
  if (el) el.textContent = _audMmSsCc(_audMs);
}

// ============================================================
// Forma de onda (canvas): barras rolam da direita pra esquerda,
// cursor fixo no centro, régua de segundos embaixo — igual
// gravador de celular.
// ============================================================
function _audOndaRedimensionar() {
  const c = document.getElementById('aud-onda');
  if (!c || !c.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  c.width  = Math.round(c.clientWidth * dpr);
  c.height = Math.round(c.clientHeight * dpr);
}

function _audOndaDesenhar() {
  const c = document.getElementById('aud-onda');
  if (!c || !c.width) return;
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = c.width, H = c.height;
  const regua = 30 * dpr;              // faixa dos rótulos de tempo
  const meioY = (H - regua) / 2;       // linha de base da onda
  const passo = 4 * dpr;               // largura de 1 barra + espaço
  const larg  = 2 * dpr;
  const pxSeg = passo * (1000 / _AUD_TICK); // px por segundo
  const cx = W / 2;
  const elapsed = _audMs / 1000;

  ctx.clearRect(0, 0, W, H);

  // pontilhado de base: à direita do cursor (futuro) e à esquerda do
  // ponto onde a gravação começou (antes do 00:00)
  const xInicio = cx - elapsed * pxSeg;
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  for (let x = cx + passo; x < W; x += passo) ctx.fillRect(x, meioY - dpr, larg, 2 * dpr);
  for (let x = cx - passo; x > 0; x -= passo) {
    if (x >= xInicio) continue;
    ctx.fillRect(x, meioY - dpr, larg, 2 * dpr);
  }

  // barras já gravadas (barra i cobre o instante i*TICK)
  ctx.fillStyle = 'rgba(226,231,240,0.92)';
  for (let i = 0; i < _audBarras.length; i++) {
    const x = cx - (elapsed - (i * _AUD_TICK) / 1000) * pxSeg;
    if (x < -passo) continue;
    if (x > cx) break;
    const h = Math.max(2 * dpr, _audBarras[i] * meioY * 1.5);
    ctx.fillRect(x, meioY - h / 2, larg, h);
  }

  // régua de segundos
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  const alcance = Math.ceil(cx / pxSeg) + 1;
  for (let k = Math.max(0, Math.floor(elapsed - alcance)); k <= elapsed + alcance; k++) {
    const x = cx + (k - elapsed) * pxSeg;
    if (x < 12 * dpr || x > W - 12 * dpr) continue;
    ctx.fillText(_audMmSs(k), x, H - 10 * dpr);
  }

  // cursor central: linha vertical com bolinha nas pontas
  const topo = 6 * dpr, fundo = H - regua - 2 * dpr;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(cx, topo); ctx.lineTo(cx, fundo); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.arc(cx, topo, 3 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, fundo, 3 * dpr, 0, Math.PI * 2); ctx.fill();
}

function _audAmplitudeAtual() {
  if (!_audAnalyser) return 0;
  _audAnalyser.getByteTimeDomainData(_audAmostra);
  let pico = 0;
  for (let i = 0; i < _audAmostra.length; i++) {
    const v = Math.abs(_audAmostra[i] - 128) / 128;
    if (v > pico) pico = v;
  }
  return Math.min(1, pico * 1.6);
}

function _audFecharAudioCtx() {
  if (_audAudioCtx) { _audAudioCtx.close().catch(() => {}); }
  _audAudioCtx = null;
  _audAnalyser = null;
  _audAmostra = null;
}

function _audBotoes(html) {
  const el = document.getElementById('aud-controles');
  if (el) el.innerHTML = html;
}

function _audResetGravador() {
  if (_audTimerInt) { clearInterval(_audTimerInt); _audTimerInt = null; }
  if (_audStream) { _audStream.getTracks().forEach(t => t.stop()); _audStream = null; }
  if (_audPreviewUrl) { URL.revokeObjectURL(_audPreviewUrl); _audPreviewUrl = null; }
  _audFecharAudioCtx();
  _audRecorder = null;
  _audChunks = [];
  _audBlob = null;
  _audMs = 0;
  _audBarras = [];

  const preview = document.getElementById('aud-preview');
  if (preview) preview.innerHTML = '';
  _audSetErro('');
  _audAtualizaTimer();
  _audOndaDesenhar();
  _audSetEstado('Pronto para gravar');
  _audBotoes(`
    <button type="button" class="aud-btn-anel" onclick="_audComecarGravacao()" title="Gravar" aria-label="Gravar">
      <span class="aud-miolo aud-miolo-rec"></span>
    </button>`);
}

function _audDescartarGravacao() {
  try { if (_audRecorder && _audRecorder.state !== 'inactive') { _audRecorder.onstop = null; _audRecorder.stop(); } } catch (_) {}
  _audResetGravador();
}

async function _audComecarGravacao() {
  _audSetErro('');

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    _audSetErro('Este navegador não suporta gravação de áudio (precisa de HTTPS ou localhost).');
    return;
  }

  const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  _audMime = MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '';
  if (!_audMime) {
    _audSetErro('Nenhum formato de gravação suportado neste navegador.');
    return;
  }

  try {
    _audStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    _audSetErro(e.name === 'NotAllowedError'
      ? 'Permissão de microfone negada. Libere o microfone nas configurações do navegador.'
      : e.name === 'NotFoundError'
        ? 'Nenhum microfone encontrado.'
        : 'Não foi possível acessar o microfone: ' + e.message);
    return;
  }

  _audChunks = [];
  _audBlob = null;
  _audMs = 0;
  _audBarras = [];
  _audAtualizaTimer();
  _audOndaRedimensionar();

  // Analyser só pra onda; se falhar, grava mesmo assim (barras ficam no mínimo)
  try {
    _audAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    _audAnalyser = _audAudioCtx.createAnalyser();
    _audAnalyser.fftSize = 512;
    _audAudioCtx.createMediaStreamSource(_audStream).connect(_audAnalyser);
    _audAmostra = new Uint8Array(_audAnalyser.fftSize);
  } catch (_) { _audFecharAudioCtx(); }

  _audRecorder = new MediaRecorder(_audStream, { mimeType: _audMime });
  _audRecorder.ondataavailable = e => { if (e.data?.size) _audChunks.push(e.data); };
  _audRecorder.onstop = () => {
    if (_audTimerInt) { clearInterval(_audTimerInt); _audTimerInt = null; }
    _audStream?.getTracks().forEach(t => t.stop());
    _audStream = null;
    _audFecharAudioCtx();
    _audBlob = new Blob(_audChunks, { type: _audMime.split(';')[0] });
    _audMostrarPreview();
  };
  _audRecorder.onerror = () => {
    _audSetErro('Erro na gravação. Tente de novo.');
    _audResetGravador();
  };
  _audRecorder.start(1000); // chunks de 1s: não perde tudo se algo falhar no fim

  // Timer pause-aware: soma só enquanto está gravando de verdade.
  // (Não dá pra confiar em audio.duration depois: webm do MediaRecorder
  // reporta Infinity no Chrome.) A onda anda no mesmo relógio: 1 barra
  // por _AUD_TICK de tempo gravado, então pausa congela tudo junto.
  let ultimo = performance.now();
  _audTimerInt = setInterval(() => {
    const agora = performance.now();
    if (_audRecorder?.state === 'recording') {
      _audMs += agora - ultimo;
      const amp = _audAmplitudeAtual();
      while (_audBarras.length < _audMs / _AUD_TICK) _audBarras.push(amp);
    }
    ultimo = agora;
    _audAtualizaTimer();
    _audOndaDesenhar();
  }, _AUD_TICK);

  _audSetEstado('Gravando…');
  _audBotoes(`
    <button type="button" class="aud-btn-anel" onclick="_audPararGravacao()" title="Parar" aria-label="Parar">
      <span class="aud-miolo aud-miolo-stop"></span>
    </button>
    <button type="button" class="aud-btn-escuro" onclick="_audPausarRetomar()" id="aud-btn-pausa" title="Pausar" aria-label="Pausar">
      <span class="aud-ico-pausa"></span>
    </button>`);
}

function _audPausarRetomar() {
  if (!_audRecorder) return;
  const btn = document.getElementById('aud-btn-pausa');
  if (_audRecorder.state === 'recording') {
    _audRecorder.pause();
    _audSetEstado('Pausado');
    if (btn) {
      btn.innerHTML = '<span class="aud-ico-play"></span>';
      btn.title = 'Retomar'; btn.setAttribute('aria-label', 'Retomar');
    }
  } else if (_audRecorder.state === 'paused') {
    _audRecorder.resume();
    _audSetEstado('Gravando…');
    if (btn) {
      btn.innerHTML = '<span class="aud-ico-pausa"></span>';
      btn.title = 'Pausar'; btn.setAttribute('aria-label', 'Pausar');
    }
  }
}

function _audPararGravacao() {
  if (_audRecorder && _audRecorder.state !== 'inactive') _audRecorder.stop();
}

function _audMostrarPreview() {
  _audSetEstado(`Prévia — ${_audMmSs(_audMs / 1000)}`);
  _audBotoes('');

  _audPreviewUrl = URL.createObjectURL(_audBlob);
  const preview = document.getElementById('aud-preview');
  preview.innerHTML = `
    <audio controls src="${_audPreviewUrl}"></audio>
    <div class="aud-preview-acoes">
      <button type="button" class="ag-btn ag-btn-primary" id="aud-btn-salvar" onclick="_audSalvar()">💾 Salvar para o cliente</button>
      <button type="button" class="ag-btn ag-btn-outline" onclick="_audResetGravador(); _audComecarGravacao()">🔄 Regravar</button>
      <button type="button" class="ag-btn ag-btn-outline" onclick="_audResetGravador()">✕ Descartar</button>
    </div>`;
}

// ============================================================
// Salvar: upload no bucket privado + insert (user_id via trigger)
// ============================================================
async function _audSalvar() {
  if (!_audBlob || !_audSelecionado) return;

  const btn = document.getElementById('aud-btn-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  const contentType = _audMime.split(';')[0];
  const ext  = contentType === 'audio/mp4' ? 'm4a' : 'webm';
  const path = `agendamento-${_audSelecionado.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const seg  = Math.max(1, Math.round(_audMs / 1000));

  const { error: upErr } = await supabase.storage
    .from('audios')
    .upload(path, _audBlob, { contentType });

  if (upErr) {
    btn.disabled = false;
    btn.textContent = '💾 Salvar para o cliente';
    _toastAdmin('❌ Falha no upload: ' + upErr.message, 'erro');
    return;
  }

  const { error: dbErr } = await supabase.from('audios_cliente').insert({
    agendamento_id: _audSelecionado.id,
    storage_path: path,
    duracao_segundos: seg,
    tamanho_bytes: _audBlob.size,
    mime: contentType,
  });

  if (dbErr) {
    await supabase.storage.from('audios').remove([path]); // não deixar arquivo órfão
    btn.disabled = false;
    btn.textContent = '💾 Salvar para o cliente';
    _toastAdmin('❌ Erro ao salvar: ' + dbErr.message, 'erro');
    return;
  }

  _audContagem[_audSelecionado.id] = (_audContagem[_audSelecionado.id] || 0) + 1;
  const temConta = !!_audSelecionado.pedidos?.user_id;
  _toastAdmin('✅ Áudio salvo!' + (temConta ? ' O cliente já vê na conta dele.' : ' Cliente sem conta — fica só aqui no painel.'), 'ok');
  _audResetGravador();
  await _audCarregarAudiosDoAgendamento();
}

// ============================================================
// Item de áudio (usado nas duas listas): ouvir lazy + apagar
// ============================================================
function _audCriarItemAudio(a, opts = {}) {
  const item = document.createElement('div');
  item.className = 'aud-item';
  item.innerHTML = `
    <div class="aud-item-info">
      <span class="aud-item-nome">${opts.titulo}</span>
      <span class="aud-item-meta">${opts.meta}</span>
    </div>
    <div class="aud-item-acoes">
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-play">▶ Ouvir</button>
      ${opts.aoGravar ? '<button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-gravar" title="Gravar outro pra este atendimento">🎙 Gravar</button>' : ''}
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-del" style="color:var(--t-danger)" title="Apagar">🗑</button>
    </div>`;

  // Player lazy: signed URL só quando pedir pra ouvir
  item.querySelector('.aud-item-play').addEventListener('click', async ev => {
    const b = ev.currentTarget;
    b.disabled = true;
    const { data: s, error: e } = await supabase.storage
      .from('audios')
      .createSignedUrl(a.storage_path, 3600);
    if (e || !s?.signedUrl) {
      b.disabled = false;
      _toastAdmin('❌ Não deu pra abrir o áudio: ' + (e?.message || 'tente de novo'), 'erro');
      return;
    }
    const player = document.createElement('audio');
    player.controls = true;
    player.src = s.signedUrl;
    b.replaceWith(player);
    player.play().catch(() => {});
  });

  if (opts.aoGravar) {
    item.querySelector('.aud-item-gravar').addEventListener('click', opts.aoGravar);
  }

  item.querySelector('.aud-item-del').addEventListener('click', async () => {
    if (!confirm('Apagar este áudio? O cliente deixa de vê-lo na conta.')) return;
    // Linha primeiro (é a fonte de verdade pro cliente); órfão no bucket
    // privado é inofensivo se o remove falhar.
    const { error: e } = await supabase.from('audios_cliente').delete().eq('id', a.id);
    if (e) { _toastAdmin('❌ ' + e.message, 'erro'); return; }
    const { error: eSt } = await supabase.storage.from('audios').remove([a.storage_path]);
    if (eSt) console.warn('arquivo órfão no bucket audios:', a.storage_path, eSt);
    if (_audContagem[a.agendamento_id]) _audContagem[a.agendamento_id]--;
    _audTodos = _audTodos.filter(t => t.id !== a.id);
    item.remove();
    _toastAdmin('✅ Áudio apagado.', 'ok');
  });

  return item;
}

// ============================================================
// Lista de áudios do agendamento selecionado
// ============================================================
async function _audCarregarAudiosDoAgendamento() {
  const lista = document.getElementById('aud-lista');
  if (!lista || !_audSelecionado) return;

  const { data, error } = await supabase
    .from('audios_cliente')
    .select('*')
    .eq('agendamento_id', _audSelecionado.id)
    .order('criado_em', { ascending: true });

  if (error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar os áudios.</div>';
    console.error('_audCarregarAudiosDoAgendamento:', error);
    return;
  }

  if (!data?.length) {
    lista.innerHTML = '<div class="ag-empty" style="margin-top:12px">Nenhum áudio gravado para este agendamento ainda.</div>';
    return;
  }

  lista.innerHTML = '<div class="aud-lista-titulo">Áudios já gravados</div>';
  data.forEach((a, i) => {
    lista.appendChild(_audCriarItemAudio(a, {
      titulo: `🎧 Áudio ${i + 1}`,
      meta: `${_audDataBR(a.criado_em)} · ${_audMmSs(a.duracao_segundos)}`,
    }));
  });
}

// ============================================================
// Aba "Áudios salvos" — histórico geral, sem escolher cliente
// ============================================================
async function _audCarregarTodos() {
  const lista = document.getElementById('aud-todos-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando…</div>';

  const { data, error } = await supabase
    .from('audios_cliente')
    .select('*, agendamentos(id, cliente_nome, cliente_whatsapp, data_agendamento, leitura_origem_id, tipos_leitura(nome), pedidos(user_id))')
    .order('criado_em', { ascending: false })
    .limit(200);

  if (error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar os áudios.</div>';
    console.error('_audCarregarTodos:', error);
    return;
  }

  _audTodos = data || [];
  _audRenderTodos();
}

function _audRenderTodos() {
  const lista = document.getElementById('aud-todos-lista');
  if (!lista) return;

  const termo = (document.getElementById('aud-busca-todos')?.value || '').trim().toLowerCase();
  const itens = !termo ? _audTodos : _audTodos.filter(a =>
    (a.agendamentos?.cliente_nome || '').toLowerCase().includes(termo) ||
    (a.agendamentos?.cliente_whatsapp || '').toLowerCase().includes(termo) ||
    (a.agendamentos?.tipos_leitura?.nome || '').toLowerCase().includes(termo)
  );

  if (!itens.length) {
    lista.innerHTML = `<div class="ag-empty">${termo ? 'Nada encontrado.' : 'Nenhum áudio salvo ainda.'}</div>`;
    return;
  }

  lista.innerHTML = '';
  itens.forEach(a => {
    const ag = a.agendamentos;
    lista.appendChild(_audCriarItemAudio(a, {
      titulo: _audEsc(ag?.cliente_nome || 'Cliente'),
      meta: `${_audEsc(ag?.tipos_leitura?.nome || 'Leitura')} · ${_audDataAgend(ag?.data_agendamento)} · gravado em ${_audDataBR(a.criado_em)} · ${_audMmSs(a.duracao_segundos)}`,
      aoGravar: ag ? () => { _audTrocarAba('gravar'); _audSelecionar(ag); } : null,
    }));
  });
}

window.inicializarAudios = inicializarAudios;
window._audComecarGravacao = _audComecarGravacao;
window._audPausarRetomar = _audPausarRetomar;
window._audPararGravacao = _audPararGravacao;
window._audResetGravador = _audResetGravador;
window._audVoltarEscolha = _audVoltarEscolha;
window._audTrocarAba = _audTrocarAba;
window._audFiltroStatus = _audFiltroStatus;
window._audSalvar = _audSalvar;
