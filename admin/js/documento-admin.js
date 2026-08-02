/* ============================================================
   COCAR SAGRADO — Admin: Documento da leitura (card no agendamento)
   Espelho do bloco de áudios: quando o PDF do documento está salvo
   (agendamentos.documento_pdf_path, bucket privado "documentos"), o
   card do agendamento ganha o bloco "Documento da leitura" com o
   arquivo listado — Ver, Compartilhar e Apagar.
   Por quê: antes o documento só saía de carona no áudio (share em
   dois toques, doc primeiro e áudio depois). Agora cada arquivo tem
   o seu card e o painel manda na ordem que quiser. O e-mail do áudio
   CONTINUA levando o PDF anexado (edge audio-email) — isso é um
   e-mail só, não tem trâmite nenhum.
   Integração (admin-system.js): _docMontarCard(slot, ag) em cada card;
   gerar/regerar continua no botão "Documento" (modal documento-verde).
   ============================================================ */

function _docEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _docDataBR(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// "Documento - <cliente> - DD-MM" (mesmo nome que o share do áudio usava)
function _docNomeSugerido(ag) {
  const [, mes, dia] = String(ag?.data_agendamento || '').split('-');
  const ddmm = dia ? `${dia}-${mes}` : '';
  const base = `Documento - ${ag?.cliente_nome || ''} - ${ddmm}`
    .replace(/\s+/g, ' ').replace(/\s+-\s*$/, '').trim();
  return _audSanitizarNomeArquivo(base || 'Documento');
}

// ============================================================
// API pro painel (admin-system.js)
// ============================================================
// Monta o bloco do documento num slot do card. Sem PDF salvo o slot
// some — quem gera é o botão "Documento" das ações.
function _docMontarCard(slot, ag) {
  if (!slot || !ag) return;
  if (!ag.documento_pdf_path) { slot.innerHTML = ''; return; }

  const quando = ag.documento_gerado_em ? _docDataBR(ag.documento_gerado_em) : '';

  slot.innerHTML = `
    <div class="doc-bloco" data-ag-id="${_docEsc(ag.id)}">
      <div class="doc-bloco-label">Documento da leitura</div>
      <div class="doc-item">
        <div class="doc-item-info">
          <span class="doc-item-nome">${quando ? `Salvo em ${_docEsc(quando)}` : 'Documento salvo'}</span>
          <span class="doc-item-meta">PDF · também vai anexado no e-mail do áudio</span>
        </div>
        <div class="doc-item-acoes">
          <button type="button" class="ag-btn ag-btn-outline ag-btn-sm doc-item-ver"><svg class="ico" aria-hidden="true"><use href="#ico-folha"></use></svg> Ver</button>
          <button type="button" class="ag-btn ag-btn-outline ag-btn-sm doc-item-share" title="Compartilhar" aria-label="Compartilhar documento"><svg class="ico" aria-hidden="true"><use href="#ico-compartilhar"></use></svg></button>
          <button type="button" class="ag-btn ag-btn-outline ag-btn-sm doc-item-del" style="color:var(--t-danger)" title="Apagar documento" aria-label="Apagar documento"><svg class="ico" aria-hidden="true"><use href="#ico-lixeira"></use></svg></button>
        </div>
      </div>
    </div>`;

  slot.querySelector('.doc-item-ver')  .addEventListener('click', ev => _docVer(ev.currentTarget, ag));
  slot.querySelector('.doc-item-share').addEventListener('click', ev => _docCompartilhar(ev.currentTarget, ag));
  slot.querySelector('.doc-item-del')  .addEventListener('click', ev => _docApagar(ev.currentTarget, ag));
}

// Signed URL do PDF (bucket privado). Devolve null e avisa se falhar.
async function _docSignedUrl(ag) {
  const { data, error } = await supabase.storage
    .from('documentos')
    .createSignedUrl(ag.documento_pdf_path, 3600);
  if (error || !data?.signedUrl) {
    _toastAdmin('Não deu pra abrir o documento: ' + (error?.message || 'tente de novo'), 'erro');
    return null;
  }
  return data.signedUrl;
}

// Abre o PDF numa aba. A aba nasce no toque (síncrona) porque a signed
// URL demora e o navegador bloquearia um window.open depois do await.
async function _docVer(btn, ag) {
  const aba = window.open('', '_blank');
  btn.disabled = true;
  try {
    const url = await _docSignedUrl(ag);
    if (!url) { aba?.close(); return; }
    if (aba) aba.location = url;
    else window.open(url, '_blank'); // popup bloqueado: tenta do jeito simples
  } finally {
    btn.disabled = false;
  }
}

// Compartilhar só o documento (o áudio tem o botão dele). Um arquivo por
// share: é isso que acaba com o vai-e-volta de mandar os dois juntos.
async function _docCompartilhar(btn, ag) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-ampulheta"></use></svg>';
  try {
    const url = await _docSignedUrl(ag);
    if (!url) return;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();

    let nome = prompt('Nome do arquivo para compartilhar:', _docNomeSugerido(ag));
    if (nome === null) return; // cancelou o rename
    nome = _audSanitizarNomeArquivo(nome) + '.pdf';

    const file = new File([blob], nome, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: nome });
      } catch (e) {
        // Download longo consumiu o toque que autoriza o share:
        // o pill devolve um toque novo, com o arquivo já em mãos.
        if (e.name === 'NotAllowedError') _audMostrarPillEnviar([file], nome, { rotulo: 'Documento pronto' });
        else if (e.name !== 'AbortError') _toastAdmin('Erro ao compartilhar: ' + e.message, 'erro');
      }
      return;
    }
    _audBaixarArquivo(file); // desktop/sem share de arquivos
  } catch (err) {
    _toastAdmin('Erro ao preparar o documento: ' + err.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// Apagar: some o arquivo do bucket e limpa o carimbo do agendamento
// (o e-mail do áudio volta a sair sozinho). O rascunho do documento
// no navegador continua — dá pra gerar de novo pelo botão "Documento".
async function _docApagar(btn, ag) {
  if (!confirm('Apagar o documento salvo? O e-mail do áudio deixa de levar o PDF (dá pra gerar de novo pelo botão Documento).')) return;
  btn.disabled = true;

  const { error } = await supabase
    .from('agendamentos')
    .update({ documento_pdf_path: null, documento_gerado_em: null })
    .eq('id', ag.id);
  if (error) {
    btn.disabled = false;
    _toastAdmin('Não deu pra apagar: ' + error.message, 'erro');
    return;
  }

  // Linha primeiro (é a fonte de verdade); órfão no bucket privado é
  // inofensivo — e some no próximo "Gerar PDF" (upsert no mesmo path).
  const { error: eSt } = await supabase.storage.from('documentos').remove([ag.documento_pdf_path]);
  if (eSt) console.warn('arquivo órfão no bucket documentos:', ag.documento_pdf_path, eSt);

  ag.documento_pdf_path  = null;
  ag.documento_gerado_em = null;

  // Tira o bloco e o selinho "doc emitido" sem re-render (pode ter
  // gravação de áudio viva em outro card).
  const bloco = document.querySelector(`.doc-bloco[data-ag-id="${CSS.escape(String(ag.id))}"]`);
  const slot  = bloco?.closest('.doc-slot');
  bloco?.remove();
  const card = slot?.closest('.adm-item');
  if (card?.dataset.id === String(ag.id)) card.querySelector('.adm-item-right .adm-badge-doc')?.remove();
  slot?.closest('.adm-grupo-leitura')?.querySelector('.adm-badge-doc')?.remove();

  _toastAdmin('Documento apagado.', 'ok');
}

window._docMontarCard = _docMontarCard;
