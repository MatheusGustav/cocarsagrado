/* ============================================================
   CATÁLOGO — Painel Admin
   CRUD em public.tipos_leitura + upload em storage bucket 'catalogo'
   ============================================================ */

const _CAT_BUCKET = 'catalogo';
const _CAT_TERAPEUTA_LABEL = { matheus: 'Matheus', camila: 'Camila' };

let _catCache         = [];
let _catEditandoId    = null;
let _catArquivoNovo   = null;
let _catImagemRemovida = false;

async function inicializarCatalogo() {
  const container = document.getElementById('catalogo-container');
  if (!container) return;
  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  const { data, error } = await supabase
    .from('tipos_leitura')
    .select('*')
    .order('ordem')
    .order('nome');

  if (error) {
    container.innerHTML = '<div class="ag-empty">Erro ao carregar catálogo.</div>';
    console.error(error);
    return;
  }

  _catCache = data || [];
  _catRenderizar();
}

function _catRenderizar() {
  const container = document.getElementById('catalogo-container');
  if (!container) return;

  container.innerHTML = `
    <div class="cat-topbar">
      <button class="ag-btn ag-btn-primary ag-btn-sm" onclick="cat_abrirFormNovo()">+ Nova Leitura</button>
      <span class="cat-count">${_catCache.length} leitura${_catCache.length === 1 ? '' : 's'}</span>
    </div>
    <div class="cat-grid">
      ${_catCache.map(_catCard).join('')}
    </div>
  `;
}

const _CAT_BADGE_LABEL = { buzios: 'Búzios', cartas: 'Cartas', radiestesia: 'Radiestesia' };

function _catCard(t) {
  const preco    = `R$ ${Number(t.preco_original || 0).toFixed(2).replace('.', ',')}`;
  const inativo  = t.ativo === false;
  const terapeutaTag = t.terapeuta
    ? `<span class="cat-card-terapeuta">${_CAT_TERAPEUTA_LABEL[t.terapeuta] || t.terapeuta}</span>`
    : `<span class="cat-card-terapeuta cat-card-terapeuta--missing">sem terapeuta</span>`;
  const badgeTag = t.badge
    ? `<span class="cat-card-badge cat-card-badge--${t.badge}">● ${_CAT_BADGE_LABEL[t.badge] || t.badge}</span>`
    : '';
  const inativoTag = inativo
    ? `<span class="cat-card-inativo">inativa</span>`
    : '';
  const img      = t.imagem_url
    ? `<img src="${_catEsc(t.imagem_url)}" alt="${_catEsc(t.nome)}" class="cat-card-foto">`
    : `<div class="cat-card-foto cat-card-foto--placeholder">✦</div>`;

  const acoes = inativo
    ? `<button class="ag-btn ag-btn-primary ag-btn-sm" onclick="cat_reativar(${t.id})">Reativar</button>
       <button class="ag-btn ag-btn-danger ag-btn-sm" onclick="cat_excluir(${t.id})">Excluir</button>`
    : `<button class="ag-btn ag-btn-outline ag-btn-sm" onclick="cat_abrirFormEditar(${t.id})">Editar</button>
       <button class="ag-btn ag-btn-danger ag-btn-sm" onclick="cat_excluir(${t.id})">Excluir</button>`;

  return `
    <div class="cat-card${inativo ? ' cat-card--inativo' : ''}" data-id="${t.id}">
      ${img}
      <div class="cat-card-info">
        <div class="cat-card-nome">${_catEsc(t.nome)} ${inativoTag}</div>
        <div class="cat-card-meta">
          <span class="cat-card-preco">${preco}</span>
        </div>
        ${badgeTag}
        ${terapeutaTag}
      </div>
      <div class="cat-card-acoes">
        ${acoes}
      </div>
    </div>
  `;
}

function cat_abrirFormNovo() {
  _catEditandoId     = null;
  _catArquivoNovo    = null;
  _catImagemRemovida = false;
  _catRenderForm({
    nome: '', descricao: '', preco_original: '',
    imagem_url: '', terapeuta: '', especial: false, requer_pergunta: false,
  });
}

function cat_abrirFormEditar(id) {
  const t = _catCache.find(x => x.id === id);
  if (!t) return;
  _catEditandoId     = id;
  _catArquivoNovo    = null;
  _catImagemRemovida = false;
  _catRenderForm(t);
}

