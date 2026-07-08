/* ============================================================
   COCAR SAGRADO — Admin: Áudios das leituras
   Gravador estilo celular (MediaRecorder): a admin escolhe o
   agendamento, grava (pausa/retoma), ouve o preview e salva no
   bucket privado "audios" + tabela audios_cliente (user_id vem
   de trigger no banco). Cliente logado ouve no drawer do site.
   ============================================================ */

let _audAgendamentos = [];   // cache da busca de agendamentos
let _audSelecionado  = null; // agendamento destino
let _audRecorder     = null;
let _audStream       = null;
let _audChunks       = [];
let _audBlob         = null;
let _audMime         = '';
let _audMs           = 0;    // duração acumulada (só enquanto grava)
let _audTimerInt     = null;
let _audPreviewUrl   = null;

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

// ============================================================
// Init da seção
// ============================================================
async function inicializarAudios() {
  const container = document.getElementById('audios-container');
  if (!container) return;

  container.innerHTML = `
    <div class="desc-bloco-titulo" style="margin-bottom:14px;">Gravar áudio para um cliente</div>

    <div class="aud-passo">
      <div class="aud-passo-titulo">1. Escolha o agendamento</div>
      <input type="text" id="aud-busca" class="cup-input" autocomplete="off"
             placeholder="Buscar por nome, leitura ou WhatsApp…">
      <div id="aud-ag-lista" class="aud-ag-lista">
        <div class="ag-loading"><div class="ag-spinner"></div> Carregando…</div>
      </div>
    </div>

    <div class="aud-passo" id="aud-passo-gravar" style="display:none;">
      <div class="aud-passo-titulo">2. Grave o áudio</div>
      <div class="aud-destino" id="aud-destino"></div>
      <div class="aud-gravador">
        <div class="aud-timer" id="aud-timer">00:00</div>
        <div class="aud-estado" id="aud-estado">Pronto para gravar</div>
        <div class="aud-controles" id="aud-controles"></div>
        <div class="aud-preview" id="aud-preview"></div>
        <div class="aud-erro" id="aud-erro"></div>
      </div>
      <div id="aud-lista" class="aud-lista"></div>
    </div>`;

  document.getElementById('aud-busca').addEventListener('input', _audFiltrarLista);
  _audResetGravador();
  await _audCarregarAgendamentos();
}

// ============================================================
// Passo 1 — seletor de agendamento
// ============================================================
async function _audCarregarAgendamentos() {
  const lista = document.getElementById('aud-ag-lista');
  if (!lista) return;

  const { data, error } = await supabase
    .from('agendamentos')
    .select('id, cliente_nome, cliente_whatsapp, data_agendamento, status, leitura_origem_id, tipos_leitura(nome), pedidos(user_id)')
    .in('status', ['pago', 'confirmado', 'atendido'])
    .order('data_agendamento', { ascending: false })
    .limit(100);

  if (error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar agendamentos.</div>';
    console.error('_audCarregarAgendamentos:', error);
    return;
  }

  _audAgendamentos = data || [];
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
    lista.innerHTML = '<div class="ag-empty">Nenhum agendamento pago encontrado.</div>';
    return;
  }

  lista.innerHTML = '';
  ags.forEach(ag => {
    const temConta = !!ag.pedidos?.user_id;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'aud-ag-item' + (_audSelecionado?.id === ag.id ? ' aud-ag-item--sel' : '');
    item.innerHTML = `
      <span class="aud-ag-nome">${_audEsc(ag.cliente_nome)}</span>
      <span class="aud-ag-meta">${_audEsc(ag.tipos_leitura?.nome || 'Leitura')}${ag.leitura_origem_id ? ' (＋ pergunta adicional)' : ''} · ${_audDataAgend(ag.data_agendamento)}</span>
      <span class="aud-ag-badge ${temConta ? 'aud-ag-badge--conta' : 'aud-ag-badge--guest'}">
        ${temConta ? 'com conta' : 'sem conta — não aparece no site'}
      </span>`;
    item.addEventListener('click', () => _audSelecionar(ag));
    lista.appendChild(item);
  });
}

async function _audSelecionar(ag) {
  // Trocar de cliente no meio de uma gravação descartaria áudio sem avisar
  if (_audRecorder && _audRecorder.state !== 'inactive') {
    if (!confirm('Há uma gravação em andamento. Descartar e trocar de agendamento?')) return;
    _audDescartarGravacao();
  }
  _audSelecionado = ag;
  _audFiltrarLista(); // re-render mantendo o filtro (marca o selecionado)

  const passo = document.getElementById('aud-passo-gravar');
  passo.style.display = '';
  document.getElementById('aud-destino').innerHTML =
    `Gravando para: <strong>${_audEsc(ag.cliente_nome)}</strong> · ${_audEsc(ag.tipos_leitura?.nome || 'Leitura')} · ${_audDataAgend(ag.data_agendamento)}`;
  _audResetGravador();
  await _audCarregarAudiosDoAgendamento();
  passo.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  if (el) el.textContent = _audMmSs(_audMs / 1000);
}

