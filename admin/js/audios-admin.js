/* ============================================================
   COCAR SAGRADO — Admin: Áudios das leituras
   Gravador orbe (MediaRecorder): um orbe solto na tela que reage
   à voz — toque grava, toque de novo para. A admin ouve o preview
   e SÓ ENTÃO escolhe o agendamento destino — salva no bucket
   privado "audios" + tabela audios_cliente. A entrega ao cliente
   é por e-mail (edge audio-email + cron de reenvio).
   ============================================================ */

let _audAgendamentos = [];   // cache da busca de agendamentos
let _audVerTodos     = false; // false = só pago/confirmado (a atender)
let _audContagem     = {};   // agendamento_id -> nº de áudios salvos
let _audTodos        = [];   // cache da aba "Áudios salvos"
let _audSalvando     = false; // trava anti duplo-clique no salvar
let _audRecorder     = null;
let _audStream       = null;
let _audChunks       = [];
let _audBlob         = null;
let _audMime         = '';
let _audMs           = 0;    // duração acumulada (só enquanto grava)
let _audTimerInt     = null;
let _audPreviewUrl   = null;
let _audAudioCtx     = null; // Web Audio só pra medir a amplitude da voz
let _audAnalyser     = null;
let _audAmostra      = null; // buffer reutilizado do analyser
let _audBarras       = [];   // 1 amplitude (0..1) a cada TICK de gravação
let _audOrbeAmp      = 0;    // amplitude suavizada que anima o orbe
let _audOrbeRaf      = null;
let _audListenersOk  = false;
let _audMicDevices    = [];  // audioinputs enumerados
let _audWakeLock      = null;
let _audBeforeUnloadOn = false;
let _audPlayerAudio   = null; // <audio> escondido que toca a prévia
let _audPlayerRaf     = null;
let _audPlayerRate    = 1;
let _audPlayerSeeking = false;

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

function _audSanitizarNomeArquivo(s) {
  return String(s || 'audio').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'audio';
}

// Sugestão pré-preenchida do nome ao compartilhar: "Leitura <tipo> - <cliente> - DD-MM"
function _audNomeSugerido(nomeCliente, tipoLeitura, dataAgendamentoISO) {
  const [, mes, dia] = String(dataAgendamentoISO || '').split('-');
  const ddmm = dia ? `${dia}-${mes}` : '';
  const base = `Leitura ${tipoLeitura || ''} - ${nomeCliente || ''} - ${ddmm}`.replace(/\s+/g, ' ').trim();
  return _audSanitizarNomeArquivo(base);
}

function _audExtDoMime(mime) {
  return String(mime || '').includes('mp4') ? 'm4a' : 'webm';
}