function _catRenderForm(t) {
  // Remove modal anterior, se existir
  document.getElementById('cat-modal')?.remove();

  const titulo = _catEditandoId ? 'Editar Leitura' : 'Nova Leitura';
  const preview = t.imagem_url
    ? `<img src="${_catEsc(t.imagem_url)}" alt="" class="cat-form-preview">`
    : `<div class="cat-form-preview cat-form-preview--placeholder">✦</div>`;

  const opt = (val, lbl, sel) => `<option value="${val}"${sel === val ? ' selected' : ''}>${lbl}</option>`;

  const overlay = document.createElement('div');
  overlay.id = 'cat-modal';
  overlay.className = 'agenda-modal-overlay';
  overlay.innerHTML = `
    <div class="agenda-modal-container cat-modal-container" role="dialog" aria-modal="true" aria-labelledby="cat-modal-titulo">
      <div class="agenda-modal-header">
        <h3 class="agenda-modal-titulo" id="cat-modal-titulo">${titulo}</h3>
        <button class="agenda-modal-fechar" type="button" onclick="cat_fecharForm()" aria-label="Fechar">×</button>
      </div>
      <div class="agenda-modal-body">
        <div class="cat-form-foto-row">
          <div id="cat-preview-wrap">${preview}</div>
          <div class="cat-form-foto-acoes">
            <label class="ag-btn ag-btn-outline ag-btn-sm cat-upload-btn">
              ${t.imagem_url ? 'Trocar foto' : 'Escolher foto'}
              <input type="file" id="cat-input-foto" accept="image/*" hidden>
            </label>
            ${t.imagem_url ? `<button class="ag-btn ag-btn-outline ag-btn-sm" type="button" onclick="cat_removerFoto()" style="color:#B91C1C">Remover</button>` : ''}
          </div>
        </div>

        <div class="ag-form-group">
          <label for="cat-nome">Nome</label>
          <input type="text" id="cat-nome" value="${_catEsc(t.nome || '')}" maxlength="100">
        </div>

        <div class="ag-form-group">
          <label for="cat-desc">Descrição</label>
          <textarea id="cat-desc" rows="3">${_catEsc(t.descricao || '')}</textarea>
        </div>

        <div class="ag-form-group">
          <label for="cat-preco">Preço (R$)</label>
          <input type="number" id="cat-preco" value="${t.preco_original ?? ''}" min="0" step="0.01">
        </div>

        <div class="cat-form-row">
          <div class="ag-form-group">
            <label for="cat-terapeuta">Terapeuta</label>
            <select id="cat-terapeuta">
              ${opt('', '— selecione —', t.terapeuta || '')}
              ${opt('matheus', 'Matheus', t.terapeuta || '')}
              ${opt('camila', 'Camila', t.terapeuta || '')}
            </select>
          </div>
          <div class="ag-form-group">
            <label for="cat-ordem">Posição na lista</label>
            <select id="cat-ordem" disabled><option>Selecione um terapeuta…</option></select>
          </div>
        </div>

        <div class="ag-form-group">
          <label>Badge da leitura</label>
          <div class="cat-badge-group">
            <label class="cat-badge-opt cat-badge-opt--none">
              <input type="radio" name="cat-badge" value="" ${!t.badge ? 'checked' : ''}>
              Nenhum
            </label>
            <label class="cat-badge-opt cat-badge-opt--buzios">
              <input type="radio" name="cat-badge" value="buzios" ${t.badge === 'buzios' ? 'checked' : ''}>
              ● Búzios
            </label>
            <label class="cat-badge-opt cat-badge-opt--cartas">
              <input type="radio" name="cat-badge" value="cartas" ${t.badge === 'cartas' ? 'checked' : ''}>
              ● Cartas
            </label>
            <label class="cat-badge-opt cat-badge-opt--radiestesia">
              <input type="radio" name="cat-badge" value="radiestesia" ${t.badge === 'radiestesia' ? 'checked' : ''}>
              ● Radiestesia
            </label>
          </div>
        </div>

        <div class="cat-form-flags">
          <div class="cat-form-agenda">
            <span class="cat-form-agenda-label">Tipo de agenda</span>
            <label class="cat-form-flag">
              <input type="radio" name="cat-agenda" value="convencional" ${t.especial ? '' : 'checked'}>
              <span><strong>Agenda convencional</strong> <em>(usa sistema de vagas)</em></span>
            </label>
            <label class="cat-form-flag">
              <input type="radio" name="cat-agenda" value="especial" ${t.especial ? 'checked' : ''}>
              <span><strong>Agenda especial</strong> <em>(datas específicas)</em></span>
            </label>
          </div>
          <label class="cat-form-flag">
            <input type="checkbox" id="cat-pergunta" ${t.requer_pergunta ? 'checked' : ''}>
            <span>Cliente precisa <strong>descrever a pergunta</strong> ao agendar</span>
          </label>
          <div class="ag-form-group" id="cat-num-perg-wrap" style="${t.requer_pergunta ? '' : 'display:none'}">
            <label for="cat-num-perg">Quantas perguntas?</label>
            <input type="number" id="cat-num-perg" min="1" max="20" step="1"
              value="${t.num_perguntas || 1}" style="max-width:120px">
          </div>
        </div>
      </div>

      <div class="cat-form-actions">
        <button class="ag-btn ag-btn-outline ag-btn-sm" type="button" onclick="cat_fecharForm()">Cancelar</button>
        <button class="ag-btn ag-btn-primary ag-btn-sm" id="cat-btn-salvar" type="button" onclick="_catSalvar()">Salvar</button>
      </div>
    </div>
  `;


  document.body.appendChild(overlay);
  document.getElementById('cat-input-foto')?.addEventListener('change', _catPreviewArquivo);

  // Toggle visibility do campo "Quantas perguntas?" baseado no checkbox
  const chkPerg = document.getElementById('cat-pergunta');
  const wrapPerg = document.getElementById('cat-num-perg-wrap');
  chkPerg?.addEventListener('change', () => {
    if (wrapPerg) wrapPerg.style.display = chkPerg.checked ? '' : 'none';
  });

  // Popular o select de posição com base no terapeuta atual
  _catAtualizarOrdemSelect(t.terapeuta || '');
  document.getElementById('cat-terapeuta')?.addEventListener('change', e => {
    _catAtualizarOrdemSelect(e.target.value);
  });

  // Fechar ao clicar no fundo
  overlay.addEventListener('click', e => {
    if (e.target === overlay) cat_fecharForm();
  });

  // Fechar com ESC
  document.addEventListener('keydown', _catEscHandler);

  // Trava scroll do body e dispara animação de abertura
  document.body.classList.add('modal-aberto');
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function _catEscHandler(e) {
  if (e.key === 'Escape') cat_fecharForm();
}

/* Monta o <select id="cat-ordem"> com posições relativas ao terapeuta.
   Inativas não contam. Se editando, a leitura entra na contagem; se nova,
   adiciona uma posição extra ao final. */
function _catAtualizarOrdemSelect(terapeuta) {
  const sel = document.getElementById('cat-ordem');
  if (!sel) return;

  if (!terapeuta) {
    sel.disabled = true;
    sel.innerHTML = '<option>Selecione um terapeuta…</option>';
    return;
  }

  const ativasDoTerapeuta = _catCache.filter(x =>
    x.terapeuta === terapeuta && x.ativo !== false
  );
  const editandoTrocouTerapeuta = _catEditandoId &&
    !ativasDoTerapeuta.some(x => x.id === _catEditandoId);
  const editandoMesmoTerapeuta = _catEditandoId &&
    ativasDoTerapeuta.some(x => x.id === _catEditandoId);

  // Quantos itens haverá na lista após salvar
  const total = editandoMesmoTerapeuta
    ? ativasDoTerapeuta.length
    : ativasDoTerapeuta.length + 1;

  // Posição padrão sugerida no select
  let posPadrao;
  if (editandoMesmoTerapeuta) {
    // Mantém posição atual (ordena pela ordem real e descobre o índice)
    const ordenadas = [...ativasDoTerapeuta].sort(_catCmpOrdem);
    posPadrao = ordenadas.findIndex(x => x.id === _catEditandoId) + 1;
  } else {
    posPadrao = total; // entra no fim
  }

  sel.disabled = false;
  sel.innerHTML = '';
  for (let i = 1; i <= total; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${i}ª de ${total}`;
    if (i === posPadrao) opt.selected = true;
    sel.appendChild(opt);
  }

  if (editandoTrocouTerapeuta) {
    // Aviso visual sutil: trocou de terapeuta → vai pro fim por padrão
    sel.title = 'Trocou de terapeuta — entrará no fim da lista do novo terapeuta';
  } else {
    sel.title = '';
  }
}

function _catCmpOrdem(a, b) {
  const da = a.ordem ?? 100, db = b.ordem ?? 100;
  if (da !== db) return da - db;
  return String(a.nome || '').localeCompare(String(b.nome || ''));
}

function _catPreviewArquivo(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    _toastAdmin('Arquivo precisa ser uma imagem.', 'erro');
    e.target.value = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    _toastAdmin('Imagem muito grande (máx 5MB).', 'erro');
    e.target.value = '';
    return;
  }
  _catArquivoNovo    = file;
  _catImagemRemovida = false;
  const url = URL.createObjectURL(file);
  const wrap = document.getElementById('cat-preview-wrap');
  if (wrap) wrap.innerHTML = `<img src="${url}" alt="" class="cat-form-preview">`;
}

function cat_removerFoto() {
  _catArquivoNovo    = null;
  _catImagemRemovida = true;
  const wrap = document.getElementById('cat-preview-wrap');
  if (wrap) wrap.innerHTML = `<div class="cat-form-preview cat-form-preview--placeholder">✦</div>`;
  const input = document.getElementById('cat-input-foto');
  if (input) input.value = '';
}

function cat_fecharForm() {
  _catEditandoId     = null;
  _catArquivoNovo    = null;
  _catImagemRemovida = false;
  document.removeEventListener('keydown', _catEscHandler);
  const overlay = document.getElementById('cat-modal');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.classList.remove('modal-aberto');
  setTimeout(() => overlay.remove(), 280);
}

function _catSlugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

async function _catSalvar() {
  const nome      = document.getElementById('cat-nome')?.value?.trim();
  const desc      = document.getElementById('cat-desc')?.value?.trim() || null;
  const preco     = parseFloat(document.getElementById('cat-preco')?.value);
  const terapeuta = document.getElementById('cat-terapeuta')?.value || null;
  const posicao   = parseInt(document.getElementById('cat-ordem')?.value, 10);
  const especial  = document.querySelector('input[name="cat-agenda"]:checked')?.value === 'especial';
  const badge     = document.querySelector('input[name="cat-badge"]:checked')?.value || null;
  const requer    = document.getElementById('cat-pergunta')?.checked || false;
  const numPergRaw = parseInt(document.getElementById('cat-num-perg')?.value, 10);
  const numPerg    = requer ? (Number.isFinite(numPergRaw) && numPergRaw > 0 ? Math.min(20, numPergRaw) : 1) : 0;

  if (!nome)                          { _toastAdmin('Informe o nome.', 'erro'); return; }
  if (isNaN(preco) || preco < 0)      { _toastAdmin('Preço inválido.', 'erro'); return; }
  if (!terapeuta)                     { _toastAdmin('Selecione um terapeuta.', 'erro'); return; }
  if (isNaN(posicao) || posicao < 1)  { _toastAdmin('Selecione uma posição.', 'erro'); return; }

  const btn = document.getElementById('cat-btn-salvar');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    let imagem_url;
    const atual = _catEditandoId ? _catCache.find(x => x.id === _catEditandoId) : null;

    if (_catArquivoNovo) {
      const ext  = (_catArquivoNovo.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(_CAT_BUCKET)
        .upload(path, _catArquivoNovo, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(_CAT_BUCKET).getPublicUrl(path);
      imagem_url = pub.publicUrl;
      if (atual?.imagem_url) await _catRemoverArquivo(atual.imagem_url);
    } else if (_catImagemRemovida) {
      imagem_url = null;
      if (atual?.imagem_url) await _catRemoverArquivo(atual.imagem_url);
    } else {
      imagem_url = atual?.imagem_url ?? null;
    }

    const slug = atual?.slug || await _catSlugUnico(_catSlugify(nome));

    const payload = {
      nome,
      descricao:       desc,
      preco_original:  preco,
      imagem_url,
      slug,
      terapeuta,
      ordem:           posicao * 10,
      especial,
      badge:           badge || null,
      requer_pergunta: requer,
      num_perguntas:   numPerg,
    };

    let salvoId = _catEditandoId;
    if (_catEditandoId) {
      const { error } = await supabase.from('tipos_leitura').update(payload).eq('id', _catEditandoId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('tipos_leitura')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      salvoId = data?.id;
    }

    await _catRenumerarTerapeuta(terapeuta, salvoId, posicao);

    _toastAdmin('✅ Salvo com sucesso!', 'ok');
    cat_fecharForm();
    await inicializarCatalogo();
  } catch (e) {
    _toastAdmin('Erro ao salvar: ' + (e.message || e), 'erro');
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  }
}

/* Renumera todas as leituras ATIVAS do terapeuta com ordens 10, 20, 30…
   garantindo que `idAlvo` fique na posição `posicaoAlvo` (1-based). */
async function _catRenumerarTerapeuta(terapeuta, idAlvo, posicaoAlvo) {
  const { data, error } = await supabase
    .from('tipos_leitura')
    .select('id, nome, ordem, ativo')
    .eq('terapeuta', terapeuta)
    .eq('ativo', true);
  if (error) throw error;

  const lista = (data || []).slice().sort(_catCmpOrdem);
  const alvoIdx = lista.findIndex(x => x.id === idAlvo);
  if (alvoIdx === -1) return; // alvo inativo ou de outro terapeuta — nada a fazer
  const [alvo] = lista.splice(alvoIdx, 1);
  const destino = Math.max(0, Math.min(lista.length, posicaoAlvo - 1));
  lista.splice(destino, 0, alvo);

  const updates = lista
    .map((item, i) => ({ id: item.id, novaOrdem: (i + 1) * 10 }))
    .filter(u => {
      const original = (data || []).find(x => x.id === u.id);
      return original && original.ordem !== u.novaOrdem;
    });

  await Promise.all(updates.map(u =>
    supabase.from('tipos_leitura').update({ ordem: u.novaOrdem }).eq('id', u.id)
  ));
}

async function _catSlugUnico(base) {
  if (!base) base = 'leitura';
  let cand = base, i = 2;
  while (true) {
    const { data } = await supabase.from('tipos_leitura').select('id').eq('slug', cand).maybeSingle();
    if (!data) return cand;
    cand = `${base}-${i++}`;
    if (i > 50) return `${base}-${Date.now()}`;
  }
}

async function cat_excluir(id) {
  const t = _catCache.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Excluir "${t.nome}"?`)) return;

  const { error } = await supabase.from('tipos_leitura').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      const { error: softErr } = await supabase
        .from('tipos_leitura')
        .update({ ativo: false })
        .eq('id', id);
      if (softErr) {
        _toastAdmin('Erro: ' + softErr.message, 'erro');
        return;
      }
      _toastAdmin('Leitura possui agendamentos — foi desativada (oculta no site).', 'ok');
      await inicializarCatalogo();
      return;
    }
    _toastAdmin('Erro: ' + error.message, 'erro');
    return;
  }

  if (t.imagem_url) await _catRemoverArquivo(t.imagem_url);

  _toastAdmin('✅ Leitura excluída.', 'ok');
  await inicializarCatalogo();
}

