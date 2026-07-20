/* ============================================================
   CATÁLOGO — Painel Admin
   CRUD em public.tipos_leitura + upload de fotos via /api/catalogo (Cloudflare R2)
   ============================================================ */

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

// Agrupa tiers (mesmo grupo_slug) num card só — espelha o site.
// O banco continua com 1 linha por tier; só a exibição muda.
function _catAgrupar(lista) {
  const itens = [];
  const grupos = new Map();
  for (const t of lista) {
    if (t.grupo_slug) {
      if (!grupos.has(t.grupo_slug)) {
        const g = { kind: 'grupo', slug: t.grupo_slug, tiers: [] };
        grupos.set(t.grupo_slug, g);
        itens.push(g);
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

// Inativas ficam ocultas por padrão; o botão da topbar revela
// (continuam no banco — só saem da vista).
let _catMostrarInativas = false;

function cat_toggleInativas() {
  _catMostrarInativas = !_catMostrarInativas;
  _catRenderizar();
}

// Ordem dos blocos = ordem dos terapeutas na config (listaTerapeutas).
function _catOrdemTerapeutas() {
  const list = (typeof listaTerapeutas === 'function')
    ? listaTerapeutas()
    : [{ id: 'matheus' }, { id: 'camila' }];
  return list.map(t => t.id);
}
function _catBlockIdx(terapeuta) {
  const i = _catOrdemTerapeutas().indexOf(terapeuta);
  return i === -1 ? _catOrdemTerapeutas().length : i;
}
// Próxima ordem livre no fim do bloco do terapeuta (base = blockIdx*1000).
function _catOrdemFimBloco(terapeuta) {
  const base = _catBlockIdx(terapeuta) * 1000;
  const ativos = _catCache.filter(x => x.terapeuta === terapeuta && x.ativo !== false);
  const maxOrd = ativos.reduce((m, x) => Math.max(m, Number(x.ordem) || 0), 0);
  return Math.max(maxOrd, base) + 10;
}

function _catRenderizar() {
  const container = document.getElementById('catalogo-container');
  if (!container) return;

  const inativas = _catCache.filter(t => t.ativo === false).length;
  const totalVisiveis = (_catMostrarInativas
    ? _catCache
    : _catCache.filter(t => t.ativo !== false)).length;

  const btnInativas = inativas > 0
    ? `<button class="ag-btn ag-btn-outline ag-btn-sm" onclick="cat_toggleInativas()">
         ${_catMostrarInativas ? 'Ocultar inativas' : `Mostrar inativas (${inativas})`}
       </button>`
    : '';

  // Ordena os blocos: terapeutas da config primeiro, depois quaisquer outros / "sem terapeuta".
  const ordemTer  = _catOrdemTerapeutas();
  const presentes = [...new Set(_catCache.map(t => t.terapeuta || '—'))];
  const blocos    = [
    ...ordemTer.filter(id => presentes.includes(id)),
    ...presentes.filter(id => !ordemTer.includes(id)),
  ];

  let html = `
    <div class="cat-topbar">
      <button class="ag-btn ag-btn-primary ag-btn-sm" onclick="cat_abrirFormNovo()"><svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Nova Leitura</button>
      ${btnInativas}
      <span class="cat-count">${totalVisiveis} leitura${totalVisiveis === 1 ? '' : 's'}</span>
    </div>
    <p class="cat-dnd-dica"><svg class="ico" aria-hidden="true"><use href="#ico-arrastar"></use></svg> Arraste pela alça para reordenar dentro de cada terapeuta. A ordem do site reflete isto.</p>
  `;

  for (const ter of blocos) {
    const nome = ter === '—'
      ? 'Sem terapeuta'
      : (typeof terapeutaNome === 'function' ? terapeutaNome(ter) : ter);
    const doTer    = _catCache.filter(t => (t.terapeuta || '—') === ter);
    const ativos   = doTer.filter(t => t.ativo !== false).slice().sort(_catCmpOrdem);
    const inativos = doTer.filter(t => t.ativo === false);

    const cardsAtivos = _catAgrupar(ativos)
      .map(it => it.kind === 'grupo' ? _catCardGrupo(it, true) : _catCard(it.tipo, true))
      .join('') || '<p class="cat-bloco-vazio">Nenhuma leitura ativa.</p>';

    let inativosHtml = '';
    if (_catMostrarInativas && inativos.length) {
      inativosHtml = `
        <div class="cat-inativas-bloco">
          ${_catAgrupar(inativos).map(it => it.kind === 'grupo' ? _catCardGrupo(it, false) : _catCard(it.tipo, false)).join('')}
        </div>`;
    }

    html += `
      <div class="cat-bloco">
        <h3 class="cat-bloco-titulo">${_catEsc(nome)} <span class="cat-bloco-count">${ativos.length}</span></h3>
        <div class="cat-drag-list" data-terapeuta="${_catEsc(ter)}">
          ${cardsAtivos}
        </div>
        ${inativosHtml}
      </div>`;
  }

  container.innerHTML = html;
  _catWireDnD();
}

// ============================================================
// Drag-and-drop: reordena cards DENTRO de cada terapeuta.
// A alça de arrastar ativa o draggable; soltar persiste a nova ordem.
// ============================================================
function _catDragAfter(container, y) {
  const els = [...container.querySelectorAll('.cat-card[data-card-kind]:not(.dragging)')];
  let closest = { offset: -Infinity, el: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
  }
  return closest.el;
}

function _catWireDnD() {
  document.querySelectorAll('.cat-drag-list').forEach(container => {
    container.addEventListener('dragover', e => {
      const dragging = document.querySelector('.cat-card.dragging');
      // só reordena no mesmo terapeuta (trocar terapeuta é via modal)
      if (!dragging || dragging.parentElement !== container) return;
      e.preventDefault();
      const after = _catDragAfter(container, e.clientY);
      if (!after) container.appendChild(dragging);
      else container.insertBefore(dragging, after);
    });
    container.addEventListener('drop', e => {
      const dragging = document.querySelector('.cat-card.dragging');
      if (!dragging || dragging.parentElement !== container) return;
      e.preventDefault();
      _catPersistirOrdem(container);
    });
  });

  document.querySelectorAll('.cat-card[data-card-kind]').forEach(card => {
    const handle = card.querySelector('.cat-drag-handle');
    if (!handle) return;
    const ativar = () => { card.draggable = true; };
    handle.addEventListener('mousedown', ativar);
    handle.addEventListener('touchstart', ativar, { passive: true });
    card.addEventListener('dragstart', e => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', card.dataset.cardId || card.dataset.cardGrupo || ''); } catch {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.draggable = false;
    });
  });
}

// Persiste a ordem dos cards de um terapeuta: ordem = blockIdx*1000 + pos*10.
// Grupos: todos os tiers recebem a mesma ordem (ficam contíguos no site).
async function _catPersistirOrdem(container) {
  const terapeuta = container.dataset.terapeuta;
  const base = _catBlockIdx(terapeuta) * 1000;
  const cards = [...container.querySelectorAll('.cat-card[data-card-kind]')];

  const updates = [];
  cards.forEach((card, i) => {
    const ordem = base + (i + 1) * 10;
    if (card.dataset.cardKind === 'single') {
      updates.push({ id: Number(card.dataset.cardId), ordem });
    } else {
      const slug = card.dataset.cardGrupo;
      _catCache.filter(x => x.grupo_slug === slug).forEach(t => updates.push({ id: t.id, ordem }));
    }
  });

  try {
    await Promise.all(updates.map(u =>
      supabase.from('tipos_leitura').update({ ordem: u.ordem }).eq('id', u.id)
    ));
    updates.forEach(u => { const it = _catCache.find(x => x.id === u.id); if (it) it.ordem = u.ordem; });
    _toastAdmin('Ordem salva', 'ok');
  } catch (e) {
    _toastAdmin('Erro ao salvar ordem: ' + (e.message || e), 'erro');
    inicializarCatalogo(); // recarrega o estado real
  }
}

const _CAT_BADGE_LABEL = { buzios: 'Búzios', cartas: 'Cartas', radiestesia: 'Radiestesia' };

// Card de grupo: 1 card com as variações (tiers) listadas dentro,
// cada uma com Editar/Excluir próprios.
function _catCardGrupo(g, arrastavel = false) {
  const p = g.tiers[0];
  const sep  = p.nome.indexOf(' – ');
  const nome = (p.tier_label && sep > 0) ? p.nome.slice(0, sep) : p.nome;
  const todosInativos = g.tiers.every(t => t.ativo === false);
  const dragAttrs = arrastavel ? `data-card-kind="grupo" data-card-grupo="${_catEsc(g.slug)}"` : '';
  const handle    = arrastavel ? `<span class="cat-drag-handle" title="Arraste para reordenar" aria-hidden="true"><svg class="ico" aria-hidden="true"><use href="#ico-arrastar"></use></svg></span>` : '';

  const terapeutaTag = p.terapeuta
    ? `<span class="cat-card-terapeuta">${_CAT_TERAPEUTA_LABEL[p.terapeuta] || p.terapeuta}</span>`
    : `<span class="cat-card-terapeuta cat-card-terapeuta--missing">sem terapeuta</span>`;
  const img = p.imagem_url
    ? `<img src="${_catEsc(p.imagem_url)}" alt="${_catEsc(nome)}" class="cat-card-foto">`
    : `<div class="cat-card-foto cat-card-foto--placeholder"><svg class="ico" aria-hidden="true"><use href="#ico-semente"></use></svg></div>`;

  const tierRows = g.tiers.map(t => {
    const inativo = t.ativo === false;
    const label   = t.tier_label || t.nome;
    const preco   = `R$ ${Number(t.preco_original || 0).toFixed(2).replace('.', ',')}`;
    const acoes   = inativo
      ? `<button class="cat-tier-btn" onclick="cat_reativar(${t.id})">Reativar</button>
         <button class="cat-tier-btn cat-tier-btn--danger" onclick="cat_excluir(${t.id})">Excluir</button>`
      : `<button class="cat-tier-btn" onclick="cat_abrirFormEditar(${t.id})">Editar</button>
         <button class="cat-tier-btn cat-tier-btn--danger" onclick="cat_excluir(${t.id})">Excluir</button>`;
    return `
      <div class="cat-tier-row${inativo ? ' cat-tier-row--inativa' : ''}">
        <span class="cat-tier-info">${_catEsc(label)}${inativo ? ' <span class="cat-card-inativo">inativa</span>' : ''}</span>
        <span class="cat-tier-preco">${preco}</span>
        <span class="cat-tier-acoes">${acoes}</span>
      </div>`;
  }).join('');

  return `
    <div class="cat-card${todosInativos ? ' cat-card--inativo' : ''}" data-grupo="${_catEsc(g.slug)}" ${dragAttrs}>
      ${handle}
      ${img}
      <div class="cat-card-info">
        <div class="cat-card-nome">${_catEsc(nome)}</div>
        <span class="cat-card-grupo-tag">${g.tiers.length} variações</span>
        ${terapeutaTag}
      </div>
      <div class="cat-tier-list">${tierRows}</div>
    </div>
  `;
}

function _catCard(t, arrastavel = false) {
  const preco    = `R$ ${Number(t.preco_original || 0).toFixed(2).replace('.', ',')}`;
  const inativo  = t.ativo === false;
  const dragAttrs = arrastavel ? `data-card-kind="single" data-card-id="${t.id}"` : '';
  const handle    = arrastavel ? `<span class="cat-drag-handle" title="Arraste para reordenar" aria-hidden="true"><svg class="ico" aria-hidden="true"><use href="#ico-arrastar"></use></svg></span>` : '';
  const terapeutaTag = t.terapeuta
    ? `<span class="cat-card-terapeuta">${_CAT_TERAPEUTA_LABEL[t.terapeuta] || t.terapeuta}</span>`
    : `<span class="cat-card-terapeuta cat-card-terapeuta--missing">sem terapeuta</span>`;
  const badgeTag = t.badge
    ? `<span class="cat-card-badge cat-card-badge--${t.badge}"><svg class="ico" aria-hidden="true"><use href="#ico-ponto"></use></svg> ${_CAT_BADGE_LABEL[t.badge] || t.badge}</span>`
    : '';
  const inativoTag = inativo
    ? `<span class="cat-card-inativo">inativa</span>`
    : '';
  const img      = t.imagem_url
    ? `<img src="${_catEsc(t.imagem_url)}" alt="${_catEsc(t.nome)}" class="cat-card-foto">`
    : `<div class="cat-card-foto cat-card-foto--placeholder"><svg class="ico" aria-hidden="true"><use href="#ico-semente"></use></svg></div>`;

  const acoes = inativo
    ? `<button class="ag-btn ag-btn-primary ag-btn-sm" onclick="cat_reativar(${t.id})">Reativar</button>
       <button class="ag-btn ag-btn-danger ag-btn-sm" onclick="cat_excluir(${t.id})">Excluir</button>`
    : `<button class="ag-btn ag-btn-outline ag-btn-sm" onclick="cat_abrirFormEditar(${t.id})">Editar</button>
       <button class="ag-btn ag-btn-danger ag-btn-sm" onclick="cat_excluir(${t.id})">Excluir</button>`;

  return `
    <div class="cat-card${inativo ? ' cat-card--inativo' : ''}" data-id="${t.id}" ${dragAttrs}>
      ${handle}
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
    modalidade: 'mensagem',
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
    : `<div class="cat-form-preview cat-form-preview--placeholder"><svg class="ico" aria-hidden="true"><use href="#ico-semente"></use></svg></div>`;

  const opt = (val, lbl, sel) => `<option value="${val}"${sel === val ? ' selected' : ''}>${lbl}</option>`;

  const overlay = document.createElement('div');
  overlay.id = 'cat-modal';
  overlay.className = 'agenda-modal-overlay';
  overlay.innerHTML = `
    <div class="agenda-modal-container cat-modal-container" role="dialog" aria-modal="true" aria-labelledby="cat-modal-titulo">
      <div class="agenda-modal-header">
        <h3 class="agenda-modal-titulo" id="cat-modal-titulo">${titulo}</h3>
        <button class="agenda-modal-fechar" type="button" onclick="cat_fecharForm()" aria-label="Fechar"><svg class="ico" aria-hidden="true"><use href="#ico-fechar"></use></svg></button>
      </div>
      <div class="agenda-modal-body">
        <div class="cat-form-foto-row">
          <div id="cat-preview-wrap">${preview}</div>
          <div class="cat-form-foto-acoes">
            <label class="ag-btn ag-btn-outline ag-btn-sm cat-upload-btn">
              ${t.imagem_url ? 'Trocar foto' : 'Escolher foto'}
              <input type="file" id="cat-input-foto" accept="image/*" hidden>
            </label>
            ${t.imagem_url ? `<button class="ag-btn ag-btn-outline ag-btn-sm" type="button" onclick="cat_removerFoto()" style="color:var(--t-danger)">Remover</button>` : ''}
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
              <svg class="ico" aria-hidden="true"><use href="#ico-ponto"></use></svg> Búzios
            </label>
            <label class="cat-badge-opt cat-badge-opt--cartas">
              <input type="radio" name="cat-badge" value="cartas" ${t.badge === 'cartas' ? 'checked' : ''}>
              <svg class="ico" aria-hidden="true"><use href="#ico-ponto"></use></svg> Cartas
            </label>
            <label class="cat-badge-opt cat-badge-opt--radiestesia">
              <input type="radio" name="cat-badge" value="radiestesia" ${t.badge === 'radiestesia' ? 'checked' : ''}>
              <svg class="ico" aria-hidden="true"><use href="#ico-ponto"></use></svg> Radiestesia
            </label>
          </div>
        </div>

        <div class="ag-form-group">
          <label>Modalidade de atendimento</label>
          <div class="cat-badge-group">
            <label class="cat-badge-opt">
              <input type="radio" name="cat-modalidade" value="mensagem" ${(t.modalidade || 'mensagem') === 'mensagem' ? 'checked' : ''}>
              <svg class="ico" aria-hidden="true"><use href="#ico-balao"></use></svg> Mensagem
            </label>
            <label class="cat-badge-opt">
              <input type="radio" name="cat-modalidade" value="audio" ${t.modalidade === 'audio' ? 'checked' : ''}>
              <svg class="ico" aria-hidden="true"><use href="#ico-microfone"></use></svg> Áudio gravado
            </label>
            <label class="cat-badge-opt">
              <input type="radio" name="cat-modalidade" value="video" ${t.modalidade === 'video' ? 'checked' : ''}>
              <svg class="ico" aria-hidden="true"><use href="#ico-video"></use></svg> Vídeo-chamada
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
  if (wrap) wrap.innerHTML = `<div class="cat-form-preview cat-form-preview--placeholder"><svg class="ico" aria-hidden="true"><use href="#ico-semente"></use></svg></div>`;
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
  const especial  = document.querySelector('input[name="cat-agenda"]:checked')?.value === 'especial';
  const badge     = document.querySelector('input[name="cat-badge"]:checked')?.value || null;
  const modalidade = document.querySelector('input[name="cat-modalidade"]:checked')?.value || 'mensagem';
  const requer    = document.getElementById('cat-pergunta')?.checked || false;
  const numPergRaw = parseInt(document.getElementById('cat-num-perg')?.value, 10);
  const numPerg    = requer ? (Number.isFinite(numPergRaw) && numPergRaw > 0 ? Math.min(20, numPergRaw) : 1) : 0;

  if (!nome)                          { _toastAdmin('Informe o nome.', 'erro'); return; }
  if (isNaN(preco) || preco < 0)      { _toastAdmin('Preço inválido.', 'erro'); return; }
  if (!terapeuta)                     { _toastAdmin('Selecione um terapeuta.', 'erro'); return; }

  const btn = document.getElementById('cat-btn-salvar');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    let imagem_url;
    const atual = _catEditandoId ? _catCache.find(x => x.id === _catEditandoId) : null;

    if (_catArquivoNovo) {
      imagem_url = await _catUploadFoto(_catArquivoNovo);
      if (atual?.imagem_url) await _catRemoverArquivo(atual.imagem_url);
    } else if (_catImagemRemovida) {
      imagem_url = null;
      if (atual?.imagem_url) await _catRemoverArquivo(atual.imagem_url);
    } else {
      imagem_url = atual?.imagem_url ?? null;
    }

    const slug = atual?.slug || await _catSlugUnico(_catSlugify(nome));

    // Ordem: mantém a atual se segue no mesmo terapeuta; senão entra no fim
    // do bloco (novo ou trocou de terapeuta). A reordenação fina é por arrastar.
    const ordem = (atual && atual.terapeuta === terapeuta && atual.ordem != null)
      ? atual.ordem
      : _catOrdemFimBloco(terapeuta);

    const payload = {
      nome,
      descricao:       desc,
      preco_original:  preco,
      imagem_url,
      slug,
      terapeuta,
      ordem,
      especial,
      badge:           badge || null,
      modalidade,
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

    _toastAdmin('Salvo com sucesso!', 'ok');
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

  _toastAdmin('Leitura excluída.', 'ok');
  await inicializarCatalogo();
}

async function cat_reativar(id) {
  const t = _catCache.find(x => x.id === id);

  // Reativa e joga pro fim do bloco do terapeuta (ordem livre no fim).
  const novaOrdem = t?.terapeuta ? _catOrdemFimBloco(t.terapeuta) : undefined;
  const patch = novaOrdem != null ? { ativo: true, ordem: novaOrdem } : { ativo: true };

  const { error } = await supabase
    .from('tipos_leitura')
    .update(patch)
    .eq('id', id);
  if (error) {
    _toastAdmin('Erro: ' + error.message, 'erro');
    return;
  }

  _toastAdmin('Leitura reativada.', 'ok');
  await inicializarCatalogo();
}

/* Converte a imagem p/ WebP no navegador (redimensiona p/ caber em maxLado).
   Mantém transparência. Se o navegador não suportar, devolve o arquivo original. */
async function _catParaWebp(file, maxLado = 800, qualidade = 0.82) {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', qualidade));
    if (!blob || blob.type !== 'image/webp') return file;   // navegador sem WebP → original
    return new File([blob], 'foto.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

/* Sobe a foto pro R2 via Pages Function autenticada. Retorna a URL pública (CDN). */
async function _catUploadFoto(file) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada — faça login novamente.');
  const enviar = await _catParaWebp(file);
  const fd = new FormData();
  fd.append('file', enviar);
  const res = await fetch('/api/catalogo/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: fd,
  });
  if (!res.ok) {
    let msg = `Upload falhou (${res.status}).`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const { url } = await res.json();
  return url;
}

/* Extrai a chave (uuid.ext) de uma URL do CDN R2. */
function _catChaveDaUrl(url) {
  try { return new URL(url).pathname.replace(/^\/+/, '') || null; }
  catch { return null; }
}

async function _catRemoverArquivo(url) {
  try {
    const key = _catChaveDaUrl(url);
    if (!key) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch('/api/catalogo/delete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key }),
    });
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
