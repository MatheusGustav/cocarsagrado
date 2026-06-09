/* ============================================================
   DESCONTOS — Painel Admin
   Lê/salva em supabase.configuracoes WHERE chave = 'descontos'.
   Serviços (promoções) vêm dinamicamente de public.tipos_leitura,
   agrupados por grupo_slug (igual ao site).
   ============================================================ */

let _descConfig = null;

async function inicializarDescontos() {
  const container = document.getElementById('descontos-container');
  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  try {
    const [leiturasResp, configResp] = await Promise.all([
      supabase.from('tipos_leitura')
        .select('id, nome, slug, grupo_slug, tier_label, preco_original, ordem, terapeuta')
        .eq('ativo', true)
        .order('ordem')
        .order('nome'),
      supabase.from('configuracoes')
        .select('valor')
        .eq('chave', 'descontos')
        .maybeSingle(),
    ]);

    if (leiturasResp.error) throw leiturasResp.error;

    const valor = configResp?.data?.valor || { promocoes: [] };
    _descConfig = _descMergeComMeta(leiturasResp.data || [], valor);
  } catch (e) {
    console.error('Erro ao carregar descontos:', e);
    _descConfig = _descMergeComMeta([], { promocoes: [] });
  }

  _descRenderizar();
}

/* Constrói a lista de serviços (single + grupos com tiers) a partir das
   linhas brutas de tipos_leitura. Mesma lógica do site (js/agendamento-system.js)
   pra manter consistência: itens com grupo_slug viram um único cartão com tiers. */
function _descAgruparServicos(linhas) {
  const grupos = new Map();
  const lista  = [];

  for (const t of linhas) {
    if (t.grupo_slug) {
      if (!grupos.has(t.grupo_slug)) {
        const item = {
          id:       t.grupo_slug,
          tipo:     'tiers',
          ordem:    t.ordem ?? 100,
          principal: t,
          tiers:    [],
        };
        grupos.set(t.grupo_slug, item);
        lista.push(item);
      }
      grupos.get(t.grupo_slug).tiers.push(t);
    } else if (t.slug) {
      lista.push({
        id:    t.slug,
        nome:  t.nome,
        tipo:  'simples',
        preco: Number(t.preco_original),
        ordem: t.ordem ?? 100,
      });
    }
    // Linhas sem slug nem grupo_slug não têm identidade estável → ignoradas
  }

  // Finaliza grupos: ordena tiers por preço (igual ao site) e calcula nome base
  for (const g of grupos.values()) {
    g.tiers.sort((a, b) => Number(a.preco_original) - Number(b.preco_original));
    g.nome  = _descNomeGrupo(g.principal);
    g.tiers = g.tiers.map(t => ({
      label: t.tier_label || t.nome,
      preco: Number(t.preco_original),
    }));
  }

  // Ordem global por `ordem`, depois nome
  lista.sort((a, b) => (a.ordem - b.ordem) || a.nome.localeCompare(b.nome));
  return lista;
}

function _descNomeGrupo(principal) {
  if (!principal.tier_label) return principal.nome;
  const sep = principal.nome.indexOf(' – ');
  return sep > 0 ? principal.nome.slice(0, sep) : principal.nome;
}

function _descMergeComMeta(linhas, valor) {
  const itens    = _descAgruparServicos(linhas);
  const salvoMap = {};
  (valor.promocoes || []).forEach(p => { salvoMap[p.id] = p; });

  const promocoes = itens.map(meta => ({
    id:                 meta.id,
    nome:               meta.nome,
    tipo:               meta.tipo,
    ...(meta.tipo === 'tiers' ? { tiers: meta.tiers } : { preco: meta.preco }),
    descontoAtivo:      salvoMap[meta.id]?.descontoAtivo      ?? false,
    percentualDesconto: salvoMap[meta.id]?.percentualDesconto ?? 0,
    badge:              salvoMap[meta.id]?.badge              ?? '',
  }));

  return { promocoes };
}

function _descFmt(preco, pct) {
  const v = Math.round(preco * (100 - pct)) / 100;
  return Number.isInteger(v) ? `R$ ${v}` : `R$ ${v.toFixed(2).replace('.', ',')}`;
}

function _descPrecoOrig(s) {
  if (s.tipo === 'tiers') return s.tiers.map(t => `R$ ${t.preco}`).join(' · ');
  return `R$ ${s.preco}`;
}

function _descPrecoComDesc(s, pct) {
  if (!pct) return null;
  if (s.tipo === 'tiers') return s.tiers.map(t => _descFmt(t.preco, pct)).join(' · ');
  return _descFmt(s.preco, pct);
}

