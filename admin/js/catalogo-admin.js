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
    <div id="cat-form-wrap"></div>
    <div class="cat-grid">
      ${_catCache.map(_catCard).join('')}
    </div>
  `;
}

function _catCard(t) {
  const preco    = `R$ ${Number(t.preco_original || 0).toFixed(2).replace('.', ',')}`;
  const duracao  = `${t.duracao_minutos} min`;
  const inativo  = t.ativo === false;
  const terapeutaTag = t.terapeuta
    ? `<span class="cat-card-terapeuta">${_CAT_TERAPEUTA_LABEL[t.terapeuta] || t.terapeuta}</span>`
    : `<span class="cat-card-terapeuta cat-card-terapeuta--missing">sem terapeuta</span>`;
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
          <span class="cat-card-dur">${duracao}</span>
        </div>
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
    nome: '', descricao: '', preco_original: '', duracao_minutos: '',
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
  const wrap = document.getElementById('cat-form-wrap');
  if (!wrap) return;

  const titulo = _catEditandoId ? 'Editar Leitura' : 'Nova Leitura';
  const preview = t.imagem_url
    ? `<img src="${_catEsc(t.imagem_url)}" alt="" class="cat-form-preview">`
    : `<div class="cat-form-preview cat-form-preview--placeholder">✦</div>`;

  const opt = (val, lbl, sel) => `<option value="${val}"${sel === val ? ' selected' : ''}>${lbl}</option>`;

  wrap.innerHTML = `
    <div class="cat-form">
      <div class="cat-form-header">
        <h3>${titulo}</h3>
        <button class="cat-form-close" onclick="cat_fecharForm()" aria-label="Fechar">×</button>
      </div>

      <div class="cat-form-foto-row">
        <div id="cat-preview-wrap">${preview}</div>
        <div class="cat-form-foto-acoes">
          <label class="ag-btn ag-btn-outline ag-btn-sm cat-upload-btn">
            ${t.imagem_url ? 'Trocar foto' : 'Escolher foto'}
            <input type="file" id="cat-input-foto" accept="image/*" hidden>
          </label>
          ${t.imagem_url ? `<button class="ag-btn ag-btn-outline ag-btn-sm" onclick="cat_removerFoto()" style="color:#B91C1C">Remover</button>` : ''}
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

      <div class="cat-form-row">
        <div class="ag-form-group">
          <label for="cat-preco">Preço (R$)</label>
          <input type="number" id="cat-preco" value="${t.preco_original ?? ''}" min="0" step="0.01">
        </div>
        <div class="ag-form-group">
          <label for="cat-dur">Duração (min)</label>
          <input type="number" id="cat-dur" value="${t.duracao_minutos ?? ''}" min="1" step="1">
        </div>
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
          <label for="cat-ordem">Ordem</label>
          <input type="number" id="cat-ordem" value="${t.ordem ?? 100}" min="0" step="1">
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
      </div>

      <div class="cat-form-actions">
        <button class="ag-btn ag-btn-outline ag-btn-sm" onclick="cat_fecharForm()">Cancelar</button>
        <button class="ag-btn ag-btn-primary ag-btn-sm" id="cat-btn-salvar" onclick="_catSalvar()">Salvar</button>
      </div>
    </div>
  `;

  document.getElementById('cat-input-foto')?.addEventListener('change', _catPreviewArquivo);

  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const wrap = document.getElementById('cat-form-wrap');
  if (wrap) wrap.innerHTML = '';
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
  const duracao   = parseInt(document.getElementById('cat-dur')?.value, 10);
  const terapeuta = document.getElementById('cat-terapeuta')?.value || null;
  const ordem     = parseInt(document.getElementById('cat-ordem')?.value, 10) || 100;
  const especial  = document.querySelector('input[name="cat-agenda"]:checked')?.value === 'especial';
  const requer    = document.getElementById('cat-pergunta')?.checked || false;

  if (!nome)                          { _toastAdmin('Informe o nome.', 'erro'); return; }
  if (isNaN(preco) || preco < 0)      { _toastAdmin('Preço inválido.', 'erro'); return; }
  if (isNaN(duracao) || duracao <= 0) { _toastAdmin('Duração inválida.', 'erro'); return; }
  if (!terapeuta)                     { _toastAdmin('Selecione um terapeuta.', 'erro'); return; }

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
      duracao_minutos: duracao,
      imagem_url,
      slug,
      terapeuta,
      ordem,
      especial,
      requer_pergunta: requer,
    };

    if (_catEditandoId) {
      const { error } = await supabase.from('tipos_leitura').update(payload).eq('id', _catEditandoId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('tipos_leitura').insert(payload);
      if (error) throw error;
    }

    _toastAdmin('✅ Salvo com sucesso!', 'ok');
    cat_fecharForm();
    await inicializarCatalogo();
  } catch (e) {
    _toastAdmin('Erro ao salvar: ' + (e.message || e), 'erro');
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  }
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
  const { error } = await supabase
    .from('tipos_leitura')
    .update({ ativo: true })
    .eq('id', id);
  if (error) {
    _toastAdmin('Erro: ' + error.message, 'erro');
    return;
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
