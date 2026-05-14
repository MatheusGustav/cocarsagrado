/* ============================================================
   DESCONTOS — Painel Admin
   Lê/salva em supabase.configuracoes WHERE chave = 'descontos'
   ============================================================ */

const _DESC_SERVICOS_META = [
  { id: 'conselho',             nome: 'Conselho',                tipo: 'simples', preco: 20  },
  { id: 'buzios-avulso',        nome: 'Búzios Avulso',          tipo: 'tiers',   tiers: [{label:'1 pergunta',preco:30},{label:'2 perguntas',preco:50},{label:'3 perguntas',preco:70}] },
  { id: 'combo-10',             nome: 'Combo + 10',              tipo: 'simples', preco: 150 },
  { id: 'buzios-completo',      nome: 'Búzios Completo',         tipo: 'simples', preco: 200 },
  { id: 'confirmacao-orixas',   nome: 'Confirmação de Orixás',   tipo: 'simples', preco: 50  },
  { id: 'cabala-odu',           nome: 'Cabala de Odu',           tipo: 'simples', preco: 50  },
  { id: 'confirmacao-exu',      nome: 'Confirmação de Exu',      tipo: 'simples', preco: 70  },
  { id: 'mesa-cigana-avulsa',   nome: 'Mesa Cigana Avulsa',      tipo: 'tiers',   tiers: [{label:'1 pergunta',preco:30},{label:'2 perguntas',preco:50},{label:'3 perguntas',preco:70}] },
  { id: 'mesa-cigana-completa', nome: 'Mesa Cigana Completa',    tipo: 'simples', preco: 150 },
  { id: 'aguas-oxum',           nome: 'Águas de Oxum',           tipo: 'simples', preco: 50  },
  { id: 'rosa-venus',           nome: 'Rosa de Vênus',           tipo: 'simples', preco: 55  },
  { id: 'leitura-mentores',     nome: 'Leitura dos Mentores',    tipo: 'simples', preco: 50  },
  { id: 'mesa-mediunica',       nome: 'Mesa Mediúnica',          tipo: 'simples', preco: 70  },
  { id: 'mesa-radionica',       nome: 'Mesa Radiônica',          tipo: 'simples', preco: 222 },
  { id: 'registros-akashicos',  nome: 'Registros Akáshicos',     tipo: 'simples', preco: 188 },
  { id: 'theta-healing',        nome: 'Theta Healing',           tipo: 'simples', preco: 150 },
];

let _descConfig = null;

async function inicializarDescontos() {
  const container = document.getElementById('descontos-container');
  container.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('valor')
      .eq('chave', 'descontos')
      .single();

    if (error && error.code === 'PGRST116') {
      _descConfig = await _descConfigDoJSON();
    } else if (error) {
      throw error;
    } else {
      _descConfig = _descMergeComMeta(data.valor);
    }
  } catch {
    _descConfig = await _descConfigDoJSON();
  }

  _descRenderizar();
}

function _descMergeComMeta(valor) {
  const salvoMap = {};
  (valor.promocoes || []).forEach(p => { salvoMap[p.id] = p; });

  const promocoes = _DESC_SERVICOS_META.map(meta => ({
    id: meta.id,
    nome: meta.nome,
    tipo: meta.tipo,
    ...(meta.tipo === 'tiers' ? { tiers: meta.tiers } : { preco: meta.preco }),
    descontoAtivo:      salvoMap[meta.id]?.descontoAtivo      ?? false,
    percentualDesconto: salvoMap[meta.id]?.percentualDesconto ?? 0,
    badge:              salvoMap[meta.id]?.badge              ?? '',
  }));

  return {
    desconto10Habilitado: valor.desconto10Habilitado ?? true,
    promocoes,
  };
}

async function _descConfigDoJSON() {
  try {
    const r = await fetch('../data/promocoes.json');
    if (!r.ok) throw new Error();
    const d = await r.json();
    return _descMergeComMeta({ desconto10Habilitado: true, promocoes: d.promocoes || [] });
  } catch {
    return _descMergeComMeta({ desconto10Habilitado: true, promocoes: [] });
  }
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

  const { desconto10Habilitado, promocoes } = _descConfig;

  container.innerHTML = `
    <div class="desc-bloco">
      <div class="desc-bloco-titulo">Desconto de Boas-Vindas</div>
      <div class="desc-bv-card">
        <div class="desc-bv-info">
          <strong>10% OFF para novos visitantes</strong>
          <span>Exibe popup na primeira visita convidando o cliente a garantir 10% em todos os serviços. Desativado, o popup não aparece e nenhum cliente novo recebe o desconto.</span>
        </div>
        <label class="desc-toggle-wrap">
          <input type="checkbox" id="desc-toggle-10off" ${desconto10Habilitado ? 'checked' : ''}>
          <span class="desc-toggle-track"><span class="desc-toggle-thumb"></span></span>
          <span class="desc-toggle-txt" id="desc-label-10off">${desconto10Habilitado ? 'Ativo' : 'Inativo'}</span>
        </label>
      </div>
    </div>

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

  document.getElementById('desc-toggle-10off').addEventListener('change', function () {
    document.getElementById('desc-label-10off').textContent = this.checked ? 'Ativo' : 'Inativo';
  });
}

function _descCartaoServico(s) {
  const orig = _descPrecoOrig(s);
  const desc = s.descontoAtivo ? _descPrecoComDesc(s, s.percentualDesconto) : null;

  return `
    <div class="desc-card" data-id="${s.id}">
      <div class="desc-card-header">
        <div>
          <div class="desc-card-nome">${s.nome}</div>
          <div class="desc-card-preco-base">${orig}</div>
        </div>
        <label class="desc-toggle-wrap">
          <input type="checkbox" class="desc-svc-chk" data-id="${s.id}"
            ${s.descontoAtivo ? 'checked' : ''}
            onchange="desc_toggleServico('${s.id}', this.checked)">
          <span class="desc-toggle-track"><span class="desc-toggle-thumb"></span></span>
        </label>
      </div>
      <div class="desc-card-fields ${s.descontoAtivo ? '' : 'desc-fields-off'}" id="desc-fields-${s.id}">
        <div class="desc-fields-row">
          <div class="desc-field">
            <label>Desconto</label>
            <div class="desc-pct-row">
              <input type="number" class="desc-pct-input" min="1" max="99"
                value="${s.percentualDesconto || ''}" placeholder="–"
                data-id="${s.id}" oninput="desc_atualizarPreview('${s.id}')">
              <span class="desc-pct-sym">%</span>
            </div>
          </div>
          <div class="desc-field desc-field-badge">
            <label>Badge</label>
            <input type="text" class="desc-badge-input" maxlength="20"
              value="${s.badge || ''}" placeholder="ex: 20% OFF" data-id="${s.id}">
          </div>
        </div>
        <div class="desc-preview" id="desc-preview-${s.id}">
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

  const desconto10Habilitado = document.getElementById('desc-toggle-10off')?.checked ?? true;

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
      .upsert({ chave: 'descontos', valor: { desconto10Habilitado, promocoes } }, { onConflict: 'chave' });
    if (error) throw error;
    _descConfig = { desconto10Habilitado, promocoes };
    _toastAdmin('✅ Descontos salvos com sucesso!', 'ok');
  } catch (e) {
    _toastAdmin('Erro ao salvar: ' + (e.message || e), 'erro');
  }

  btn.disabled = false;
  btn.textContent = 'Salvar Alterações';
}
