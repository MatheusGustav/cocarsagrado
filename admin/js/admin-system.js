/* ============================================================
   COCAR SAGRADO — Painel Admin
   ============================================================ */

const WHATSAPP_TERAPEUTA = { matheus: '5528999476620', camila: '5527998528483' };

const STATUS_LABELS = {
  pendente:   'Pendente',
  pago:       'Pago',
  confirmado: 'Confirmado',
  atendido:   'Atendido',
  cancelado:  'Cancelado',
};

function _toastAdmin(msg, tipo) {
  const t = document.createElement('div');
  t.className = 'adm-toast adm-toast--' + (tipo || 'info');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('adm-toast--show'));
  setTimeout(() => {
    t.classList.remove('adm-toast--show');
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ============================================================
// Carregamento principal
// ============================================================
async function carregarAgendamentos() {
  const filtroStatus    = document.getElementById('filtro-status')?.value    || '';
  const filtroData      = document.getElementById('filtro-data')?.value      || '';
  const filtroTerapeuta = document.getElementById('filtro-terapeuta')?.value || '';
  const lista = document.getElementById('lista-agendamentos');
  if (!lista) return;

  lista.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div> Carregando...</div>';

  let query = supabase
    .from('agendamentos')
    .select('*, tipos_leitura(nome)')
    .order('data_agendamento', { ascending: false })
    .order('hora_agendamento', { ascending: false });

  if (filtroStatus)    query = query.eq('status', filtroStatus);
  if (filtroData)      query = query.eq('data_agendamento', filtroData);
  if (filtroTerapeuta) query = query.eq('terapeuta', filtroTerapeuta);

  const { data, error } = await query;

  if (error) {
    lista.innerHTML = '<div class="ag-empty">Erro ao carregar agendamentos.</div>';
    console.error(error);
    return;
  }

  await calcularEstatisticas(data || []);
  renderizarAgendamentos(data || [], lista);
}

// ============================================================
// Estatísticas
// ============================================================
async function calcularEstatisticas(todos) {
  const hoje = new Date().toISOString().slice(0,10);

  const agendamentosHoje = todos.filter(a => a.data_agendamento === hoje).length;
  const pendentes        = todos.filter(a => a.status === 'pendente').length;
  const pagos            = todos.filter(a => ['pago','confirmado','atendido'].includes(a.status)).length;

  // Total faturado no mês
  const mesAtual = new Date().toISOString().slice(0,7);
  const totalMes = todos
    .filter(a => a.data_agendamento?.startsWith(mesAtual) && ['pago','confirmado','atendido'].includes(a.status))
    .reduce((acc, a) => acc + Number(a.valor_final || 0), 0);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-hoje',    agendamentosHoje);
  set('stat-pendente',pendentes);
  set('stat-pagos',   pagos);
  set('stat-total',   `R$ ${totalMes.toFixed(2).replace('.', ',')}`);
}

// ============================================================
// Renderização
// ============================================================
function renderizarAgendamentos(lista, container) {
  if (!lista.length) {
    container.innerHTML = '<div class="ag-empty">Nenhum agendamento encontrado.</div>';
    return;
  }
  container.innerHTML = '';
  lista.forEach(ag => container.appendChild(criarItemAgendamento(ag)));
}

function _esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function criarItemAgendamento(ag) {
  const item = document.createElement('div');
  item.className = 'adm-item';
  item.dataset.id = ag.id;

  const nomeTipo        = ag.tipos_leitura?.nome || '—';
  const data            = formatarData(ag.data_agendamento);
  const horaRaw         = ag.hora_agendamento?.slice(0,5) || '';
  const hora            = (!horaRaw || horaRaw === '00:00') ? 'A combinar' : horaRaw;
  const valor           = `R$ ${Number(ag.valor_final || 0).toFixed(2).replace('.', ',')}`;
  const badge           = `<span class="adm-badge adm-badge-${_esc(ag.status)}">${_esc(STATUS_LABELS[ag.status] || ag.status)}</span>`;
  const terapeutaNome   = ag.terapeuta === 'matheus' ? 'Matheus' : ag.terapeuta === 'camila' ? 'Camila' : '';
  const badgeTerapeuta  = terapeutaNome ? `<span class="adm-badge adm-badge-terapeuta">${terapeutaNome}</span>` : '';

  const acoes = montarAcoes(ag);

  item.innerHTML = `
    <div class="adm-item-header" onclick="toggleDetalhes(this)">
      <div class="adm-item-info">
        <h4>${_esc(ag.cliente_nome)}</h4>
        <p>${_esc(nomeTipo)} — ${_esc(data)} às ${_esc(hora)}</p>
      </div>
      <div class="adm-item-right">
        <span style="font-weight:700; color:var(--primary)">${_esc(valor)}</span>
        ${badgeTerapeuta}
        ${badge}
        <span style="font-size:1.1rem; color:var(--text-muted)">▾</span>
      </div>
    </div>
    <div class="adm-item-details">
      <div class="adm-details-grid">
        <div class="adm-detail-item"><label>Chave do pedido</label><span style="font-family:monospace">${_esc(ag.chave_pedido)}</span></div>
        <div class="adm-detail-item"><label>WhatsApp</label><span>${_esc(ag.cliente_whatsapp || '—')}</span></div>
        <div class="adm-detail-item"><label>Nascimento</label><span>${_esc(formatarData(ag.cliente_nascimento))}</span></div>
        <div class="adm-detail-item"><label>Valor original</label><span>R$ ${Number(ag.valor_original||0).toFixed(2).replace('.', ',')}</span></div>
        <div class="adm-detail-item"><label>Desconto</label><span>R$ ${Number(ag.desconto_aplicado||0).toFixed(2).replace('.', ',')}</span></div>
        <div class="adm-detail-item"><label>Duração</label><span>${_esc(String(ag.duracao_minutos))} min</span></div>
        <div class="adm-detail-item"><label>Método pag.</label><span>${_esc(ag.metodo_pagamento || '—')}</span></div>
        <div class="adm-detail-item"><label>Pago em</label><span>${ag.pago_em ? _esc(formatarDatetime(ag.pago_em)) : '—'}</span></div>
        ${ag.cliente_observacoes ? `<div class="adm-detail-item" style="grid-column:1/-1"><label>Observações</label><span>${_esc(ag.cliente_observacoes)}</span></div>` : ''}
      </div>
      <div class="adm-item-actions">${acoes}</div>
    </div>`;

  return item;
}

function montarAcoes(ag) {
  const id      = ag.id;
  const fone    = ag.cliente_whatsapp || '';
  const nome    = ag.cliente_nome     || '';
  const tipo    = ag.tipos_leitura?.nome || 'Leitura';
  const data    = formatarData(ag.data_agendamento);
  const horaBtn = (() => { const h = ag.hora_agendamento?.slice(0,5) || ''; return (!h || h === '00:00') ? 'A combinar' : h; })();

  let html = '';

  if (ag.status === 'pendente') {
    html += `<button class="ag-btn ag-btn-primary ag-btn-sm" onclick="marcarComoPago('${id}')">✅ Marcar como Pago</button>`;
    html += `<button class="ag-btn ag-btn-danger ag-btn-sm" onclick="apagarAgendamento('${id}')">🗑 Apagar</button>`;
  }
  if (['pago','confirmado'].includes(ag.status)) {
    html += `<button class="ag-btn ag-btn-secondary ag-btn-sm" onclick="marcarComoAtendido('${id}')">🌙 Marcar como Atendido</button>`;
  }
  if (ag.status !== 'cancelado' && ag.status !== 'atendido') {
    html += `<button class="ag-btn ag-btn-danger ag-btn-sm" onclick="cancelarAgendamento('${id}')">✖ Cancelar</button>`;
  }

  if (fone.replace(/\D/g,'').length >= 10) {
    html += `<button class="ag-btn ag-btn-whatsapp ag-btn-sm" onclick="abrirWhatsApp('${escapeAttr(fone)}','${escapeAttr(nome)}','${escapeAttr(tipo)}','${data}','${escapeAttr(horaBtn)}')">📱 WhatsApp</button>`;
  }

  return html;
}

// ============================================================
// Ações de status
// ============================================================
async function marcarComoPago(id) {
  if (!confirm('Marcar agendamento como pago?')) return;
  const { error } = await supabase.from('agendamentos').update({ status: 'pago', pago_em: new Date().toISOString() }).eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  _toastAdmin('✅ Marcado como pago!', 'ok');
  carregarAgendamentos();
}

async function marcarComoAtendido(id) {
  if (!confirm('Marcar agendamento como atendido?')) return;
  const { error } = await supabase.from('agendamentos').update({ status: 'atendido', atendido_em: new Date().toISOString() }).eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  _toastAdmin('✅ Marcado como atendido!', 'ok');
  carregarAgendamentos();
}

async function cancelarAgendamento(id) {
  if (!confirm('Cancelar este agendamento? Esta ação não pode ser desfeita.')) return;
  const { error } = await supabase.from('agendamentos').update({ status: 'cancelado' }).eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  _toastAdmin('✅ Agendamento cancelado.', 'ok');
  carregarAgendamentos();
}

async function apagarAgendamento(id) {
  if (!confirm('Apagar este agendamento permanentemente? Esta ação não pode ser desfeita.')) return;
  const { error } = await supabase.from('agendamentos').delete().eq('id', id);
  if (error) { _toastAdmin('Erro: ' + error.message, 'erro'); return; }
  _toastAdmin('✅ Agendamento apagado.', 'ok');
  carregarAgendamentos();
}

// ============================================================
// WhatsApp
// ============================================================
function abrirWhatsApp(fone, nome, tipo, data, hora) {
  const numero = String(fone || '').replace(/\D/g,'');
  if (numero.length < 10) { _toastAdmin('WhatsApp do cliente não cadastrado.', 'aviso'); return; }
  // Considera 55 como DDI somente se o número tiver 12-13 dígitos (DDI + DDD + número).
  const dest = (numero.startsWith('55') && numero.length >= 12) ? numero : `55${numero}`;
  const horaTexto = (!hora || hora === 'A combinar') ? '' : ` às ${hora}`;
  const msg = `Olá ${nome}! 😊\nRecebi seu pedido de ${tipo} para o dia ${data}${horaTexto}.\nEstá tudo confirmado! Combinaremos o horário por aqui. 🌙✨\nCocar Sagrado`;
  window.open(`https://wa.me/${dest}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ============================================================
// Exportar CSV
// ============================================================
async function exportarRelatorio() {
  const { data, error } = await supabase
    .from('agendamentos')
    .select('*, tipos_leitura(nome)')
    .order('data_agendamento', { ascending: false });

  if (error || !data) { _toastAdmin('Erro ao exportar relatório.', 'erro'); return; }

  const cols = ['Chave', 'Cliente', 'Nascimento', 'WhatsApp', 'Tipo', 'Data', 'Hora', 'Duração', 'Valor Original', 'Desconto', 'Valor Final', 'Status', 'Método Pag.', 'Pago em', 'Atendido em', 'Criado em'];
  const rows = data.map(a => [
    a.chave_pedido,
    a.cliente_nome,
    a.cliente_nascimento,
    a.cliente_whatsapp,
    a.tipos_leitura?.nome || '',
    a.data_agendamento,
    a.hora_agendamento?.slice(0,5) || '',
    a.duracao_minutos,
    a.valor_original,
    a.desconto_aplicado,
    a.valor_final,
    a.status,
    a.metodo_pagamento || '',
    a.pago_em || '',
    a.atendido_em || '',
    a.created_at,
  ].map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','));

  const csv  = [cols.join(','), ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `agendamentos_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// UI helpers
// ============================================================
function toggleDetalhes(header) {
  const det = header.nextElementSibling;
  if (!det) return;
  const aberto = det.classList.toggle('open');
  header.querySelector('span:last-child').textContent = aberto ? '▴' : '▾';
}

function formatarData(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function formatarDatetime(str) {
  const d = new Date(str);
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, "\\'")
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  carregarAgendamentos();

  document.getElementById('btn-atualizar')?.addEventListener('click', carregarAgendamentos);
  document.getElementById('btn-exportar')?.addEventListener('click', exportarRelatorio);
  document.getElementById('filtro-status')?.addEventListener('change', carregarAgendamentos);
  document.getElementById('filtro-data')?.addEventListener('change', carregarAgendamentos);
  document.getElementById('filtro-terapeuta')?.addEventListener('change', carregarAgendamentos);
});
