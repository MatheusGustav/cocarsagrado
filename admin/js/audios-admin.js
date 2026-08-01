/* ============================================================
   COCAR SAGRADO — Admin: Áudios das leituras
   Fluxo em linha reta, gravação primeiro:
   1. Mesa de fita: a leitura é um cassete com o nome do cliente
      na etiqueta. Tecla GRAVAR gira os carretéis; o VU de agulha
      mede a voz ao vivo (é o rosto da sentinela: agulha deitada
      + led SEM SOM = mic morto). PARAR rebobina pra prévia, e o
      cassete/tecla TOCAR tocam com o dock de player embaixo. O
      chip mostra o destino (ou "sem cliente") e deixa trocar.
   2. "Salvar para um cliente…" abre a lista de agendamentos
      pagos; escolher com prévia pendente já salva na hora.
   3. O salvar sobe pro bucket privado "audios" +
      audios_cliente e o dock vira o painel de entrega: enviar
      e-mail agora (edge audio-email; o cron de 10 em 10 min só
      re-tenta liberados que falharam), compartilhar, nova gravação.
   A aba "Áudios salvos" é o histórico, com (re)envio por e-mail.
   Sentinela de mudez (3 camadas): aviso ao vivo no palco quando o
   mic entrega silêncio digital, faixa vermelha na prévia quando o
   arquivo inteiro saiu mudo, e confirm() na hora de salvar.
   ============================================================ */

let _audAgendamentos = [];   // cache da busca de agendamentos
let _audClienteAlvo  = null; // agendamento escolhido (null = gravação sem cliente ainda)
let _audEscolhaPraSalvar = false; // lista aberta pelo "Salvar…": escolher já salva
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
let _audSilencioDesde = 0;   // último instante em que o mic entregou som de verdade
let _audAvisoVivo     = null; // aviso ativo no palco: 'silencio' | 'mute' | 'ended'
let _audVuCtx        = null; // canvas 2d do VU de agulha
let _audVuW          = 0;
let _audVuH          = 0;
let _audAgulhaPos    = -1;   // posição suavizada da agulha (-1 repouso .. +1 estourado)
let _audAgulhaRaf    = null;
let _audListenersOk  = false;
let _audMicDevices    = [];  // audioinputs enumerados
let _audWakeLock      = null;
let _audBeforeUnloadOn = false;
let _audPlayerAudio   = null; // <audio> escondido que toca a prévia
let _audPlayerRaf     = null;
let _audPlayerRate    = 1;
let _audPlayerSeeking = false;
let _audPlayerCtx      = null; // Web Audio da prévia (move a agulha no play)
let _audPlayerAnalyser = null;
let _audPlayerAmostra  = null; // buffer reutilizado do analyser da prévia

const _AUD_TICK = 50; // resolução (ms) do relógio de duração da gravação

// Limiares da sentinela de mudez. O ruído de fundo de um mic vivo fica
// acima de _AUD_LIMIAR_VIVO (silêncio digital = amostras cravadas no
// zero); voz de verdade passa fácil de _AUD_PICO_MUDO no arquivo.
const _AUD_LIMIAR_VIVO = 0.01;  // amplitude ao vivo abaixo disso = mic morto
const _AUD_SILENCIO_MS = 6000;  // quanto silêncio digital contínuo até acusar
const _AUD_PICO_MUDO   = 0.02;  // pico do arquivo inteiro abaixo disso = inaudível

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
  const m = String(mime || '');
  return m.includes('mpeg') ? 'mp3' : m.includes('mp4') ? 'm4a' : 'webm';
}

// Conversão pra mp3: o WhatsApp só mostra o áudio como bolha clicável se
// o codec for um que ele decodifica (mp3/AAC), e os navegadores gravam
// opus (Chrome, mesmo dentro de mp4) ou AAC (só Safari). mp3 é o único
// formato universal que dá pra gerar aqui — então tudo converge pra ele:
// a conversão começa em segundo plano assim que para de gravar, e o
// arquivo SALVO no bucket já é mp3 (e-mail e share saem prontos).
const _audMp3Cache  = new WeakMap(); // blob original → Promise<blob mp3>
const _audMp3Pronto = new WeakSet(); // blobs cuja conversão já terminou
const _audNivelCache = new WeakMap(); // blob original → { pico, fracaoComSom } medidos na conversão

function _audConverterParaMp3(blob) {
  if (_audMp3Cache.has(blob)) return _audMp3Cache.get(blob);
  const p = _audConverterParaMp3Interno(blob);
  _audMp3Cache.set(blob, p);
  p.then(() => _audMp3Pronto.add(blob), () => _audMp3Cache.delete(blob));
  return p;
}

async function _audConverterParaMp3Interno(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let buf;
  try {
    buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close();
  }

  // Downmix pra mono: leitura é voz, e mono corta o arquivo pela metade
  const canais = [];
  for (let c = 0; c < buf.numberOfChannels; c++) canais.push(buf.getChannelData(c));

  const enc = new lamejs.Mp3Encoder(1, buf.sampleRate, 128);
  const BLOCO = 1152;
  const partes = [];
  const amostras = new Int16Array(BLOCO);
  let pico = 0, comSom = 0;
  for (let i = 0, bloco = 0; i < buf.length; i += BLOCO, bloco++) {
    // Respiro a cada ~1.5s de áudio: a conversão roda em segundo plano
    // logo após parar de gravar, e não pode travar as barrinhas da prévia
    if (bloco % 64 === 63) await new Promise(r => setTimeout(r));
    const n = Math.min(BLOCO, buf.length - i);
    for (let j = 0; j < n; j++) {
      let v = 0;
      for (const canal of canais) v += canal[i + j];
      v /= canais.length;
      const abs = v < 0 ? -v : v;
      if (abs > pico) pico = abs;
      if (abs > 0.01) comSom++;
      amostras[j] = v < 0 ? Math.max(-1, v) * 0x8000 : Math.min(1, v) * 0x7FFF;
    }
    const chunk = enc.encodeBuffer(amostras.subarray(0, n));
    if (chunk.length) partes.push(chunk);
  }
  const fim = enc.flush();
  if (fim.length) partes.push(fim);

  // Já passamos por cada amostra mesmo: este nível é o veredito de mudez
  // do que REALMENTE sobe pro cliente (a prévia toca o blob original)
  const fracaoComSom = comSom / (buf.length || 1);
  _audNivelCache.set(blob, { pico, fracaoComSom });
  console.info('[áudios] nível da gravação — pico', +pico.toFixed(4), '· fração com som', +fracaoComSom.toFixed(3));

  return new Blob(partes, { type: 'audio/mpeg' });
}