// Compartilhar (ou baixar, no fallback) um blob de áudio já pronto.
async function _audCompartilharBlob(blob, mime, nomeSugestao) {
  let nome = prompt('Nome do arquivo para compartilhar:', nomeSugestao);
  if (nome === null) return; // cancelou o rename
  nome = _audSanitizarNomeArquivo(nome) + '.' + _audExtDoMime(mime);

  const file = new File([blob], nome, { type: mime });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nome });
    } catch (e) {
      if (e.name !== 'AbortError') _toastAdmin('❌ Erro ao compartilhar: ' + e.message, 'erro');
    }
    return;
  }

  // Fallback (desktop/sem suporte a share de arquivos): baixa direto
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
      <div class="aud-passo" id="aud-tela-gravar">
        <div class="aud-gravador">
          <div class="aud-controles" id="aud-controles"></div>
          <select class="aud-mic-select" id="aud-mic-select" style="display:none;" onchange="_audEscolherMic(this.value)"></select>
          <div class="aud-preview" id="aud-preview"></div>
          <div class="aud-erro" id="aud-erro"></div>
        </div>
      </div>

      <div class="aud-passo" id="aud-tela-escolha" style="display:none;">
        <div class="aud-escolha-topo">
          <div class="aud-passo-titulo">Para quem enviar este áudio?</div>
          <button type="button" class="ag-btn ag-btn-outline ag-btn-sm" onclick="_audVoltarGravador()">↩ Voltar</button>
        </div>
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
    </div>

    <div id="aud-aba-todos" style="display:none;">
      <input type="text" id="aud-busca-todos" class="cup-input" autocomplete="off"
             placeholder="Buscar por cliente ou leitura…">
      <div id="aud-todos-lista" class="aud-lista" style="margin-top:10px;"></div>
    </div>`;

  document.getElementById('aud-busca').addEventListener('input', _audFiltrarLista);
  document.getElementById('aud-busca-todos').addEventListener('input', _audRenderTodos);
  if (!_audListenersOk) {
    _audListenersOk = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && _audRecorder?.state === 'recording' && !_audWakeLock) {
        _audWakeLockPedir();
      }
    });
  }
  _audResetGravador();
  _audAtualizarListaMics(); // best-effort; labels só vêm depois da 1ª permissão
}

// ============================================================
// Abas: Gravar ⇄ Áudios salvos
// ============================================================
function _audTrocarAba(aba) {
  // Sair da aba Gravar com gravação em andamento OU prévia não salva
  // descartaria áudio sem avisar
  if (aba === 'todos' && ((_audRecorder && _audRecorder.state !== 'inactive') || _audBlob)) {
    if (!confirm('Há uma gravação em andamento ou uma prévia não salva. Descartar?')) return;
    _audDescartarGravacao();
  }
  document.getElementById('aud-aba-gravar').style.display = aba === 'gravar' ? '' : 'none';
  document.getElementById('aud-aba-todos').style.display  = aba === 'todos'  ? '' : 'none';
  document.getElementById('aud-tab-gravar').classList.toggle('aud-tab--on', aba === 'gravar');
  document.getElementById('aud-tab-todos').classList.toggle('aud-tab--on', aba === 'todos');
  if (aba === 'todos') _audCarregarTodos();
}

// ============================================================
// Passo 2 — escolher o destino (aparece DEPOIS de gravar)
// ============================================================
function _audAbrirEscolha() {
  if (!_audBlob) return; // sem prévia não há o que enviar
  document.getElementById('aud-tela-gravar').style.display = 'none';
  const tela = document.getElementById('aud-tela-escolha');
  tela.style.display = '';
  const busca = document.getElementById('aud-busca');
  if (busca) busca.value = '';
  _audCarregarAgendamentos();
  tela.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _audVoltarGravador() {
  document.getElementById('aud-tela-escolha').style.display = 'none';
  document.getElementById('aud-tela-gravar').style.display = '';
}

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
      .select('id, cliente_nome, cliente_whatsapp, data_agendamento, status, leitura_origem_id, tipos_leitura(nome)')
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
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'aud-ag-item';
    const n = _audContagem[ag.id] || 0;
    item.innerHTML = `
      <span class="aud-ag-nome">${_audEsc(ag.cliente_nome)}</span>
      <span class="aud-ag-meta">${_audEsc(ag.tipos_leitura?.nome || 'Leitura')}${ag.leitura_origem_id ? ' (＋ pergunta adicional)' : ''} · ${_audDataAgend(ag.data_agendamento)}</span>
      ${n ? `<span class="aud-ag-badges"><span class="aud-ag-badge aud-ag-badge--audios">🎧 ${n} áudio${n > 1 ? 's' : ''}</span></span>` : ''}`;
    item.addEventListener('click', () => _audSalvarPara(ag));
    lista.appendChild(item);
  });
}

// ============================================================
// Passo 1 — gravador (orbe: toque grava, toque de novo para → preview)
// ============================================================
function _audSetErro(txt) {
  const el = document.getElementById('aud-erro');
  if (el) el.textContent = txt || '';
}

// ============================================================
// Orbe que reage à voz (estilo modo voz do ChatGPT): a cada frame
// lê a amplitude do analyser, suaviza (ataque rápido, soltura
// lenta) e escreve em --amp no jardim do orbe — o CSS faz o resto.
// As barras (_audBarras) continuam sendo coletadas no TICK: viram
// a onda de seek do player da prévia.
// ============================================================
function _audOrbeVozIniciar() {
  const jardim = document.querySelector('#aud-controles .aud-orbe-jardim');
  if (!jardim) return;
  cancelAnimationFrame(_audOrbeRaf);
  const passo = () => {
    const alvo = _audRecorder?.state === 'recording' ? _audAmplitudeAtual() : 0;
    _audOrbeAmp += (alvo - _audOrbeAmp) * (alvo > _audOrbeAmp ? 0.4 : 0.12);
    jardim.style.setProperty('--amp', _audOrbeAmp.toFixed(3));
    _audOrbeRaf = requestAnimationFrame(passo);
  };
  _audOrbeRaf = requestAnimationFrame(passo);
}

function _audOrbeVozParar() {
  if (_audOrbeRaf) { cancelAnimationFrame(_audOrbeRaf); _audOrbeRaf = null; }
  _audOrbeAmp = 0;
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

// ============================================================
// Seletor de microfone
// ============================================================
async function _audAtualizarListaMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let devices;
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (_) { return; }
  _audMicDevices = devices.filter(d => d.kind === 'audioinput');

  const sel = document.getElementById('aud-mic-select');
  if (!sel) return;
  if (_audMicDevices.length < 2) { sel.style.display = 'none'; sel.innerHTML = ''; return; }

  const atual = localStorage.getItem('aud_mic_device_id');
  sel.innerHTML = _audMicDevices
    .map((d, i) => `<option value="${_audEsc(d.deviceId)}">${_audEsc(d.label || `Microfone ${i + 1}`)}</option>`)
    .join('');
  if (atual && _audMicDevices.some(d => d.deviceId === atual)) sel.value = atual;
  sel.style.display = '';
}

function _audEscolherMic(deviceId) {
  localStorage.setItem('aud_mic_device_id', deviceId);
}

// ============================================================
// Wake Lock — mantém a tela acesa enquanto grava
// ============================================================
async function _audWakeLockPedir() {
  try { _audWakeLock = await navigator.wakeLock?.request('screen'); }
  catch (_) { _audWakeLock = null; }
}

async function _audWakeLockLiberar() {
  try { await _audWakeLock?.release(); } catch (_) {}
  _audWakeLock = null;
}

// ============================================================
// beforeunload — só avisa enquanto há algo pra perder
// ============================================================
function _audBeforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = '';
}

function _audAtualizarBeforeUnload() {
  const precisaAvisar = (_audRecorder && _audRecorder.state !== 'inactive') || !!_audBlob;
  if (precisaAvisar && !_audBeforeUnloadOn) {
    window.addEventListener('beforeunload', _audBeforeUnloadHandler);
    _audBeforeUnloadOn = true;
  } else if (!precisaAvisar && _audBeforeUnloadOn) {
    window.removeEventListener('beforeunload', _audBeforeUnloadHandler);
    _audBeforeUnloadOn = false;
  }
}

function _audBotoes(html) {
  const el = document.getElementById('aud-controles');
  if (el) el.innerHTML = html;
}

// O orbe é o único controle (sem ícones): parado grava, gravando para.
function _audOrbeHtml(gravando) {
  return `
    <div class="aud-orbe-jardim${gravando ? ' aud-orbe-jardim--gravando' : ''}">
      <span class="aud-orbe-aura aud-orbe-aura--quente"></span>
      <span class="aud-orbe-aura aud-orbe-aura--fria"></span>
      <span class="aud-orbe-voz"></span>
      <button type="button" class="aud-orbe"
              onclick="${gravando ? '_audPararGravacao()' : '_audComecarGravacao()'}"
              title="${gravando ? 'Parar' : 'Gravar'}"
              aria-label="${gravando ? 'Parar gravação' : 'Gravar'}">
        <span class="aud-orbe-cor aud-orbe-cor--ambar"></span>
        <span class="aud-orbe-cor aud-orbe-cor--coral"></span>
        <span class="aud-orbe-cor aud-orbe-cor--rosa"></span>
        <span class="aud-orbe-cor aud-orbe-cor--lavanda"></span>
      </button>
    </div>`;
}

function _audResetGravador() {
  if (_audTimerInt) { clearInterval(_audTimerInt); _audTimerInt = null; }
  if (_audStream) { _audStream.getTracks().forEach(t => t.stop()); _audStream = null; }
  if (_audPreviewUrl) { URL.revokeObjectURL(_audPreviewUrl); _audPreviewUrl = null; }
  _audFecharAudioCtx();
  _audPlayerLimpar();
  _audWakeLockLiberar();
  _audRecorder = null;
  _audChunks = [];
  _audBlob = null;
  _audMs = 0;
  _audBarras = [];

  // Reset sempre volta pra tela do gravador (a escolha só existe com prévia)
  const escolha = document.getElementById('aud-tela-escolha');
  const gravar  = document.getElementById('aud-tela-gravar');
  if (escolha) escolha.style.display = 'none';
  if (gravar) gravar.style.display = '';

  const preview = document.getElementById('aud-preview');
  if (preview) preview.innerHTML = '';
  _audSetErro('');
  _audOrbeVozParar();
  _audBotoes(_audOrbeHtml(false));
  _audAtualizarBeforeUnload();
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

  // m4a (audio/mp4) primeiro: toca nativo em Android E iPhone — essencial
  // agora que o áudio vai anexado no e-mail. webm é fallback (Chrome antigo/
  // Firefox, que não gravam mp4); nesses o anexo pode não tocar em iOS.
  const MIMES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  _audMime = MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '';
  if (!_audMime) {
    _audSetErro('Nenhum formato de gravação suportado neste navegador.');
    return;
  }

  const micEscolhido = localStorage.getItem('aud_mic_device_id');
  try {
    _audStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(micEscolhido ? { deviceId: { ideal: micEscolhido } } : {}),
      },
    });
  } catch (e) {
    _audSetErro(e.name === 'NotAllowedError'
      ? 'Permissão de microfone negada. Libere o microfone nas configurações do navegador.'
      : e.name === 'NotFoundError'
        ? 'Nenhum microfone encontrado.'
        : 'Não foi possível acessar o microfone: ' + e.message);
    return;
  }
  _audAtualizarListaMics(); // agora com permissão concedida, os labels vêm certos

  _audChunks = [];
  _audBlob = null;
  _audMs = 0;
  _audBarras = [];

  // Analyser só pro orbe e pras barras da prévia; se falhar, grava
  // mesmo assim (orbe fica parado, barras no mínimo)
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
    _audOrbeVozParar();
    _audWakeLockLiberar();
    _audBlob = new Blob(_audChunks, { type: _audMime.split(';')[0] });
    _audMostrarPreview();
  };
  _audRecorder.onerror = () => {
    _audSetErro('Erro na gravação. Tente de novo.');
    _audResetGravador();
  };
  _audRecorder.start(1000); // chunks de 1s: não perde tudo se algo falhar no fim
  _audWakeLockPedir();
  _audAtualizarBeforeUnload();

  // Duração pause-aware acumulada em _audMs (não dá pra confiar em
  // audio.duration depois: webm do MediaRecorder reporta Infinity no
  // Chrome). As barras seguem o mesmo relógio: 1 por _AUD_TICK de tempo
  // gravado — viram a onda de seek do player da prévia.
  let ultimo = performance.now();
  _audTimerInt = setInterval(() => {
    const agora = performance.now();
    if (_audRecorder?.state === 'recording') {
      _audMs += agora - ultimo;
      const amp = _audAmplitudeAtual();
      while (_audBarras.length < _audMs / _AUD_TICK) _audBarras.push(amp);
    }
    ultimo = agora;
  }, _AUD_TICK);

  _audBotoes(_audOrbeHtml(true));
  _audOrbeVozIniciar();
}

function _audPararGravacao() {
  if (_audRecorder && _audRecorder.state !== 'inactive') _audRecorder.stop();
}

function _audMostrarPreview() {
  _audBotoes('');

  _audPreviewUrl = URL.createObjectURL(_audBlob);
  _audPlayerRate = 1;

  const preview = document.getElementById('aud-preview');
  preview.innerHTML = `
    <div class="aud-player">
      <button type="button" class="aud-player-play" id="aud-player-play" title="Tocar" aria-label="Tocar">▶</button>
      <canvas class="aud-player-onda" id="aud-player-onda"></canvas>
      <button type="button" class="aud-player-vel" id="aud-player-vel" title="Velocidade">1x</button>
      <span class="aud-player-tempo" id="aud-player-tempo">00:00 / ${_audMmSs(_audMs / 1000)}</span>
    </div>
    <div class="aud-preview-acoes">
      <button type="button" class="ag-btn ag-btn-primary" onclick="_audAbrirEscolha()">📨 Enviar para um cliente</button>
      <button type="button" class="ag-btn ag-btn-outline" onclick="_audCompartilharPreview()">📤 Compartilhar</button>
      <button type="button" class="ag-btn ag-btn-outline" onclick="_audResetGravador(); _audComecarGravacao()">🔄 Regravar</button>
      <button type="button" class="ag-btn ag-btn-outline" onclick="_audResetGravador()">✕ Descartar</button>
    </div>`;

  _audPlayerAudio = new Audio(_audPreviewUrl);
  _audPlayerAudio.preload = 'auto';

  // webm do MediaRecorder reporta duration=Infinity no Chrome; este truque
  // força o navegador a indexar o arquivo (a duração exibida usa _audMs)
  _audPlayerAudio.addEventListener('loadedmetadata', () => {
    if (_audPlayerAudio.duration === Infinity) {
      try {
        _audPlayerAudio.currentTime = 1e101;
        _audPlayerAudio.addEventListener('timeupdate', function corrigirDuracao() {
          _audPlayerAudio.currentTime = 0;
          _audPlayerAudio.removeEventListener('timeupdate', corrigirDuracao);
        });
      } catch (_) {}
    }
  });

  const btnPlay = document.getElementById('aud-player-play');
  _audPlayerAudio.addEventListener('play', () => {
    if (btnPlay) { btnPlay.textContent = '⏸'; btnPlay.title = 'Pausar'; }
    _audPlayerLoop();
  });
  _audPlayerAudio.addEventListener('pause', () => {
    if (btnPlay) { btnPlay.textContent = '▶'; btnPlay.title = 'Tocar'; }
    _audPlayerAtualizarTempo();
  });
  _audPlayerAudio.addEventListener('ended', () => {
    if (btnPlay) { btnPlay.textContent = '▶'; btnPlay.title = 'Tocar'; }
  });

  btnPlay.addEventListener('click', _audPlayerTogglePlay);
  document.getElementById('aud-player-vel').addEventListener('click', _audPlayerCicloVelocidade);

  const onda = document.getElementById('aud-player-onda');
  _audPlayerRedimensionar(onda);
  _audPlayerDesenhar(0);
  onda.addEventListener('pointerdown', e => {
    _audPlayerSeeking = true;
    onda.setPointerCapture(e.pointerId);
    _audPlayerSeekPara(e.clientX);
  });
  onda.addEventListener('pointermove', e => { if (_audPlayerSeeking) _audPlayerSeekPara(e.clientX); });
  onda.addEventListener('pointerup', () => { _audPlayerSeeking = false; });

  _audAtualizarBeforeUnload();
}

// ============================================================
// Player custom da prévia — usa a própria onda gravada como barra
// de progresso clicável/arrastável (seek)
// ============================================================
function _audPlayerRedimensionar(c) {
  if (!c || !c.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(c.clientWidth * dpr);
  c.height = Math.round(c.clientHeight * dpr);
}

function _audPlayerDesenhar(progresso) {
  const c = document.getElementById('aud-player-onda');
  if (!c || !c.width || !_audBarras.length) return;
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = c.width, H = c.height;
  const n = _audBarras.length;
  const passo = W / n;
  const larg = Math.max(1.5 * dpr, passo * 0.6);
  const idxAtual = Math.floor(Math.min(1, Math.max(0, progresso)) * n);

  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < n; i++) {
    const h = Math.max(2 * dpr, _audBarras[i] * H * 0.9);
    ctx.fillStyle = i <= idxAtual ? 'rgba(226,231,240,0.95)' : 'rgba(255,255,255,0.22)';
    ctx.fillRect(i * passo, (H - h) / 2, larg, h);
  }
}

function _audPlayerAtualizarTempo() {
  if (!_audPlayerAudio || !_audMs) return;
  const el = document.getElementById('aud-player-tempo');
  if (el) el.textContent = `${_audMmSs(_audPlayerAudio.currentTime)} / ${_audMmSs(_audMs / 1000)}`;
  _audPlayerDesenhar(_audPlayerAudio.currentTime / (_audMs / 1000));
}

function _audPlayerLoop() {
  _audPlayerAtualizarTempo();
  if (_audPlayerAudio && !_audPlayerAudio.paused) {
    _audPlayerRaf = requestAnimationFrame(_audPlayerLoop);
  } else {
    _audPlayerRaf = null;
  }
}

function _audPlayerTogglePlay() {
  if (!_audPlayerAudio) return;
  if (_audPlayerAudio.paused) _audPlayerAudio.play().catch(() => {});
  else _audPlayerAudio.pause();
}

function _audPlayerCicloVelocidade() {
  const ciclos = [1, 1.5, 2];
  _audPlayerRate = ciclos[(ciclos.indexOf(_audPlayerRate) + 1) % ciclos.length];
  if (_audPlayerAudio) _audPlayerAudio.playbackRate = _audPlayerRate;
  const btn = document.getElementById('aud-player-vel');
  if (btn) btn.textContent = _audPlayerRate + 'x';
}

function _audPlayerSeekPara(clientX) {
  const c = document.getElementById('aud-player-onda');
  if (!c || !_audPlayerAudio || !_audMs) return;
  const rect = c.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  _audPlayerAudio.currentTime = frac * (_audMs / 1000);
  _audPlayerDesenhar(frac);
  const el = document.getElementById('aud-player-tempo');
  if (el) el.textContent = `${_audMmSs(_audPlayerAudio.currentTime)} / ${_audMmSs(_audMs / 1000)}`;
}

function _audPlayerLimpar() {
  if (_audPlayerRaf) { cancelAnimationFrame(_audPlayerRaf); _audPlayerRaf = null; }
  if (_audPlayerAudio) { _audPlayerAudio.pause(); _audPlayerAudio.src = ''; _audPlayerAudio = null; }
  _audPlayerSeeking = false;
}

// Botão "Compartilhar" no preview (antes de escolher o cliente,
// então a sugestão de nome leva só a data de hoje)
async function _audCompartilharPreview() {
  if (!_audBlob) return;
  const hoje = new Date();
  const ddmm = `${String(hoje.getDate()).padStart(2, '0')}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  await _audCompartilharBlob(_audBlob, _audMime.split(';')[0], _audSanitizarNomeArquivo(`Leitura - ${ddmm}`));
}