function _audBotoes(html) {
  const el = document.getElementById('aud-controles');
  if (el) el.innerHTML = html;
}

function _audResetGravador() {
  if (_audTimerInt) { clearInterval(_audTimerInt); _audTimerInt = null; }
  if (_audStream) { _audStream.getTracks().forEach(t => t.stop()); _audStream = null; }
  if (_audPreviewUrl) { URL.revokeObjectURL(_audPreviewUrl); _audPreviewUrl = null; }
  _audRecorder = null;
  _audChunks = [];
  _audBlob = null;
  _audMs = 0;

  const preview = document.getElementById('aud-preview');
  if (preview) preview.innerHTML = '';
  _audSetErro('');
  _audAtualizaTimer();
  document.getElementById('aud-timer')?.classList.remove('aud-timer--rec');
  _audSetEstado('Pronto para gravar');
  _audBotoes(`<button type="button" class="aud-btn aud-btn-rec" onclick="_audComecarGravacao()" title="Gravar">🎙</button>`);
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
  _audAtualizaTimer();

  _audRecorder = new MediaRecorder(_audStream, { mimeType: _audMime });
  _audRecorder.ondataavailable = e => { if (e.data?.size) _audChunks.push(e.data); };
  _audRecorder.onstop = () => {
    if (_audTimerInt) { clearInterval(_audTimerInt); _audTimerInt = null; }
    _audStream?.getTracks().forEach(t => t.stop());
    _audStream = null;
    document.getElementById('aud-timer')?.classList.remove('aud-timer--rec');
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
  // reporta Infinity no Chrome.)
  let ultimo = performance.now();
  _audTimerInt = setInterval(() => {
    const agora = performance.now();
    if (_audRecorder?.state === 'recording') _audMs += agora - ultimo;
    ultimo = agora;
    _audAtualizaTimer();
  }, 250);

  document.getElementById('aud-timer')?.classList.add('aud-timer--rec');
  _audSetEstado('Gravando…');
  _audBotoes(`
    <button type="button" class="aud-btn" onclick="_audPausarRetomar()" id="aud-btn-pausa" title="Pausar">⏸</button>
    <button type="button" class="aud-btn aud-btn-stop" onclick="_audPararGravacao()" title="Parar">⏹</button>`);
}

function _audPausarRetomar() {
  if (!_audRecorder) return;
  const btn = document.getElementById('aud-btn-pausa');
  if (_audRecorder.state === 'recording') {
    _audRecorder.pause();
    _audSetEstado('Pausado');
    document.getElementById('aud-timer')?.classList.remove('aud-timer--rec');
    if (btn) { btn.textContent = '▶'; btn.title = 'Retomar'; }
  } else if (_audRecorder.state === 'paused') {
    _audRecorder.resume();
    _audSetEstado('Gravando…');
    document.getElementById('aud-timer')?.classList.add('aud-timer--rec');
    if (btn) { btn.textContent = '⏸'; btn.title = 'Pausar'; }
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

  const temConta = !!_audSelecionado.pedidos?.user_id;
  _toastAdmin('✅ Áudio salvo!' + (temConta ? ' O cliente já vê na conta dele.' : ' Cliente sem conta — fica só aqui no painel.'), 'ok');
  _audResetGravador();
  await _audCarregarAudiosDoAgendamento();
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
    const item = document.createElement('div');
    item.className = 'aud-item';
    item.innerHTML = `
      <div class="aud-item-info">
        <span class="aud-item-nome">🎧 Áudio ${i + 1}</span>
        <span class="aud-item-meta">${_audDataBR(a.criado_em)} · ${_audMmSs(a.duracao_segundos)}</span>
      </div>
      <div class="aud-item-acoes">
        <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-item-play">▶ Ouvir</button>
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

    item.querySelector('.aud-item-del').addEventListener('click', async () => {
      if (!confirm('Apagar este áudio? O cliente deixa de vê-lo na conta.')) return;
      // Linha primeiro (é a fonte de verdade pro cliente); órfão no bucket
      // privado é inofensivo se o remove falhar.
      const { error: e } = await supabase.from('audios_cliente').delete().eq('id', a.id);
      if (e) { _toastAdmin('❌ ' + e.message, 'erro'); return; }
      const { error: eSt } = await supabase.storage.from('audios').remove([a.storage_path]);
      if (eSt) console.warn('arquivo órfão no bucket audios:', a.storage_path, eSt);
      item.remove();
      _toastAdmin('✅ Áudio apagado.', 'ok');
    });

    lista.appendChild(item);
  });
}

window.inicializarAudios = inicializarAudios;
window._audComecarGravacao = _audComecarGravacao;
window._audPausarRetomar = _audPausarRetomar;
window._audPararGravacao = _audPararGravacao;
window._audResetGravador = _audResetGravador;
window._audSalvar = _audSalvar;