// Pill fixo "toque pra enviar": quando a conversão demora, o navegador
// esquece o toque original e bloqueia o navigator.share — este botão dá
// um toque novo e compartilha na hora (mp3 já pronto no cache).
function _audMostrarPillEnviar(file, nome) {
  document.getElementById('aud-pill-enviar')?.remove();
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.id = 'aud-pill-enviar';
  pill.className = 'aud-pill-enviar';
  pill.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-compartilhar"></use></svg> Áudio pronto — <strong>toque pra enviar</strong>';
  pill.onclick = async () => {
    pill.remove();
    try {
      await navigator.share({ files: [file], title: nome });
    } catch (e) {
      if (e.name !== 'AbortError') _toastAdmin('Erro ao compartilhar: ' + e.message, 'erro');
    }
  };
  document.body.appendChild(pill);
}

// Compartilhar (ou baixar, no fallback) um blob de áudio já pronto.
async function _audCompartilharBlob(blob, mime, nomeSugestao) {
  let nome = prompt('Nome do arquivo para compartilhar:', nomeSugestao);
  if (nome === null) return; // cancelou o rename

  let blobFinal = blob, mimeFinal = mime, ext = _audExtDoMime(mime);
  if (mime !== 'audio/mpeg') {
    try {
      if (!_audMp3Pronto.has(blob)) _toastAdmin('Convertendo pra mp3…', 'info');
      blobFinal = await _audConverterParaMp3(blob);
      mimeFinal = 'audio/mpeg';
      ext = 'mp3';
    } catch (e) {
      // Sem conversão, segue com o formato original (pode ir como documento)
      console.warn('Conversão mp3 falhou, compartilhando original:', e);
    }
  }
  nome = _audSanitizarNomeArquivo(nome) + '.' + ext;

  const file = new File([blobFinal], nome, { type: mimeFinal });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nome });
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        // Conversão longa consumiu o toque que autoriza o share —
        // oferece um botão que compartilha na hora com um toque novo
        _audMostrarPillEnviar(file, nome);
      } else if (e.name !== 'AbortError') {
        _toastAdmin('Erro ao compartilhar: ' + e.message, 'erro');
      }
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
      <button type="button" class="aud-tab aud-tab--on" id="aud-tab-gravar" onclick="_audTrocarAba('gravar')"><svg class="ico" aria-hidden="true"><use href="#ico-microfone"></use></svg> Gravar</button>
      <button type="button" class="aud-tab" id="aud-tab-todos" onclick="_audTrocarAba('todos')"><svg class="ico" aria-hidden="true"><use href="#ico-fone"></use></svg> Áudios salvos</button>
      <select class="aud-mic-select" id="aud-mic-select" style="display:none;" onchange="_audEscolherMic(this.value)"></select>
    </div>

    <div id="aud-aba-gravar">
      <div class="aud-passo" id="aud-tela-escolha">
        <div class="aud-escolha-topo">
          <div class="aud-passo-titulo">Pra quem é esta leitura?</div>
          <button type="button" class="ag-btn ag-btn-outline ag-btn-sm" id="aud-btn-voltar" onclick="_audVoltarGravador()"><svg class="ico" aria-hidden="true"><use href="#ico-voltar"></use></svg> Voltar</button>
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

      <div class="aud-passo" id="aud-tela-gravar" style="display:none;">
        <div class="aud-chip" id="aud-cliente-chip"></div>
        <div class="aud-gravador">
          <div class="aud-controles" id="aud-controles"></div>
          <div class="aud-erro" id="aud-erro"></div>
        </div>
        <div class="aud-dock" id="aud-dock"></div>
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
      if (document.visibilityState === 'visible' && _audRecorder?.state === 'recording') {
        if (!_audWakeLock) _audWakeLockPedir();
        _audAudioCtx?.resume().catch(() => {}); // iOS suspende o contexto em interrupções
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
// Lista de clientes — abre pelo "Salvar para um cliente…" (aí
// escolher já salva) ou pelo chip escolher/trocar antes de gravar.
// ============================================================
function _audAbrirEscolha(praSalvar) {
  _audEscolhaPraSalvar = !!praSalvar && !!_audBlob;
  document.getElementById('aud-tela-gravar').style.display = 'none';
  const tela = document.getElementById('aud-tela-escolha');
  tela.style.display = '';
  const titulo = tela.querySelector('.aud-passo-titulo');
  if (titulo) titulo.textContent = _audEscolhaPraSalvar ? 'Salvar para quem?' : 'Pra quem é esta leitura?';
  const busca = document.getElementById('aud-busca');
  if (busca) busca.value = '';
  _audCarregarAgendamentos();
  tela.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _audEscolherCliente(ag) {
  const salvarJa = _audEscolhaPraSalvar && _audBlob;
  _audEscolhaPraSalvar = false;
  _audClienteAlvo = ag;
  _audMostrarGravar();
  if (salvarJa) _audSalvar(); // veio do "Salvar…": escolher conclui o salvar
}

function _audVoltarGravador() {
  _audMostrarGravar();
}

function _audMostrarGravar() {
  document.getElementById('aud-tela-escolha').style.display = 'none';
  document.getElementById('aud-tela-gravar').style.display = '';
  _audChipRender();
  // O canvas do VU pode ter nascido com a tela escondida (largura 0)
  if (!_audVuCtx) _audVuDesenhar(_audAgulhaPos);
  // Se já existe prévia, o botão de salvar precisa refletir o destino atual
  const acoes = document.querySelector('#aud-dock .aud-dock-acoes');
  if (acoes && _audBlob) acoes.innerHTML = _audDockAcoes();
}

// Chip no topo do palco: deixa sempre visível pra quem o áudio vai.
// A etiqueta do cassete espelha o mesmo cliente, então segue junto.
function _audChipRender() {
  _audK7Etiqueta();
  const chip = document.getElementById('aud-cliente-chip');
  if (!chip) return;
  const ag = _audClienteAlvo;
  if (!ag) {
    chip.innerHTML = `
      <span class="aud-chip-meta">Sem cliente — dá pra escolher ao salvar</span>
      <button type="button" class="aud-chip-trocar" onclick="_audIrTrocarCliente()">escolher agora</button>`;
    return;
  }
  chip.innerHTML = `
    <span><svg class="ico" aria-hidden="true"><use href="#ico-folha"></use></svg> Gravando para <span class="aud-chip-nome">${_audEsc(ag.cliente_nome)}</span></span>
    <span class="aud-chip-meta">${_audEsc(ag.tipos_leitura?.nome || 'Leitura')} · ${_audDataAgend(ag.data_agendamento)}</span>
    <button type="button" class="aud-chip-trocar" onclick="_audIrTrocarCliente()">trocar</button>`;
}

function _audIrTrocarCliente() {
  if (_audRecorder && _audRecorder.state !== 'inactive') {
    _toastAdmin('Pare a gravação antes de trocar o cliente.', 'erro');
    return;
  }
  _audAbrirEscolha();
}

function _audPrimeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || 'cliente';
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
      <span class="aud-ag-meta">${_audEsc(ag.tipos_leitura?.nome || 'Leitura')}${ag.leitura_origem_id ? ' (pergunta adicional)' : ''} · ${_audDataAgend(ag.data_agendamento)}</span>
      ${n ? `<span class="aud-ag-badges"><span class="aud-ag-badge aud-ag-badge--audios"><svg class="ico" aria-hidden="true"><use href="#ico-fone"></use></svg> ${n} áudio${n > 1 ? 's' : ''}</span></span>` : ''}`;
    item.addEventListener('click', () => _audEscolherCliente(ag));
    lista.appendChild(item);
  });
}

// ============================================================
// Passo 1 — gravador (mesa de fita: GRAVAR gira, PARAR → preview)
// ============================================================
function _audSetErro(txt) {
  const el = document.getElementById('aud-erro');
  if (el) el.textContent = txt || '';
}

// ============================================================
// Mesa de fita — o palco é um cassete: etiqueta de papel com o
// nome do cliente, carretéis que giram, contador mecânico, VU de
// agulha e teclas mecânicas. A agulha é o rosto da sentinela:
// segue o mic na gravação e o player na prévia; mic morto =
// agulha deitada no zero + led SEM SOM piscando.
// ============================================================
const _AUD_K7_ESTADOS = {
  pronto:   'pronta pra gravar',
  gravando: '● gravando…',
  previa:   'gravada — confere e salva',
  salvo:    'salva ✓ — pronta pra entrega',
};

function _audK7Html(modo) {
  const teclas = modo === 'pronto'
    ? '<button type="button" class="aud-k7-tecla aud-k7-tecla--rec" onclick="_audComecarGravacao()"><b>●</b> GRAVAR</button>'
    : modo === 'gravando'
      ? '<button type="button" class="aud-k7-tecla" onclick="_audPararGravacao()"><b>■</b> PARAR</button>'
      : modo === 'previa'
        ? '<button type="button" class="aud-k7-tecla" id="aud-k7-play" onclick="_audPlayerTogglePlay()"><b>▶</b> TOCAR</button>'
        : '';
  return `
    <div class="aud-k7-palco">
      <div class="aud-k7${modo === 'gravando' ? ' aud-k7--girando' : ''}" id="aud-k7"${modo === 'previa' ? ' onclick="_audPlayerTogglePlay()" title="Tocar / pausar"' : ''}>
        <i class="aud-k7-paraf aud-k7-paraf--bl"></i><i class="aud-k7-paraf aud-k7-paraf--br"></i>
        <div class="aud-k7-etiqueta">
          <div class="aud-k7-nome" id="aud-k7-nome"></div>
          <div class="aud-k7-sub"><span id="aud-k7-estado"></span><span class="aud-k7-lado">LADO A</span></div>
        </div>
        <div class="aud-k7-janela">
          <div class="aud-k7-carretel"><div class="aud-k7-disco" id="aud-k7-disco-e"></div><div class="aud-k7-cubo"></div></div>
          <div class="aud-k7-fita"></div>
          <div class="aud-k7-carretel"><div class="aud-k7-disco" id="aud-k7-disco-d"></div><div class="aud-k7-cubo"></div></div>
        </div>
        <div class="aud-k7-odo" id="aud-k7-odo"><span>0</span><span>0</span><span class="aud-k7-odo-sep">:</span><span>0</span><span>0</span></div>
      </div>
      ${modo === 'salvo' ? '' : `
      <div class="aud-vu">
        <div class="aud-vu-caixa"><canvas id="aud-vu-canvas"></canvas></div>
        <div class="aud-vu-legenda"><span>nível da voz</span><span class="aud-vu-led" id="aud-vu-led">sem som</span></div>
      </div>
      <div class="aud-k7-teclas">${teclas}</div>`}
    </div>`;
}

function _audK7Montar(modo) {
  _audBotoes(_audK7Html(modo));
  _audK7Etiqueta();
  const estado = document.getElementById('aud-k7-estado');
  if (estado) estado.textContent = _AUD_K7_ESTADOS[modo] || '';
  _audK7Odo(_audMmSs(_audMs / 1000));
  _audK7Discos(modo === 'pronto' ? 0 : Math.min(1, _audMs / 600000));
  _audVuCtx = null; // canvas novo — re-mede no próximo desenho
  _audAgulhaPos = -1;
  if (modo !== 'salvo') _audVuDesenhar(_audAgulhaPos);
}

// Etiqueta escrita à mão: leitura + primeiro nome (quem resolve
// escolher/trocar o cliente continua sendo o chip lá em cima)
function _audK7Etiqueta() {
  const nome = document.getElementById('aud-k7-nome');
  if (!nome) return;
  const ag = _audClienteAlvo;
  nome.innerHTML = ag
    ? `${_audEsc(ag.tipos_leitura?.nome || 'Leitura')} — <em>${_audEsc(_audPrimeiroNome(ag.cliente_nome))}</em>`
    : 'Leitura — <em>sem cliente ainda</em>';
}

function _audK7Odo(txt) {
  const odo = document.getElementById('aud-k7-odo');
  if (odo) [...odo.children].forEach((s, i) => { s.textContent = txt[i] || ''; });
}

// Fita passando: o disco esquerdo esvazia e o direito enche (0..1
// ≈ 10 min de leitura; passou disso fica cheio e segue gravando)
function _audK7Discos(frac) {
  const f = Math.min(1, Math.max(0, frac));
  const e = document.getElementById('aud-k7-disco-e');
  const d = document.getElementById('aud-k7-disco-d');
  if (e) e.style.width = e.style.height = (46 - f * 24).toFixed(1) + 'px';
  if (d) d.style.width = d.style.height = (22 + f * 24).toFixed(1) + 'px';
}

function _audK7Girar(girando) {
  document.getElementById('aud-k7')?.classList.toggle('aud-k7--girando', !!girando);
}

function _audK7TeclaPlay(tocando) {
  const t = document.getElementById('aud-k7-play');
  if (!t) return;
  t.innerHTML = tocando ? '<b>❚❚</b> PAUSA' : '<b>▶</b> TOCAR';
  t.classList.toggle('aud-k7-tecla--apertada', !!tocando);
}

// ---------- VU de agulha (canvas na caixa de papel) ----------
function _audVuPrep() {
  const cv = document.getElementById('aud-vu-canvas');
  if (!cv) { _audVuCtx = null; return false; }
  const rect = cv.getBoundingClientRect();
  if (!rect.width) { _audVuCtx = null; return false; }
  const dpr = window.devicePixelRatio || 1;
  cv.width = rect.width * dpr;
  cv.height = rect.height * dpr;
  _audVuCtx = cv.getContext('2d');
  _audVuCtx.scale(dpr, dpr);
  _audVuW = rect.width;
  _audVuH = rect.height;
  return true;
}

function _audVuDesenhar(pos) {
  if (!_audVuCtx && !_audVuPrep()) return;
  const g = _audVuCtx, W = _audVuW, H = _audVuH;
  g.clearRect(0, 0, W, H);
  // pivô abaixo da caixa (fica escondido): o arco sobra na janela
  const cx = W / 2, cy = H + 26, R = H + 8;
  for (let i = 0; i <= 20; i++) {
    const a = (-35 + i * 70 / 20) * Math.PI / 180;
    g.strokeStyle = i > 15 ? '#A6432D' : '#6B5526'; // zona vermelha no fim
    g.lineWidth = i % 5 === 0 ? 2 : 1;
    const r1 = R - (i % 5 === 0 ? 14 : 9);
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
    g.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
    g.stroke();
  }
  g.fillStyle = '#6B5526';
  g.font = '700 9px Figtree, sans-serif';
  g.fillText('0', cx - R * 0.72, cy - R * 0.52);
  g.fillText('+3', cx + R * 0.62, cy - R * 0.52);
  const aA = (-35 + ((pos + 1) / 2) * 70) * Math.PI / 180;
  g.strokeStyle = '#2E2712';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.sin(aA) * (R - 4), cy - Math.cos(aA) * (R - 4));
  g.stroke();
  g.fillStyle = '#2E2712';
  g.beginPath();
  g.arc(cx, cy, 5, 0, 7);
  g.fill();
}

// Loop da agulha: gravando segue o mic, prévia tocando segue o
// player; fora disso assenta no repouso e o loop dorme sozinho.
function _audAgulhaLoop() {
  const gravando = _audRecorder?.state === 'recording';
  const tocando = _audPlayerAudio && !_audPlayerAudio.paused && !_audPlayerAudio.ended;
  const amp = gravando ? _audAmplitudeAtual() : tocando ? _audPlayerAmplitude() : 0;
  const alvo = amp * 2 - 1;
  _audAgulhaPos += (alvo - _audAgulhaPos) * (alvo > _audAgulhaPos ? 0.4 : 0.12);
  _audVuDesenhar(_audAgulhaPos);
  document.getElementById('aud-vu-led')?.classList.toggle('aud-vu-led--on',
    _audAvisoVivo === 'silencio' || _audAvisoVivo === 'mute');
  const ativo = gravando || tocando || Math.abs(alvo - _audAgulhaPos) > 0.01;
  _audAgulhaRaf = ativo ? requestAnimationFrame(_audAgulhaLoop) : null;
}

function _audAgulhaAcordar() {
  if (!_audAgulhaRaf) _audAgulhaRaf = requestAnimationFrame(_audAgulhaLoop);
}

function _audAgulhaParar() {
  if (_audAgulhaRaf) { cancelAnimationFrame(_audAgulhaRaf); _audAgulhaRaf = null; }
  _audAgulhaPos = -1;
}

function _audPlayerAmplitude() {
  if (!_audPlayerAnalyser) return 0;
  _audPlayerAnalyser.getByteTimeDomainData(_audPlayerAmostra);
  let pico = 0;
  for (let i = 0; i < _audPlayerAmostra.length; i++) {
    const v = Math.abs(_audPlayerAmostra[i] - 128) / 128;
    if (v > pico) pico = v;
  }
  return Math.min(1, pico * 1.6);
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
// Sentinela de mudez — já saiu daqui leitura de 10 min muda sem
// ninguém perceber. A agulha do VU mostra o nível, mas quem acusa
// é a sentinela: mic mudo no sistema, dispositivo errado ou outro
// app tomando o mic entregam silêncio que o MediaRecorder grava
// sem reclamar.
// ============================================================
function _audAvisar(tipo, msg) {
  if (_audAvisoVivo === tipo) return;
  _audAvisoVivo = tipo;
  _audSetErro(msg);
  navigator.vibrate?.([120, 60, 120]); // pra quem grava olhando as cartas, não a tela
}

function _audAvisoLimpar() {
  if (!_audAvisoVivo) return;
  _audAvisoVivo = null;
  _audSetErro('');
}

function _audVigiarSilencio(agora) {
  const trilha = _audStream?.getAudioTracks()[0];
  // Contexto suspenso congela o analyser no centro (leria como mudez):
  // sem monitor confiável não se acusa ao vivo — a prévia condena depois
  const monitor = _audAnalyser && _audAudioCtx?.state === 'running';
  if (monitor && !trilha?.muted && _audAmplitudeAtual() > _AUD_LIMIAR_VIVO) {
    _audSilencioDesde = agora;
    _audAvisoLimpar();
    return;
  }
  if (!monitor && !trilha?.muted) { _audSilencioDesde = agora; return; }
  if (!_audAvisoVivo && agora - _audSilencioDesde > _AUD_SILENCIO_MS) {
    _audAvisar('silencio', '⚠️ Nenhum som captado há vários segundos — o áudio pode estar saindo mudo. Confere se o microfone não está silenciado.');
  }
}

function _audPareceMudo(blob) {
  const nivel = blob && _audNivelCache.get(blob);
  return !!nivel && nivel.pico < _AUD_PICO_MUDO;
}

// Faixa vermelha no painel da prévia: a conversão mediu o arquivo
// inteiro e não achou som
function _audAvisarPreviaMuda() {
  const painel = document.querySelector('#aud-dock .aud-dock-painel');
  if (!painel || document.getElementById('aud-aviso-mudo')) return;
  const aviso = document.createElement('div');
  aviso.id = 'aud-aviso-mudo';
  aviso.className = 'aud-aviso-mudo';
  aviso.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-alerta"></use></svg><div><strong>Este áudio saiu mudo.</strong> O microfone não captou som do início ao fim — toca a prévia pra conferir e, se estiver vazio, regrava.</div>';
  painel.prepend(aviso);
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

function _audResetGravador() {
  document.getElementById('aud-pill-enviar')?.remove(); // pill apontaria pra áudio morto
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

  const dock = document.getElementById('aud-dock');
  if (dock) dock.innerHTML = '';
  _audAvisoVivo = null;
  _audSetErro('');
  _audAgulhaParar();
  _audK7Montar('pronto');
  _audAtualizarBeforeUnload();

  // Gravação primeiro: a entrada é sempre o cassete; cliente se escolhe
  // no chip ou na hora de salvar
  _audEscolhaPraSalvar = false;
  _audMostrarGravar();
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

  // A gravação é só matéria-prima: o que vai pro bucket é o mp3 convertido.
  // mp4/webm aqui é o que o navegador conseguir gravar; a ordem só importa
  // no fallback raro de a conversão falhar (mp4 toca nativo em iPhone).
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

  // O sistema pode calar ou tomar o mic no meio da leitura (ligação,
  // outro app, fone que desconecta) — o MediaRecorder segue gravando
  // silêncio sem reclamar, então quem denuncia é a gente
  const trilha = _audStream.getAudioTracks()[0];
  trilha?.addEventListener('mute', () => {
    if (_audRecorder?.state === 'recording') _audAvisar('mute', '⚠️ O sistema silenciou o microfone (outro app pegou ele?) — o áudio está saindo mudo agora.');
  });
  trilha?.addEventListener('unmute', () => {
    if (_audAvisoVivo === 'mute') _audAvisoLimpar();
  });
  trilha?.addEventListener('ended', () => {
    if (_audRecorder && _audRecorder.state !== 'inactive') {
      _audAvisar('ended', '⚠️ O microfone parou de enviar áudio (desconectou?). A gravação foi encerrada com o que já tinha.');
      _audPararGravacao(); // garante o onstop — nem todo navegador para sozinho
    }
  });

  // Analyser pra agulha do VU e pra sentinela de mudez; se falhar, grava
  // mesmo assim (agulha parada), mas avisa que ficou sem monitor de nível
  try {
    _audAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    _audAnalyser = _audAudioCtx.createAnalyser();
    _audAnalyser.fftSize = 512;
    _audAudioCtx.createMediaStreamSource(_audStream).connect(_audAnalyser);
    _audAmostra = new Uint8Array(_audAnalyser.fftSize);
    _audAudioCtx.resume().catch(() => {});
  } catch (_) {
    _audFecharAudioCtx();
    _toastAdmin('Sem monitor de nível do microfone neste navegador — ouça a prévia antes de enviar.', 'info');
  }

  _audRecorder = new MediaRecorder(_audStream, { mimeType: _audMime });
  _audRecorder.ondataavailable = e => { if (e.data?.size) _audChunks.push(e.data); };
  _audRecorder.onstop = () => {
    if (_audTimerInt) { clearInterval(_audTimerInt); _audTimerInt = null; }
    _audStream?.getTracks().forEach(t => t.stop());
    _audStream = null;
    _audFecharAudioCtx();
    _audWakeLockLiberar();
    _audBlob = new Blob(_audChunks, { type: _audMime.split(';')[0] });
    if (!_audBlob.size) {
      // Navegador não entregou nenhum chunk: melhor acusar agora do que
      // mostrar uma prévia que não toca
      _audResetGravador();
      _audSetErro('A gravação saiu vazia — o navegador não entregou nenhum áudio. Tenta de novo.');
      return;
    }
    if (_audAvisoVivo !== 'ended') _audAvisoLimpar(); // aviso ao vivo já cumpriu o papel
    _audMostrarPreview();
    // Já converte pra mp3 em segundo plano: quando salvar ou compartilhar
    // (depois de ouvir a prévia), o arquivo estará pronto e ninguém espera.
    // A conversão também mede o nível — arquivo inteiro mudo ganha a faixa.
    const gravado = _audBlob;
    _audConverterParaMp3(gravado)
      .then(() => { if (gravado === _audBlob && _audPareceMudo(gravado)) _audAvisarPreviaMuda(); })
      .catch(() => {});
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
  // Chrome).
  let ultimo = performance.now();
  _audSilencioDesde = ultimo;
  _audTimerInt = setInterval(() => {
    const agora = performance.now();
    if (_audRecorder?.state === 'recording') {
      _audMs += agora - ultimo;
      _audVigiarSilencio(agora); // no setInterval, não no rAF: segue vivo com a tela apagada
      _audK7Odo(_audMmSs(_audMs / 1000));
      _audK7Discos(_audMs / 600000);
    }
    ultimo = agora;
  }, _AUD_TICK);

  _audK7Montar('gravando');
  _audAgulhaAcordar();
}

function _audPararGravacao() {
  if (_audRecorder && _audRecorder.state !== 'inactive') _audRecorder.stop();
}

// Ações do dock da prévia. O salvar é o herói e diz o destino no
// rótulo; sem cliente, abre a lista — e escolher já salva.
function _audDockAcoes() {
  const alvo = _audClienteAlvo;
  const salvar = alvo
    ? `<button type="button" class="aud-dock-btn aud-dock-btn--enviar" id="aud-btn-salvar" onclick="_audSalvar()"><svg class="ico" aria-hidden="true"><use href="#ico-guardar"></use></svg> Salvar para ${_audEsc(_audPrimeiroNome(alvo.cliente_nome))}</button>`
    : `<button type="button" class="aud-dock-btn aud-dock-btn--enviar" id="aud-btn-salvar" onclick="_audAbrirEscolha(true)"><svg class="ico" aria-hidden="true"><use href="#ico-guardar"></use></svg> Salvar para um cliente…</button>`;
  return `${salvar}
        <button type="button" class="aud-dock-btn" onclick="_audCompartilharPreview()"><svg class="ico" aria-hidden="true"><use href="#ico-compartilhar"></use></svg> Compartilhar</button>
        <button type="button" class="aud-dock-btn" onclick="_audResetGravador(); _audComecarGravacao()"><svg class="ico" aria-hidden="true"><use href="#ico-atualizar"></use></svg> Regravar</button>
        <button type="button" class="aud-dock-btn aud-dock-btn--descartar" onclick="_audResetGravador()"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg> Descartar</button>`;
}

// Play e pause são o mesmo botão: troca o símbolo dentro do <use>
// e o rótulo de leitor de tela junto.
function _audPlayPintar(btn, tocando) {
  if (!btn) return;
  btn.querySelector('use')?.setAttribute('href', tocando ? '#ico-pause' : '#ico-play');
  btn.title = tocando ? 'Pausar' : 'Tocar';
  btn.setAttribute('aria-label', btn.title);
}

function _audMostrarPreview() {
  // O cassete rebobina e vira o player: tecla TOCAR (e o próprio
  // cassete) dão play; os controles finos ficam no dock embaixo
  _audK7Montar('previa');
  const k7 = document.getElementById('aud-k7');
  if (k7) {
    k7.classList.add('aud-k7--rebobina');
    setTimeout(() => k7.classList.remove('aud-k7--rebobina'), 900);
  }
  _audK7Discos(0);    // fita de volta pro começo…
  _audK7Odo('00:00'); // …e o contador junto (agora conta a reprodução)

  _audPreviewUrl = URL.createObjectURL(_audBlob);
  _audPlayerRate = 1;

  // Painel de controle no fim da página: reprodução + ações juntas,
  // longe do palco (que fica só com o visualizador)
  document.getElementById('aud-dock').innerHTML = `
    <div class="aud-dock-painel">
      <div class="aud-dock-titulo">Gravação pronta</div>
      <div class="aud-dock-player">
        <button type="button" class="aud-dock-play" id="aud-player-play" title="Tocar" aria-label="Tocar"><svg class="ico" aria-hidden="true"><use href="#ico-play"></use></svg></button>
        <div class="aud-dock-progresso" id="aud-progresso" title="Ir para um ponto do áudio">
          <div class="aud-dock-progresso-feito" id="aud-progresso-feito"></div>
        </div>
        <button type="button" class="aud-dock-vel" id="aud-player-vel" title="Velocidade">1x</button>
        <span class="aud-dock-tempo" id="aud-player-tempo">00:00 / ${_audMmSs(_audMs / 1000)}</span>
      </div>
      <div class="aud-dock-acoes">${_audDockAcoes()}</div>
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
    _audPlayPintar(btnPlay, true);
    _audPlayerLigarAnalyser();
    _audPlayerCtx?.resume().catch(() => {});
    _audK7Girar(true);
    _audK7TeclaPlay(true);
    _audAgulhaAcordar();
    _audPlayerLoop();
  });
  _audPlayerAudio.addEventListener('pause', () => {
    _audPlayPintar(btnPlay, false);
    _audPlayerAtualizarTempo();
    _audK7Girar(false);
    _audK7TeclaPlay(false);
    _audAgulhaAcordar(); // deixa a agulha assentar de volta no repouso
  });

  btnPlay.addEventListener('click', _audPlayerTogglePlay);
  document.getElementById('aud-player-vel').addEventListener('click', _audPlayerCicloVelocidade);

  // Seek: clicar/arrastar na linha de progresso do painel
  const prog = document.getElementById('aud-progresso');
  prog.addEventListener('pointerdown', e => {
    _audPlayerSeeking = true;
    prog.setPointerCapture(e.pointerId);
    _audPlayerSeekPara(e.clientX);
  });
  prog.addEventListener('pointermove', e => { if (_audPlayerSeeking) _audPlayerSeekPara(e.clientX); });
  prog.addEventListener('pointerup', () => { _audPlayerSeeking = false; });

  _audAtualizarBeforeUnload();
}

