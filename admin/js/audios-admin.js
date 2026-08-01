/* ============================================================
   COCAR SAGRADO — Admin: Áudios das leituras (embutido no card)
   A seção "Microfone" morreu: gravar, ouvir e entregar acontecem
   DENTRO do card do agendamento, sem trocar de tela.
   - Cada card pago/confirmado/atendido ganha um bloco "Áudios da
     leitura": lista do que já foi gravado + gravador mínimo
     (● gravar → ■ parar → prévia → salvar).
   - O salvar sobe o mp3 pro bucket privado "audios" + linha em
     audios_cliente. Salvar NÃO envia: o envelope de cada áudio
     dispara o e-mail (edge audio-email; cron re-tenta liberados).
   - Sentinela de mudez (3 camadas): aviso ao vivo quando o mic
     entrega silêncio digital, faixa vermelha na prévia quando o
     arquivo inteiro saiu mudo, e confirm() na hora de salvar.
   - Um gravador por vez no painel inteiro: começar a gravar num
     card com prévia viva em outro pede pra descartar antes.
   Integração (admin-system.js): _audMontarCard(slot, ag) em cada
   card, _audAposRender() depois da lista, _audOcupado() como
   trava anti re-render no meio de uma gravação.
   ============================================================ */

// ---- estado do gravador (um só, dono = um card por vez) ----
let _audAgDono       = null; // agendamento dono da gravação/prévia atual
let _audBloco        = null; // .aud-bloco-gravador do card dono
let _audRecorder     = null;
let _audStream       = null;
let _audChunks       = [];
let _audBlob         = null;
let _audMime         = '';
let _audMs           = 0;    // duração acumulada (só enquanto grava)
let _audTimerInt     = null;
let _audPreviewUrl   = null;
let _audPlayerAudio  = null; // <audio> da prévia (nativo)
let _audAudioCtx     = null; // Web Audio só pra medir a amplitude da voz
let _audAnalyser     = null;
let _audAmostra      = null; // buffer reutilizado do analyser
let _audSilencioDesde = 0;   // último instante em que o mic entregou som de verdade
let _audAvisoVivo     = null; // aviso ativo: 'silencio' | 'mute' | 'ended'
let _audMicDevices    = [];  // audioinputs enumerados
let _audWakeLock      = null;
let _audBeforeUnloadOn = false;
let _audSalvando      = false; // trava anti duplo-clique no salvar
let _audContagem      = {};  // agendamento_id -> nº de áudios salvos
let _audContagemEm    = 0;   // quando a contagem foi buscada (TTL)

const _AUD_TICK = 50; // resolução (ms) do relógio de duração da gravação

// Limiares da sentinela de mudez. O ruído de fundo de um mic vivo fica
// acima de _AUD_LIMIAR_VIVO (silêncio digital = amostras cravadas no
// zero); voz de verdade passa fácil de _AUD_PICO_MUDO no arquivo.
const _AUD_LIMIAR_VIVO = 0.01;  // amplitude ao vivo abaixo disso = mic morto
const _AUD_SILENCIO_MS = 6000;  // quanto silêncio digital contínuo até acusar
const _AUD_PICO_MUDO   = 0.02;  // pico do arquivo inteiro abaixo disso = inaudível

const _AUD_STATUS_COM_AUDIO = ['pago', 'confirmado', 'atendido'];

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

function _audPrimeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || 'cliente';
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
    // logo após parar de gravar, e não pode travar a prévia
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
function _audMostrarPillEnviar(files, nome, opts) {
  document.getElementById('aud-pill-enviar')?.remove();
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.id = 'aud-pill-enviar';
  pill.className = 'aud-pill-enviar';
  pill.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-compartilhar"></use></svg> ' +
    (opts?.rotulo || 'Áudio pronto') + ' — <strong>toque pra enviar</strong>';
  pill.onclick = async () => {
    pill.remove();
    try {
      await navigator.share({ files, title: nome });
      opts?.depois?.();
    } catch (e) {
      if (e.name !== 'AbortError') _toastAdmin('Erro ao compartilhar: ' + e.message, 'erro');
    }
  };
  document.body.appendChild(pill);
}

