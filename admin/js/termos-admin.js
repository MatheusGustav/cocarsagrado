/* ============================================================
   COCAR SAGRADO — Admin: Termos por link
   Cliente que agenda pelo zap (não usa o site) recebe um link
   /aceite?t=TOKEN só pra aceitar os Termos — pagamento e agenda
   continuam por fora. Tabela public.termos_aceites (RLS: admin;
   cliente passa pelas RPCs aceite_info/aceitar_termos_link).
   ============================================================ */

let _taCache = [];

function _taEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// timestamptz -> 'DD/MM/AAAA HH:mm' no fuso de SP
function _taDataBR(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  });
}

// Mesmo alfabeto sem confundíveis da chave_pedido; 12 chars CSPRNG
// (~60 bits) — o token é o segredo do link, não pode ser chutável.
function _taGerarToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => chars[v % chars.length]).join('');
}

// Painel local (file:// ou localhost) gera link do próprio host se
// tiver servidor; senão cai no domínio real (mesmo banco de prod).
function _taLink(token) {
  const base = location.protocol.startsWith('http')
    ? location.origin
    : 'https://cocarsagrado.com.br';
  return `${base}/aceite?t=${token}`;
}

function _taZapUrl(rec) {
  let fone = String(rec.cliente_whatsapp || '').replace(/\D/g, '');
  if (!fone) return null;
  if (fone.length <= 11) fone = `55${fone}`;
  const primeiro = String(rec.cliente_nome).trim().split(/\s+/)[0];
  const msg = `Oi ${primeiro}! 🙏 Pra gente confirmar sua consulta no Cocar Sagrado, `
    + `toque no link abaixo e depois toque no botão verde escrito "LI E ACEITO":\n\n${_taLink(rec.token)}`;
  return `https://wa.me/${fone}?text=${encodeURIComponent(msg)}`;
}

async function _taCopiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Webview sem clipboard API: textarea + execCommand
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* segue false */ }
    ta.remove();
    return ok;
  }
}

// ============================================================
// Carregar + renderizar
// ============================================================
async function inicializarTermosLink() {
  const container = document.getElementById('termos-container');
  if (!container) return;

  container.innerHTML = `
    <p class="ta-explica">Pra quem agenda pelo zap e não consegue usar o site: gere um link
      só de <strong>aceite dos Termos</strong> e mande no WhatsApp. O cliente toca num botão
      verde e o aceite fica registrado aqui (versão, data, IP). Pagamento segue por fora.</p>
    <div class="cup-form">
      <div class="cup-form-row">
        <label class="cup-campo cup-campo-desc">
          <span>Nome do cliente</span>
          <input type="text" id="ta-novo-nome" class="cup-input" placeholder="ex: Maria da Silva" maxlength="80" autocomplete="off">
        </label>
        <label class="cup-campo" title="Preenchido = botão de mandar direto no zap do cliente">
          <span>WhatsApp (opcional)</span>
          <input type="tel" id="ta-novo-zap" class="cup-input" placeholder="(27) 99999-9999" maxlength="20" autocomplete="off">
        </label>
        <button class="ag-btn ag-btn-primary cup-btn-add" id="ta-btn-add" onclick="criarTermoLink()"><svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Gerar link</button>
        <button class="ag-btn ag-btn-outline ag-btn-sm" id="ta-btn-refresh" onclick="carregarTermosLinks()" title="Atualizar a lista"><svg class="ico" aria-hidden="true"><use href="#ico-atualizar"></use></svg> Atualizar</button>
      </div>
    </div>
    <div id="ta-lista" style="margin-top:20px;">
      <div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>
    </div>`;

  await carregarTermosLinks();
}

async function carregarTermosLinks() {
  const lista = document.getElementById('ta-lista');
  if (!lista) return;

  const { data, error } = await supabase
    .from('termos_aceites')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar os links.</div>';
    console.error('carregarTermosLinks:', error);
    return;
  }

  _taCache = data || [];
  _renderTermosLinks();
}