// ============================================================
// Salvar: clique no cliente → upload no bucket privado + insert
// + disparo do e-mail
// ============================================================
async function _audSalvarPara(ag) {
  if (!_audBlob || _audSalvando) return;
  const meta = `${ag.tipos_leitura?.nome || 'Leitura'} · ${_audDataAgend(ag.data_agendamento)}`;
  if (!confirm(`Salvar e enviar por e-mail para ${ag.cliente_nome}?\n(${meta})`)) return;

  _audSalvando = true;
  const lista = document.getElementById('aud-ag-lista');
  lista.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Salvando…</div>';

  const contentType = _audMime.split(';')[0];
  const ext  = contentType === 'audio/mp4' ? 'm4a' : 'webm';
  const path = `agendamento-${ag.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const seg  = Math.max(1, Math.round(_audMs / 1000));

  const { error: upErr } = await supabase.storage
    .from('audios')
    .upload(path, _audBlob, { contentType });

  if (upErr) {
    _audSalvando = false;
    _toastAdmin('❌ Falha no upload: ' + upErr.message, 'erro');
    _audFiltrarLista(); // volta a lista pra tentar de novo
    return;
  }

  const { data: novo, error: dbErr } = await supabase.from('audios_cliente').insert({
    agendamento_id: ag.id,
    storage_path: path,
    duracao_segundos: seg,
    tamanho_bytes: _audBlob.size,
    mime: contentType,
  }).select('id').single();

  if (dbErr) {
    await supabase.storage.from('audios').remove([path]); // não deixar arquivo órfão
    _audSalvando = false;
    _toastAdmin('❌ Erro ao salvar: ' + dbErr.message, 'erro');
    _audFiltrarLista();
    return;
  }

  _audContagem[ag.id] = (_audContagem[ag.id] || 0) + 1;
  _audSalvando = false;
  _toastAdmin('✅ Áudio salvo! Enviando por e-mail…', 'ok');
  _audResetGravador(); // limpa a prévia e volta pro microfone

  // Envio imediato pro e-mail do cliente. Se falhar (rede etc.), o cron
  // audio-email-cron reenvia sozinho em até 10 min — não trava o painel.
  try {
    const { error: fnErr } = await supabase.functions.invoke('audio-email', {
      body: { audio_id: novo.id },
    });
    if (fnErr) throw fnErr;
    _toastAdmin('📧 Leitura enviada pro e-mail do cliente.', 'ok');
  } catch (_) {
    _toastAdmin('⚠️ E-mail não saiu agora — reenvio automático em até 10 min.', 'erro');
  }
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
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-share" title="Compartilhar">📤</button>
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

  // Compartilhar: baixa o blob via signed URL antes de abrir o menu de share
  item.querySelector('.aud-item-share').addEventListener('click', async ev => {
    const b = ev.currentTarget;
    const original = b.textContent;
    b.disabled = true;
    b.textContent = '…';
    try {
      const { data: s, error: e } = await supabase.storage
        .from('audios')
        .createSignedUrl(a.storage_path, 3600);
      if (e || !s?.signedUrl) {
        _toastAdmin('❌ Não deu pra baixar o áudio: ' + (e?.message || 'tente de novo'), 'erro');
        return;
      }
      const resp = await fetch(s.signedUrl);
      const blob = await resp.blob();
      await _audCompartilharBlob(blob, a.mime || blob.type, opts.nomeSugestao || 'Áudio');
    } catch (err) {
      _toastAdmin('❌ Erro ao preparar o compartilhamento: ' + err.message, 'erro');
    } finally {
      b.disabled = false;
      b.textContent = original;
    }
  });

  item.querySelector('.aud-item-del').addEventListener('click', async () => {
    if (!confirm('Apagar este áudio? Se o e-mail ainda não saiu, ele não será enviado.')) return;
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
// Aba "Áudios salvos" — histórico geral, sem escolher cliente
// ============================================================
async function _audCarregarTodos() {
  const lista = document.getElementById('aud-todos-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando…</div>';

  const { data, error } = await supabase
    .from('audios_cliente')
    .select('*, agendamentos(id, cliente_nome, cliente_whatsapp, data_agendamento, leitura_origem_id, tipos_leitura(nome))')
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
      nomeSugestao: _audNomeSugerido(ag?.cliente_nome, ag?.tipos_leitura?.nome, ag?.data_agendamento),
    }));
  });
}

window.inicializarAudios = inicializarAudios;
window._audComecarGravacao = _audComecarGravacao;
window._audPararGravacao = _audPararGravacao;
window._audResetGravador = _audResetGravador;
window._audAbrirEscolha = _audAbrirEscolha;
window._audVoltarGravador = _audVoltarGravador;
window._audTrocarAba = _audTrocarAba;
window._audFiltroStatus = _audFiltroStatus;
window._audEscolherMic = _audEscolherMic;
window._audCompartilharPreview = _audCompartilharPreview;