function _descRenderizar() {
  const container = document.getElementById('descontos-container');
  if (!container || !_descConfig) return;

  const { promocoes } = _descConfig;

  container.innerHTML = `
    <div class="desc-bloco">
      <div class="desc-bloco-titulo">Promoções por Serviço</div>
      <div class="desc-grid">
        ${promocoes.map(_descCartaoServico).join('')}
      </div>
    </div>

    <div class="desc-salvar-bar">
      <button class="ag-btn ag-btn-copy" id="btn-salvar-descontos" onclick="salvarDescontos()">
        Salvar Alterações
      </button>
    </div>
  `;
}

function _descEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _descCartaoServico(s) {
  const orig = _descPrecoOrig(s);
  const desc = s.descontoAtivo ? _descPrecoComDesc(s, s.percentualDesconto) : null;
  const id   = _descEsc(s.id);

  return `
    <div class="desc-card" data-id="${id}">
      <div class="desc-card-header">
        <div>
          <div class="desc-card-nome">${_descEsc(s.nome)}</div>
          <div class="desc-card-preco-base">${orig}</div>
        </div>
        <label class="desc-toggle-wrap">
          <input type="checkbox" class="desc-svc-chk" data-id="${id}"
            ${s.descontoAtivo ? 'checked' : ''}
            onchange="desc_toggleServico('${id}', this.checked)">
          <span class="desc-toggle-track"><span class="desc-toggle-thumb"></span></span>
        </label>
      </div>
      <div class="desc-card-fields ${s.descontoAtivo ? '' : 'desc-fields-off'}" id="desc-fields-${id}">
        <div class="desc-fields-row">
          <div class="desc-field">
            <label>Desconto</label>
            <div class="desc-pct-row">
              <input type="number" class="desc-pct-input" min="1" max="99"
                value="${s.percentualDesconto || ''}" placeholder="–"
                data-id="${id}" oninput="desc_atualizarPreview('${id}')">
              <span class="desc-pct-sym">%</span>
            </div>
          </div>
          <div class="desc-field desc-field-badge">
            <label>Badge</label>
            <input type="text" class="desc-badge-input" maxlength="20"
              value="${_descEsc(s.badge || '')}" placeholder="ex: 20% OFF" data-id="${id}">
          </div>
        </div>
        <div class="desc-preview" id="desc-preview-${id}">
          ${desc ? `<span class="desc-prev-orig">${orig}</span><span class="desc-prev-novo">${desc}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function desc_toggleServico(id, ativo) {
  const fields = document.getElementById(`desc-fields-${id}`);
  if (fields) fields.classList.toggle('desc-fields-off', !ativo);
  desc_atualizarPreview(id);
}

function desc_atualizarPreview(id) {
  const card = document.querySelector(`.desc-card[data-id="${id}"]`);
  const preview = document.getElementById(`desc-preview-${id}`);
  if (!card || !preview) return;

  const ativo = card.querySelector('.desc-svc-chk')?.checked;
  const pct   = parseInt(card.querySelector('.desc-pct-input')?.value || '0', 10);
  const s     = _descConfig?.promocoes.find(p => p.id === id);
  if (!s) return;

  if (!ativo || !pct) { preview.innerHTML = ''; return; }

  const orig = _descPrecoOrig(s);
  const desc = _descPrecoComDesc(s, pct);
  preview.innerHTML = `<span class="desc-prev-orig">${orig}</span><span class="desc-prev-novo">${desc}</span>`;
}

async function salvarDescontos() {
  const btn = document.getElementById('btn-salvar-descontos');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const promocoes = (_descConfig?.promocoes || []).map(s => {
    const card = document.querySelector(`.desc-card[data-id="${s.id}"]`);
    if (!card) return s;
    const ativo  = card.querySelector('.desc-svc-chk')?.checked ?? false;
    const pct    = parseInt(card.querySelector('.desc-pct-input')?.value || '0', 10);
    const badge  = card.querySelector('.desc-badge-input')?.value?.trim() || '';
    return { ...s, descontoAtivo: ativo, percentualDesconto: ativo ? (pct || 0) : 0, badge: ativo ? badge : '' };
  });

  try {
    const { error } = await supabase
      .from('configuracoes')
      .upsert({ chave: 'descontos', valor: { promocoes } }, { onConflict: 'chave' });
    if (error) throw error;
    _descConfig = { promocoes };
    _toastAdmin('✅ Descontos salvos com sucesso!', 'ok');
  } catch (e) {
    _toastAdmin('Erro ao salvar: ' + (e.message || e), 'erro');
  }

  btn.disabled = false;
  btn.textContent = 'Salvar Alterações';
}