async function cat_reativar(id) {
  const t = _catCache.find(x => x.id === id);

  const { error } = await supabase
    .from('tipos_leitura')
    .update({ ativo: true })
    .eq('id', id);
  if (error) {
    _toastAdmin('Erro: ' + error.message, 'erro');
    return;
  }

  // Joga para o fim da lista do terapeuta dela
  if (t?.terapeuta) {
    const ativasDoTerapeuta = _catCache.filter(x =>
      x.terapeuta === t.terapeuta && x.ativo !== false && x.id !== id
    );
    const posicaoFinal = ativasDoTerapeuta.length + 1;
    try {
      await _catRenumerarTerapeuta(t.terapeuta, id, posicaoFinal);
    } catch (e) {
      console.warn('Falha ao renumerar após reativar:', e);
    }
  }

  _toastAdmin('✅ Leitura reativada.', 'ok');
  await inicializarCatalogo();
}

async function _catRemoverArquivo(url) {
  try {
    const marker = `/${_CAT_BUCKET}/`;
    const idx    = url.indexOf(marker);
    if (idx === -1) return;
    const path = url.substring(idx + marker.length).split('?')[0];
    if (!path) return;
    await supabase.storage.from(_CAT_BUCKET).remove([path]);
  } catch (e) {
    console.warn('Falha ao remover arquivo antigo:', e);
  }
}

function _catEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