function _audBaixarArquivo(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Compartilhar (ou baixar, no fallback) um blob de áudio já pronto.
// `doc` (opcional) = { blob, nome } do PDF do documento: quando o pedido
// tem documento salvo, o PDF sai num SEGUNDO toque logo após o áudio.
// Juntos no mesmo share não dá: o WhatsApp rejeita tipos misturados
// (áudio + PDF) e acusa "não é possível enviar mensagem vazia".
async function _audCompartilharBlob(blob, mime, nomeSugestao, doc) {
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
  const docFile = doc?.blob
    ? new File([doc.blob], _audSanitizarNomeArquivo(doc.nome || 'Documento') + '.pdf', { type: 'application/pdf' })
    : null;

  if (navigator.canShare?.({ files: [file] })) {
    // Áudio enviado (share fechou sem cancelar) → pill pro PDF, que
    // precisa de um toque novo (o navegador só autoriza 1 share por toque)
    const oferecerDoc = () => {
      if (docFile && navigator.canShare({ files: [docFile] }))
        _audMostrarPillEnviar([docFile], docFile.name, { rotulo: 'Documento pronto' });
    };
    try {
      await navigator.share({ files: [file], title: nome });
      oferecerDoc();
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        // Conversão longa consumiu o toque que autoriza o share —
        // oferece um botão que compartilha na hora com um toque novo
        _audMostrarPillEnviar([file], nome, { depois: oferecerDoc });
      } else if (e.name !== 'AbortError') {
        _toastAdmin('Erro ao compartilhar: ' + e.message, 'erro');
      }
    }
    return;
  }

  // Fallback (desktop/sem suporte a share de arquivos): baixa direto —
  // os dois arquivos, quando houver documento (o navegador pode pedir
  // permissão de "múltiplos downloads" uma vez)
  _audBaixarArquivo(file);
  if (docFile) setTimeout(() => _audBaixarArquivo(docFile), 400);
}

// ============================================================
// API pro painel (admin-system.js)
// ============================================================

// Gravação em andamento ou prévia não salva: o painel NÃO pode
// re-renderizar a lista (derrubaria o DOM do gravador).
function _audOcupado() {
  return !!(_audRecorder && _audRecorder.state !== 'inactive') || !!_audBlob;
}

// Monta o bloco de áudios num slot do card. `ag` precisa de:
// id, cliente_nome, data_agendamento, status, tipos_leitura(nome).
function _audMontarCard(slot, ag) {
  if (!slot || !ag) return;
  if (!_AUD_STATUS_COM_AUDIO.includes(ag.status)) { slot.remove(); return; }

  slot.innerHTML = `
    <div class="aud-bloco" data-ag-id="${_audEsc(ag.id)}">
      <div class="aud-bloco-label">Áudios da leitura <span class="aud-cont" hidden></span></div>
      <div class="aud-bloco-lista"></div>
      <div class="aud-bloco-gravador"></div>
    </div>`;

  const gravador = slot.querySelector('.aud-bloco-gravador');

  // Re-render aconteceu com gravação/prévia viva deste agendamento?
  // Re-adota: o estado global sobrevive, só o palco é redesenhado.
  if (_audAgDono?.id === ag.id && _audOcupado()) {
    _audBloco = gravador;
    if (_audBlob) _audRenderPrevia(ag); else _audRenderGravando(ag);
  } else {
    _audRenderPronto(gravador, ag);
  }
  _audContPintarBloco(slot.querySelector('.aud-bloco'));

  // Lista carrega quando os detalhes do card abrem (lazy) — e já, se
  // o bloco nasceu com os detalhes abertos (re-render pós-salvar).
  const item = slot.closest('.adm-item');
  const header = item?.querySelector('.adm-item-header');
  const carregar = () => {
    if (slot.dataset.audCarregada) return;
    if (!item?.querySelector('.adm-item-details')?.classList.contains('open')) return;
    slot.dataset.audCarregada = '1';
    _audCardCarregarLista(slot, ag);
  };
  header?.addEventListener('click', () => setTimeout(carregar));
  carregar();
}