// Analyser ligado só no 1º play (gesto do usuário → contexto liberado).
// createMediaElementSource captura o <audio> pra sempre, por isso o
// roteamento até o destination acontece logo em seguida.
function _audPlayerLigarAnalyser() {
  if (_audPlayerCtx || !_audPlayerAudio) return;
  let ctx = null;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;
    const fonte = ctx.createMediaElementSource(_audPlayerAudio);
    fonte.connect(analyser);
    analyser.connect(ctx.destination);
    _audPlayerCtx = ctx;
    _audPlayerAnalyser = analyser;
    _audPlayerAmostra = new Uint8Array(analyser.fftSize);
  } catch (_) {
    // sem análise, a prévia toca normal e a agulha fica no repouso
    if (ctx) ctx.close().catch(() => {});
    _audPlayerAnalyser = null;
    _audPlayerAmostra = null;
  }
}

// ============================================================
// Player da prévia — os controles moram no painel de controle:
// tocar/pausar, linha de progresso arrastável (seek), velocidade
// e tempo. O desenho fica com as barrinhas no palco.
// ============================================================
function _audPlayerAtualizarTempo() {
  if (!_audPlayerAudio || !_audMs) return;
  const el = document.getElementById('aud-player-tempo');
  if (el) el.textContent = `${_audMmSs(_audPlayerAudio.currentTime)} / ${_audMmSs(_audMs / 1000)}`;
  const frac = Math.min(1, Math.max(0, _audPlayerAudio.currentTime / (_audMs / 1000)));
  const feito = document.getElementById('aud-progresso-feito');
  if (feito) feito.style.width = (frac * 100).toFixed(2) + '%';
  // o cassete acompanha a reprodução: contador e fita na posição atual
  _audK7Odo(_audMmSs(_audPlayerAudio.currentTime));
  _audK7Discos(frac * Math.min(1, _audMs / 600000));
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
  const trilha = document.getElementById('aud-progresso');
  if (!trilha || !_audPlayerAudio || !_audMs) return;
  const rect = trilha.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  _audPlayerAudio.currentTime = frac * (_audMs / 1000);
  _audPlayerAtualizarTempo();
}