function _renderTermosLinks() {
  const lista = document.getElementById('ta-lista');
  if (!lista) return;

  if (!_taCache.length) {
    lista.innerHTML = '<div class="ag-empty" style="margin-top:16px">Nenhum link gerado ainda.</div>';
    return;
  }

  lista.innerHTML = '';
  _taCache.forEach((rec) => {
    const zapUrl = _taZapUrl(rec);
    const card = document.createElement('div');
    card.className = 'cup-card';
    card.innerHTML = `
      <div class="cup-card-info">
        <span class="cup-card-codigo">${_taEsc(rec.cliente_nome)}</span>
        ${rec.aceito_em
          ? `<span class="ta-chip ta-chip--ok"><svg class="ico" aria-hidden="true"><use href="#ico-check"></use></svg> Aceito em ${_taDataBR(rec.aceito_em)} · v${_taEsc(rec.termos_versao)}</span>`
          : `<span class="ta-chip ta-chip--pend"><svg class="ico" aria-hidden="true"><use href="#ico-ampulheta"></use></svg> Aguardando aceite</span>`}
        ${rec.cliente_whatsapp ? `<span class="cup-card-desc">${_taEsc(rec.cliente_whatsapp)}</span>` : ''}
        <span class="cup-card-desc">Criado em ${_taDataBR(rec.criado_em)}</span>
        <span class="ta-link-url">${_taEsc(_taLink(rec.token))}</span>
      </div>
      <div class="cup-card-acoes">
        <button class="ag-btn ag-btn-outline ag-btn-sm ta-btn-copiar">Copiar link</button>
        ${zapUrl ? `<a class="ag-btn ag-btn-outline ag-btn-sm" href="${_taEsc(zapUrl)}" target="_blank" rel="noopener"><svg class="ico" aria-hidden="true"><use href="#ico-balao"></use></svg> Zap</a>` : ''}
        <button class="ag-btn ag-btn-outline ag-btn-sm ta-btn-del" style="color:var(--t-danger)" title="Apagar link" aria-label="Apagar link"><svg class="ico" aria-hidden="true"><use href="#ico-lixeira"></use></svg></button>
      </div>`;

    const btnCopiar = card.querySelector('.ta-btn-copiar');
    btnCopiar.addEventListener('click', async () => {
      const ok = await _taCopiar(_taLink(rec.token));
      if (ok) {
        btnCopiar.textContent = 'Copiado ✓';
        setTimeout(() => { btnCopiar.textContent = 'Copiar link'; }, 1500);
      } else {
        _toastAdmin('Não consegui copiar — copie manualmente o link do card.', 'erro');
      }
    });
    card.querySelector('.ta-btn-del').addEventListener('click', () => _deletarTermoLink(rec, card));
    lista.appendChild(card);
  });
}

// ============================================================
// Criar / deletar
// ============================================================
async function criarTermoLink() {
  const inNome = document.getElementById('ta-novo-nome');
  const inZap  = document.getElementById('ta-novo-zap');
  const btn    = document.getElementById('ta-btn-add');

  const nome = (inNome?.value || '').trim();
  const zap  = (inZap?.value || '').trim() || null;

  if (!nome) { _toastAdmin('Digite o nome do cliente.', 'erro'); return; }

  btn.disabled = true;
  btn.textContent = 'Gerando...';

  // Colisão de token é loteria (60 bits), mas o UNIQUE garante — retenta.
  let token = null, error = null;
  for (let i = 0; i < 3; i++) {
    token = _taGerarToken();
    ({ error } = await supabase
      .from('termos_aceites')
      .insert({ token, cliente_nome: nome, cliente_whatsapp: zap }));
    if (!error || !/duplicate|unique/i.test(error.message)) break;
  }

  btn.disabled = false;
  btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Gerar link';

  if (error) {
    _toastAdmin(error.message, 'erro');
    return;
  }

  inNome.value = '';
  if (inZap) inZap.value = '';
  const copiou = await _taCopiar(_taLink(token));
  await carregarTermosLinks();
  _toastAdmin(copiou ? 'Link criado e copiado! É só colar no zap.' : 'Link criado!', 'ok');
}

async function _deletarTermoLink(rec, card) {
  const aviso = rec.aceito_em
    ? `${rec.cliente_nome} JÁ ACEITOU os termos — apagar remove a PROVA do aceite. Apagar mesmo assim?`
    : `Apagar o link de ${rec.cliente_nome}? Ele vai parar de funcionar.`;
  if (!confirm(aviso)) return;

  const { error } = await supabase
    .from('termos_aceites')
    .delete()
    .eq('id', rec.id);

  if (error) {
    _toastAdmin('Erro ao apagar: ' + error.message, 'erro');
    return;
  }
  card.remove();
  _taCache = _taCache.filter((r) => r.id !== rec.id);
  if (!_taCache.length) _renderTermosLinks();
}