// Depois de renderizar a lista da agenda: busca as contagens (com TTL,
// pra busca-enquanto-digita não virar rajada de queries) e pinta os
// selinhos "n áudios" nos cards e nos blocos.
async function _audAposRender() {
  if (Date.now() - _audContagemEm > 15000) {
    const { data, error } = await supabase.from('audios_cliente').select('agendamento_id');
    if (!error) {
      _audContagem = {};
      (data || []).forEach(r => {
        _audContagem[r.agendamento_id] = (_audContagem[r.agendamento_id] || 0) + 1;
      });
      _audContagemEm = Date.now();
    }
  }
  _audContPintarTudo();
}

function _audContPintarTudo() {
  document.querySelectorAll('.aud-bloco').forEach(_audContPintarBloco);
  document.querySelectorAll('.adm-item[data-id]').forEach(item => {
    const n = _audContagem[item.dataset.id] || 0;
    const right = item.querySelector('.adm-item-right');
    if (!right) return;
    let b = right.querySelector('.adm-badge-audio');
    if (!n) { b?.remove(); return; }
    if (!b) {
      b = document.createElement('span');
      b.className = 'adm-badge adm-badge-audio';
      right.insertBefore(b, right.querySelector('.adm-chevron'));
    }
    b.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#ico-microfone"></use></svg> ${n} áudio${n > 1 ? 's' : ''}`;
    b.title = `${n} áudio${n > 1 ? 's' : ''} gravado${n > 1 ? 's' : ''} para esta leitura`;
  });
}

function _audContPintarBloco(bloco) {
  if (!bloco) return;
  const n = _audContagem[bloco.dataset.agId] || 0;
  const chip = bloco.querySelector('.aud-cont');
  if (!chip) return;
  chip.hidden = !n;
  chip.textContent = n ? `${n} gravado${n > 1 ? 's' : ''}` : '';
}