function _audPlayerLimpar() {
  if (_audPlayerRaf) { cancelAnimationFrame(_audPlayerRaf); _audPlayerRaf = null; }
  _audAgulhaParar();
  if (_audPlayerAudio) { _audPlayerAudio.pause(); _audPlayerAudio.src = ''; _audPlayerAudio = null; }
  if (_audPlayerCtx) { _audPlayerCtx.close().catch(() => {}); _audPlayerCtx = null; }
  _audPlayerAnalyser = null;
  _audPlayerAmostra = null;
  _audPlayerSeeking = false;
}

// Botão "Compartilhar" no preview — com cliente escolhido a sugestão
// de nome já vem completa; solta, leva só a data de hoje
async function _audCompartilharPreview() {
  if (!_audBlob) return;
  const ag = _audClienteAlvo;
  let sugestao;
  if (ag) {
    sugestao = _audNomeSugerido(ag.cliente_nome, ag.tipos_leitura?.nome, ag.data_agendamento);
  } else {
    const hoje = new Date();
    const ddmm = `${String(hoje.getDate()).padStart(2, '0')}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    sugestao = _audSanitizarNomeArquivo(`Leitura - ${ddmm}`);
  }
  await _audCompartilharBlob(_audBlob, _audMime.split(';')[0], sugestao);
}

// ============================================================
// Salvar pro cliente do chip: upload no bucket privado + insert.
// NÃO envia e-mail — o dock vira o painel de entrega com o botão.
// ============================================================
async function _audSalvar() {
  const ag = _audClienteAlvo;
  if (!ag || !_audBlob || _audSalvando) return;
  _audSalvando = true;

  const btn = document.getElementById('aud-btn-salvar');
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-ampulheta"></use></svg> Salvando…'; }

  // Sobe o mp3, não a gravação bruta: o arquivo salvo já serve pra e-mail
  // e WhatsApp sem ninguém ver conversão. Ela roda desde que parou de
  // gravar — aqui normalmente só pega o resultado pronto. Se tiver
  // falhado, sobe o original mesmo (o share ainda tenta converter na hora).
  let blobUp = _audBlob, contentType = _audMime.split(';')[0];
  try {
    blobUp = await _audConverterParaMp3(_audBlob);
    contentType = 'audio/mpeg';
  } catch (e) {
    console.warn('Conversão mp3 falhou, salvando original:', e);
  }

  // Última cancela da sentinela: salvar leitura muda é perder a leitura
  // (o cliente recebe um arquivo vazio e só se descobre dias depois)
  if (_audPareceMudo(_audBlob) && !confirm('Este áudio parece MUDO do início ao fim — o microfone não captou som. Salvar mesmo assim?')) {
    _audSalvando = false;
    const acoes = document.querySelector('#aud-dock .aud-dock-acoes');
    if (acoes) acoes.innerHTML = _audDockAcoes();
    return;
  }
  const ext  = _audExtDoMime(contentType);
  const path = `agendamento-${ag.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const seg  = Math.max(1, Math.round(_audMs / 1000));

  const { error: upErr } = await supabase.storage
    .from('audios')
    .upload(path, blobUp, { contentType });

  if (upErr) { _audSalvarFalhou('Falha no upload: ' + upErr.message); return; }

  const { data: novo, error: dbErr } = await supabase.from('audios_cliente').insert({
    agendamento_id: ag.id,
    storage_path: path,
    duracao_segundos: seg,
    tamanho_bytes: blobUp.size,
    mime: contentType,
  }).select('id').single();

  if (dbErr) {
    await supabase.storage.from('audios').remove([path]); // não deixar arquivo órfão
    _audSalvarFalhou('Erro ao salvar: ' + dbErr.message);
    return;
  }

  _audContagem[ag.id] = (_audContagem[ag.id] || 0) + 1;
  _audSalvando = false;
  _audMostrarPosSalvar(novo.id, ag, blobUp, contentType);
}

function _audSalvarFalhou(msg) {
  _audSalvando = false;
  _toastAdmin(msg, 'erro');
  const acoes = document.querySelector('#aud-dock .aud-dock-acoes');
  if (acoes) acoes.innerHTML = _audDockAcoes(); // reativa os botões pra tentar de novo
}

// ============================================================
// Painel de entrega — aparece no lugar do dock assim que salva.
// O áudio já está seguro no servidor: o blob local vive só pra
// compartilhar, e fechar a página não perde nada.
// ============================================================
function _audMostrarPosSalvar(audioId, ag, blob, mime) {
  _audPlayerLimpar();
  _audK7Montar('salvo'); // o cassete fica de lembrança; a entrega mora no dock
  if (_audPreviewUrl) { URL.revokeObjectURL(_audPreviewUrl); _audPreviewUrl = null; }
  _audBlob = null;
  _audAtualizarBeforeUnload();
  const chip = document.getElementById('aud-cliente-chip');
  if (chip) chip.innerHTML = '';

  const audioRef = { id: audioId, enviado_email_em: null, entregue_em: null, quicou_em: null };
  document.getElementById('aud-dock').innerHTML = `
    <div class="aud-dock-painel">
      <div class="aud-dock-titulo"><svg class="ico" aria-hidden="true"><use href="#ico-check"></use></svg> Salvo para ${_audEsc(_audPrimeiroNome(ag.cliente_nome))}</div>
      <div class="aud-dock-acoes" style="grid-template-columns:repeat(2,1fr);">
        <button type="button" class="aud-dock-btn aud-dock-btn--enviar" id="aud-pos-email"><svg class="ico" aria-hidden="true"><use href="#ico-envelope"></use></svg> Enviar por e-mail agora</button>
        <button type="button" class="aud-dock-btn" id="aud-pos-share"><svg class="ico" aria-hidden="true"><use href="#ico-compartilhar"></use></svg> Compartilhar</button>
        <button type="button" class="aud-dock-btn" id="aud-pos-nova"><svg class="ico" aria-hidden="true"><use href="#ico-microfone"></use></svg> Nova gravação</button>
      </div>
    </div>`;

  document.getElementById('aud-pos-email').addEventListener('click', async ev => {
    const b = ev.currentTarget;
    if (audioRef.enviado_email_em &&
        !confirm(`Reenviar o e-mail para ${ag.cliente_nome}?`)) return;
    b.disabled = true;
    b.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-ampulheta"></use></svg> Enviando…';
    const r = await _audDispararEmail(audioRef);
    b.disabled = false;
    b.innerHTML = r === 'enviado'
      ? '<svg class="ico" aria-hidden="true"><use href="#ico-check"></use></svg> Enviado — reenviar'
      : '<svg class="ico" aria-hidden="true"><use href="#ico-envelope"></use></svg> Enviar por e-mail agora';
  });

  document.getElementById('aud-pos-share').addEventListener('click', () =>
    _audCompartilharBlob(blob, mime,
      _audNomeSugerido(ag.cliente_nome, ag.tipos_leitura?.nome, ag.data_agendamento)));

  document.getElementById('aud-pos-nova').addEventListener('click', () => {
    _audClienteAlvo = null;   // próxima leitura recomeça no cassete, sem cliente
    _audResetGravador();
  });
}

// ============================================================
// Disparo do e-mail (único gatilho de envio; salvar não envia).
// Libera o áudio (email_liberado_em) e chama a edge na hora; se a
// chamada falhar, o cron re-tenta o liberado em até 10 min.
// Muda audioRef no lugar. Retorna 'enviado' | 'pendente' | 'erro'.
// ============================================================
async function _audDispararEmail(audioRef) {
  // entregue/quicou são o veredito do envio anterior: zeram junto, senão
  // o selo diria "entregue" enquanto o reenvio ainda está na fila.
  const { error: upErr } = await supabase.from('audios_cliente')
    .update({
      email_liberado_em: new Date().toISOString(),
      enviado_email_em: null,
      entregue_em: null,
      quicou_em: null,
    })
    .eq('id', audioRef.id);
  if (upErr) {
    _toastAdmin('Não deu pra liberar o envio: ' + upErr.message, 'erro');
    return 'erro';
  }
  audioRef.enviado_email_em = null;
  audioRef.entregue_em = null;
  audioRef.quicou_em = null;
  audioRef.email_liberado_em = new Date().toISOString();

  const { data, error: fnErr } = await supabase.functions.invoke('audio-email', {
    body: { audio_id: audioRef.id },
  });
  if (fnErr) {
    _toastAdmin('E-mail não saiu agora — reenvio automático em até 10 min.', 'erro');
    return 'pendente';
  }
  if (data?.enviados >= 1) {
    audioRef.enviado_email_em = new Date().toISOString();
    _toastAdmin('Leitura enviada pro e-mail do cliente.', 'ok');
    return 'enviado';
  }
  // liberado mas pulado: falta e-mail no pedido ou pagamento confirmado
  _toastAdmin('Não enviado: pedido sem e-mail ou não pago. O cron tenta de novo a cada 10 min.', 'erro');
  return 'pendente';
}

// Selo colado no envelope. Enviado ≠ entregue: "enviado" é só o Resend
// ter aceitado o pedido de envio. Quem confirma que chegou — ou que
// quicou — é o aviso assinado que o webhook guarda em email_eventos.
function _audEmailSelo(a) {
  if (a.quicou_em) return {
    ico: 'ico-alerta', cls: ' aud-item-email-quicou',
    titulo: `NÃO chegou — quicou em ${_audDataBR(a.quicou_em)}; confira o e-mail do cliente`,
  };
  if (a.entregue_em) return {
    ico: 'ico-check-circulo', cls: ' aud-item-email-entregue',
    titulo: `Entregue em ${_audDataBR(a.entregue_em)}`,
  };
  if (a.enviado_email_em) return {
    ico: 'ico-check', cls: '',
    titulo: `Enviado em ${_audDataBR(a.enviado_email_em)} — aguardando confirmação de entrega`,
  };
  return null;
}

function _audEmailBtnPintar(btn, a) {
  if (!btn) return;
  const selo = _audEmailSelo(a);
  btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-envelope"></use></svg>' +
    (selo ? `<svg class="ico aud-item-email-ok${selo.cls}" aria-hidden="true"><use href="#${selo.ico}"></use></svg>` : '');
  btn.title = selo ? `${selo.titulo} · tocar reenvia` : 'Enviar por e-mail';
  btn.setAttribute('aria-label', btn.title);
}

// A confirmação de entrega chega segundos depois, pelo webhook. Uma
// espiada única evita ter que sair e voltar na aba pra ver o resultado.
function _audEspiarEntrega(a, btn) {
  setTimeout(async () => {
    if (!btn.isConnected) return;
    const { data } = await supabase.from('audios_cliente')
      .select('enviado_email_em, entregue_em, quicou_em').eq('id', a.id).maybeSingle();
    if (!data) return;
    Object.assign(a, data);
    _audEmailBtnPintar(btn, a);
  }, 6000);
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
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-play"><svg class="ico" aria-hidden="true"><use href="#ico-play"></use></svg> Ouvir</button>
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-email"></button>
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-share" title="Compartilhar" aria-label="Compartilhar"><svg class="ico" aria-hidden="true"><use href="#ico-compartilhar"></use></svg></button>
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-del" style="color:var(--t-danger)" title="Apagar áudio" aria-label="Apagar áudio"><svg class="ico" aria-hidden="true"><use href="#ico-lixeira"></use></svg></button>
    </div>`;

  // o envelope dispara (ou reenvia) o e-mail com a leitura
  const btnEmail = item.querySelector('.aud-item-email');
  _audEmailBtnPintar(btnEmail, a);
  btnEmail.addEventListener('click', async () => {
    const nome = a.agendamentos?.cliente_nome || 'o cliente';
    if (!confirm(
      a.quicou_em
        ? `Este e-mail QUICOU em ${_audDataBR(a.quicou_em)} — não chegou. Tentar de novo para ${nome}?`
        : a.entregue_em
          ? `Já entregue em ${_audDataBR(a.entregue_em)}. Reenviar para ${nome}?`
          : a.enviado_email_em
            ? `E-mail já enviado em ${_audDataBR(a.enviado_email_em)}. Reenviar para ${nome}?`
            : `Enviar este áudio por e-mail para ${nome}?`)) return;
    btnEmail.disabled = true;
    btnEmail.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-ampulheta"></use></svg>';
    const r = await _audDispararEmail(a);
    btnEmail.disabled = false;
    _audEmailBtnPintar(btnEmail, a);
    if (r === 'enviado') _audEspiarEntrega(a, btnEmail);
  });

  // Player lazy: signed URL só quando pedir pra ouvir
  item.querySelector('.aud-item-play').addEventListener('click', async ev => {
    const b = ev.currentTarget;
    b.disabled = true;
    const { data: s, error: e } = await supabase.storage
      .from('audios')
      .createSignedUrl(a.storage_path, 3600);
    if (e || !s?.signedUrl) {
      b.disabled = false;
      _toastAdmin('Não deu pra abrir o áudio: ' + (e?.message || 'tente de novo'), 'erro');
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
    const original = b.innerHTML;   // é só o ícone: textContent devolveria vazio
    b.disabled = true;
    b.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-ampulheta"></use></svg>';
    try {
      const { data: s, error: e } = await supabase.storage
        .from('audios')
        .createSignedUrl(a.storage_path, 3600);
      if (e || !s?.signedUrl) {
        _toastAdmin('Não deu pra baixar o áudio: ' + (e?.message || 'tente de novo'), 'erro');
        return;
      }
      const resp = await fetch(s.signedUrl);
      const blob = await resp.blob();
      await _audCompartilharBlob(blob, a.mime || blob.type, opts.nomeSugestao || 'Áudio');
    } catch (err) {
      _toastAdmin('Erro ao preparar o compartilhamento: ' + err.message, 'erro');
    } finally {
      b.disabled = false;
      b.innerHTML = original;
    }
  });

  item.querySelector('.aud-item-del').addEventListener('click', async () => {
    if (!confirm('Apagar este áudio? Se o e-mail ainda não saiu, ele não será enviado.')) return;
    // Linha primeiro (é a fonte de verdade pro cliente); órfão no bucket
    // privado é inofensivo se o remove falhar.
    const { error: e } = await supabase.from('audios_cliente').delete().eq('id', a.id);
    if (e) { _toastAdmin(e.message, 'erro'); return; }
    const { error: eSt } = await supabase.storage.from('audios').remove([a.storage_path]);
    if (eSt) console.warn('arquivo órfão no bucket audios:', a.storage_path, eSt);
    if (_audContagem[a.agendamento_id]) _audContagem[a.agendamento_id]--;
    _audTodos = _audTodos.filter(t => t.id !== a.id);
    item.remove();
    _toastAdmin('Áudio apagado.', 'ok');
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
window._audIrTrocarCliente = _audIrTrocarCliente;
window._audSalvar = _audSalvar;
window._audTrocarAba = _audTrocarAba;
window._audFiltroStatus = _audFiltroStatus;
window._audEscolherMic = _audEscolherMic;
window._audCompartilharPreview = _audCompartilharPreview;