// ============================================================
// Lista de áudios do agendamento (dentro do card)
// ============================================================
async function _audCardCarregarLista(slot, ag) {
  const lista = slot.querySelector('.aud-bloco-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando…</div>';

  const { data, error } = await supabase
    .from('audios_cliente')
    .select('*')
    .eq('agendamento_id', ag.id)
    .order('criado_em', { ascending: true });

  if (error) {
    lista.innerHTML = '<div class="aud-vazio">Erro ao carregar os áudios.</div>';
    console.error('_audCardCarregarLista:', error);
    return;
  }

  _audContagem[ag.id] = (data || []).length;
  _audContPintarTudo();

  lista.innerHTML = '';
  if (!data?.length) {
    lista.innerHTML = '<div class="aud-vazio">Nenhum áudio gravado ainda.</div>';
    return;
  }
  data.forEach(a => lista.appendChild(_audCriarItemAudio(a, ag)));
}

// Acrescenta um áudio recém-salvo na lista do card (sem re-query).
function _audCardAcrescentarItem(slot, ag, a) {
  const lista = slot.querySelector('.aud-bloco-lista');
  if (!lista) return;
  lista.querySelector('.aud-vazio')?.remove();
  const item = _audCriarItemAudio(a, ag);
  item.classList.add('aud-item--novo');
  lista.appendChild(item);
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
// espiada única evita ter que fechar e abrir o card pra ver o resultado.
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

// PDF do documento do pedido (bucket "documentos"), pro share levar
// junto do áudio. Falha aqui não pode travar o share do áudio: avisa
// e devolve null (o documento sempre dá pra mandar pelo botão dele).
async function _audBuscarDocPdf(ag) {
  if (!ag?.documento_pdf_path) return null;
  try {
    const { data: s, error } = await supabase.storage
      .from('documentos')
      .createSignedUrl(ag.documento_pdf_path, 3600);
    if (error || !s?.signedUrl) throw new Error(error?.message || 'sem URL');
    const resp = await fetch(s.signedUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const [, mes, dia] = String(ag.data_agendamento || '').split('-');
    return {
      blob: await resp.blob(),
      nome: `Documento - ${ag.cliente_nome || ''} - ${dia ? `${dia}-${mes}` : ''}`.replace(/\s+-\s*$/, '').trim(),
    };
  } catch (e) {
    console.warn('documento não veio pro share:', e);
    _toastAdmin('O documento não veio junto — compartilha só o áudio agora e o doc pelo botão Documento.', 'info');
    return null;
  }
}

// ============================================================
// Item de áudio na lista do card: ouvir lazy + e-mail + share + apagar
// ============================================================
function _audCriarItemAudio(a, ag) {
  const item = document.createElement('div');
  item.className = 'aud-item';
  item.innerHTML = `
    <div class="aud-item-info">
      <span class="aud-item-nome">Gravado em ${_audEsc(_audDataBR(a.criado_em))}</span>
      <span class="aud-item-meta">${_audMmSs(a.duracao_segundos)}</span>
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
    const nome = ag.cliente_nome || 'o cliente';
    // Pedido com documento salvo: o PDF vai anexado no MESMO e-mail
    const oQueVai = ag.documento_pdf_path ? 'o áudio + o documento (PDF)' : 'este áudio';
    if (!confirm(
      a.quicou_em
        ? `Este e-mail QUICOU em ${_audDataBR(a.quicou_em)} — não chegou. Tentar de novo para ${nome}?`
        : a.entregue_em
          ? `Já entregue em ${_audDataBR(a.entregue_em)}. Reenviar (${oQueVai}) para ${nome}?`
          : a.enviado_email_em
            ? `E-mail já enviado em ${_audDataBR(a.enviado_email_em)}. Reenviar (${oQueVai}) para ${nome}?`
            : `Enviar ${oQueVai} por e-mail para ${nome}?`)) return;
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

  // Compartilhar: baixa o blob via signed URL antes de abrir o menu de
  // share. Pedido com documento salvo leva o PDF junto no mesmo share.
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
      const doc = await _audBuscarDocPdf(ag); // null se não tiver (ou falhar — aí vai só o áudio)
      await _audCompartilharBlob(blob, a.mime || blob.type,
        _audNomeSugerido(ag.cliente_nome, ag.tipos_leitura?.nome, ag.data_agendamento), doc);
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
    const lista = item.parentElement;
    item.remove();
    if (lista && !lista.querySelector('.aud-item')) {
      lista.innerHTML = '<div class="aud-vazio">Nenhum áudio gravado ainda.</div>';
    }
    _audContagem[a.agendamento_id] = Math.max(0, (_audContagem[a.agendamento_id] || 1) - 1);
    _audContPintarTudo();
    _toastAdmin('Áudio apagado.', 'ok');
  });

  return item;
}

// ============================================================
// Gravador mínimo — estados desenhados no .aud-bloco-gravador
// ============================================================
function _audSetErro(txt) {
  const el = _audBloco?.querySelector('.aud-erro');
  if (el) el.textContent = txt || '';
}

function _audRenderPronto(gravador, ag) {
  if (!gravador) return;
  gravador.innerHTML = `
    <div class="aud-min">
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-btn-rec"><span class="aud-rec-dot"></span> Gravar áudio</button>
      <select class="aud-mic-select" hidden></select>
    </div>
    <div class="aud-erro"></div>`;
  gravador.querySelector('.aud-btn-rec').addEventListener('click', () => _audComecarGravacao(gravador, ag));
  const sel = gravador.querySelector('.aud-mic-select');
  sel.addEventListener('change', () => localStorage.setItem('aud_mic_device_id', sel.value));
  _audAtualizarListaMics(sel); // best-effort; labels só vêm depois da 1ª permissão
}

function _audRenderGravando(ag) {
  if (!_audBloco) return;
  _audBloco.innerHTML = `
    <div class="aud-min aud-min--gravando">
      <span class="aud-rec-dot aud-rec-dot--pulsa"></span>
      <span class="aud-tempo">${_audMmSs(_audMs / 1000)}</span>
      <span class="aud-nivel"><span class="aud-nivel-fill"></span></span>
      <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-btn-parar"><b>■</b> Parar</button>
    </div>
    <div class="aud-erro"></div>`;
  _audBloco.querySelector('.aud-btn-parar').addEventListener('click', _audPararGravacao);
}

function _audRenderPrevia(ag) {
  if (!_audBloco) return;
  if (_audPreviewUrl) { URL.revokeObjectURL(_audPreviewUrl); }
  _audPreviewUrl = URL.createObjectURL(_audBlob);

  _audBloco.innerHTML = `
    <div class="aud-previa">
      <audio controls preload="auto" src="${_audPreviewUrl}"></audio>
      <div class="aud-previa-acoes">
        <button type="button" class="ag-btn ag-btn-primary ag-btn-sm aud-btn-salvar"><svg class="ico" aria-hidden="true"><use href="#ico-guardar"></use></svg> Salvar (${_audMmSs(_audMs / 1000)})</button>
        <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-btn-regravar"><svg class="ico" aria-hidden="true"><use href="#ico-atualizar"></use></svg> Regravar</button>
        <button type="button" class="ag-btn ag-btn-outline ag-btn-sm aud-btn-descartar" style="color:var(--t-danger)"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg> Descartar</button>
      </div>
    </div>
    <div class="aud-erro"></div>`;

  _audPlayerAudio = _audBloco.querySelector('audio');
  // webm do MediaRecorder reporta duration=Infinity no Chrome; este truque
  // força o navegador a indexar o arquivo (seek e barra passam a funcionar)
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

  _audBloco.querySelector('.aud-btn-salvar').addEventListener('click', () => _audSalvar(ag));
  _audBloco.querySelector('.aud-btn-regravar').addEventListener('click', () => {
    const gravador = _audBloco;
    _audLimparEstado();
    _audComecarGravacao(gravador, ag);
  });
  _audBloco.querySelector('.aud-btn-descartar').addEventListener('click', () => _audDescartarGravacao());

  if (_audPareceMudo(_audBlob)) _audAvisarPreviaMuda();
}

// Faixa vermelha na prévia: a conversão mediu o arquivo inteiro e não achou som
function _audAvisarPreviaMuda() {
  const previa = _audBloco?.querySelector('.aud-previa');
  if (!previa || _audBloco.querySelector('.aud-aviso-mudo')) return;
  const aviso = document.createElement('div');
  aviso.className = 'aud-aviso-mudo';
  aviso.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-alerta"></use></svg><div><strong>Este áudio saiu mudo.</strong> O microfone não captou som do início ao fim — toca a prévia pra conferir e, se estiver vazio, regrava.</div>';
  previa.prepend(aviso);
}

// ============================================================
// Sentinela de mudez — já saiu daqui leitura de 10 min muda sem
// ninguém perceber. Mic mudo no sistema, dispositivo errado ou
// outro app tomando o mic entregam silêncio que o MediaRecorder
// grava sem reclamar.
// ============================================================
function _audAvisar(tipo, msg) {
  if (_audAvisoVivo === tipo) return;
  _audAvisoVivo = tipo;
  _audSetErro(msg);
  _audBloco?.querySelector('.aud-min')?.classList.add('aud-min--alerta');
  navigator.vibrate?.([120, 60, 120]); // pra quem grava olhando as cartas, não a tela
}

function _audAvisoLimpar() {
  if (!_audAvisoVivo) return;
  _audAvisoVivo = null;
  _audSetErro('');
  _audBloco?.querySelector('.aud-min')?.classList.remove('aud-min--alerta');
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
// Seletor de microfone (aparece no estado "pronto" com 2+ mics)
// ============================================================
async function _audAtualizarListaMics(sel) {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let devices;
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (_) { return; }
  _audMicDevices = devices.filter(d => d.kind === 'audioinput');

  sel = sel || _audBloco?.querySelector('.aud-mic-select');
  if (!sel || !sel.isConnected) return;
  if (_audMicDevices.length < 2) { sel.hidden = true; sel.innerHTML = ''; return; }

  const atual = localStorage.getItem('aud_mic_device_id');
  sel.innerHTML = _audMicDevices
    .map((d, i) => `<option value="${_audEsc(d.deviceId)}">${_audEsc(d.label || `Microfone ${i + 1}`)}</option>`)
    .join('');
  if (atual && _audMicDevices.some(d => d.deviceId === atual)) sel.value = atual;
  sel.hidden = false;
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
  const precisaAvisar = _audOcupado();
  if (precisaAvisar && !_audBeforeUnloadOn) {
    window.addEventListener('beforeunload', _audBeforeUnloadHandler);
    _audBeforeUnloadOn = true;
  } else if (!precisaAvisar && _audBeforeUnloadOn) {
    window.removeEventListener('beforeunload', _audBeforeUnloadHandler);
    _audBeforeUnloadOn = false;
  }
}

// iOS suspende o AudioContext quando o app perde o foco no meio da gravação
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _audRecorder?.state === 'recording') {
    if (!_audWakeLock) _audWakeLockPedir();
    _audAudioCtx?.resume().catch(() => {});
  }
});

// ============================================================
// Ciclo de vida da gravação
// ============================================================

// Limpa o estado global SEM redesenhar palco nenhum.
function _audLimparEstado() {
  document.getElementById('aud-pill-enviar')?.remove(); // pill apontaria pra áudio morto
  if (_audTimerInt) { clearInterval(_audTimerInt); _audTimerInt = null; }
  if (_audStream) { _audStream.getTracks().forEach(t => t.stop()); _audStream = null; }
  if (_audPreviewUrl) { URL.revokeObjectURL(_audPreviewUrl); _audPreviewUrl = null; }
  if (_audPlayerAudio) { _audPlayerAudio.pause(); _audPlayerAudio = null; }
  _audFecharAudioCtx();
  _audWakeLockLiberar();
  _audRecorder = null;
  _audChunks = [];
  _audBlob = null;
  _audMs = 0;
  _audAvisoVivo = null;
  _audAtualizarBeforeUnload();
}

// Descarta a gravação/prévia atual e devolve o card dono pro estado pronto.
function _audDescartarGravacao() {
  try { if (_audRecorder && _audRecorder.state !== 'inactive') { _audRecorder.onstop = null; _audRecorder.stop(); } } catch (_) {}
  const gravador = _audBloco, ag = _audAgDono;
  _audLimparEstado();
  _audBloco = null;
  _audAgDono = null;
  if (gravador?.isConnected) _audRenderPronto(gravador, ag);
}

async function _audComecarGravacao(gravador, ag) {
  // Um gravador por vez no painel: gravação/prévia viva em outro card
  // precisa ser descartada com consentimento antes de começar aqui.
  if (_audOcupado()) {
    if (_audAgDono?.id !== ag.id &&
        !confirm(`Há uma gravação não salva para ${_audPrimeiroNome(_audAgDono?.cliente_nome)}. Descartar e gravar aqui?`)) return;
    _audDescartarGravacao();
  }

  _audBloco = gravador;
  _audAgDono = ag;
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

  // Analyser pra barrinha de nível e pra sentinela de mudez; se falhar,
  // grava mesmo assim (barrinha parada), mas avisa que ficou sem monitor
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
      const gravador = _audBloco;
      _audLimparEstado();
      _audBloco = null;
      _audAgDono = null;
      if (gravador?.isConnected) {
        _audRenderPronto(gravador, ag);
        const erro = gravador.querySelector('.aud-erro');
        if (erro) erro.textContent = 'A gravação saiu vazia — o navegador não entregou nenhum áudio. Tenta de novo.';
      }
      return;
    }
    if (_audAvisoVivo !== 'ended') _audAvisoLimpar(); // aviso ao vivo já cumpriu o papel
    _audAtualizarBeforeUnload();
    _audRenderPrevia(ag);
    // Já converte pra mp3 em segundo plano: quando salvar ou compartilhar
    // (depois de ouvir a prévia), o arquivo estará pronto e ninguém espera.
    // A conversão também mede o nível — arquivo inteiro mudo ganha a faixa.
    const gravado = _audBlob;
    _audConverterParaMp3(gravado)
      .then(() => { if (gravado === _audBlob && _audPareceMudo(gravado)) _audAvisarPreviaMuda(); })
      .catch(() => {});
  };
  _audRecorder.onerror = () => {
    _toastAdmin('Erro na gravação. Tente de novo.', 'erro');
    _audDescartarGravacao();
  };
  _audRecorder.start(1000); // chunks de 1s: não perde tudo se algo falhar no fim
  _audWakeLockPedir();
  _audAtualizarBeforeUnload();

  _audRenderGravando(ag);

  // Duração pause-aware acumulada em _audMs (não dá pra confiar em
  // audio.duration depois: webm do MediaRecorder reporta Infinity no
  // Chrome). O mesmo tick pinta o relógio e a barrinha de nível — e
  // roda no setInterval, não em rAF: segue vivo com a tela apagada.
  let ultimo = performance.now();
  _audSilencioDesde = ultimo;
  _audTimerInt = setInterval(() => {
    const agora = performance.now();
    if (_audRecorder?.state === 'recording') {
      _audMs += agora - ultimo;
      _audVigiarSilencio(agora);
      const tempo = _audBloco?.querySelector('.aud-tempo');
      if (tempo) tempo.textContent = _audMmSs(_audMs / 1000);
      const fill = _audBloco?.querySelector('.aud-nivel-fill');
      if (fill) fill.style.width = Math.round(_audAmplitudeAtual() * 100) + '%';
    }
    ultimo = agora;
  }, _AUD_TICK);
}

function _audPararGravacao() {
  if (_audRecorder && _audRecorder.state !== 'inactive') _audRecorder.stop();
}

// ============================================================
// Salvar: upload do mp3 no bucket privado + insert na tabela.
// NÃO envia e-mail — o envelope do item recém-listado envia.
// ============================================================
async function _audSalvar(ag) {
  if (!ag || !_audBlob || _audSalvando) return;
  _audSalvando = true;

  const btn = _audBloco?.querySelector('.aud-btn-salvar');
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
    _audSalvarFalhou(null);
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
  }).select('id, criado_em').single();

  if (dbErr) {
    await supabase.storage.from('audios').remove([path]); // não deixar arquivo órfão
    _audSalvarFalhou('Erro ao salvar: ' + dbErr.message);
    return;
  }

  _audSalvando = false;
  const gravador = _audBloco;
  _audLimparEstado();
  _audBloco = null;
  _audAgDono = null;

  // O áudio novo entra na lista do card na hora, com o envelope pronto
  const slot = gravador?.closest('.aud-slot');
  if (slot) {
    _audCardAcrescentarItem(slot, ag, {
      id: novo.id,
      agendamento_id: ag.id,
      storage_path: path,
      duracao_segundos: seg,
      mime: contentType,
      criado_em: novo.criado_em || new Date().toISOString(),
      email_liberado_em: null,
      enviado_email_em: null,
      entregue_em: null,
      quicou_em: null,
    });
  }
  if (gravador?.isConnected) _audRenderPronto(gravador, ag);
  _audContagem[ag.id] = (_audContagem[ag.id] || 0) + 1;
  _audContPintarTudo();
  _toastAdmin('Áudio salvo — o envelope envia pro e-mail quando você quiser.', 'ok');
}

function _audSalvarFalhou(msg) {
  _audSalvando = false;
  if (msg) _toastAdmin(msg, 'erro');
  const btn = _audBloco?.querySelector('.aud-btn-salvar');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#ico-guardar"></use></svg> Salvar (${_audMmSs(_audMs / 1000)})`;
  }
}

window._audMontarCard = _audMontarCard;
window._audAposRender = _audAposRender;
window._audOcupado = _audOcupado;
