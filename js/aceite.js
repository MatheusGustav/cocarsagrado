/* ============================================================
   COCAR SAGRADO — /aceite?t=TOKEN
   Aceite dos Termos por link (cliente do zap que não usa o site).
   - Cumprimenta pelo nome (RPC aceite_info; token é o segredo)
   - Termos vêm do PRÓPRIO index.html (#termosModalCorpo): fonte
     única — versão parseada do .termos-meta ("Versão X.Y"), sem
     constante duplicada pra esquecer de atualizar.
   - Botão "Ouvir" lê os termos em voz alta (speechSynthesis,
     parágrafo a parágrafo, destacando o trecho) — cliente que
     não lê acompanha do mesmo jeito.
   - Um botão só: RPC aceitar_termos_link grava versão/data/IP.
   Depende de: supabase-config.js (window.supabase inicializado)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('t');

  let termosVersao = null;   // preenchida ao carregar os termos
  let termosProntos = false;

  const FMT_DATA = { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' };

  function mostrar(estado) {
    ['aceite-carregando', 'aceite-invalido', 'aceite-form', 'aceite-sucesso']
      .forEach((id) => { $(id).hidden = id !== estado; });
  }

  function mostrarSucesso(nome, msg) {
    $('aceite-sucesso-nome').textContent = nome;
    $('aceite-sucesso-msg').textContent = msg;
    mostrar('aceite-sucesso');
  }

  // ============================================================
  // Termos: busca o index.html e recorta o corpo do modal
  // ============================================================
  async function carregarTermos() {
    const resp = await fetch('index.html', { headers: { Accept: 'text/html' } });
    if (!resp.ok) throw new Error(`index.html ${resp.status}`);
    const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
    const corpo = doc.getElementById('termosModalCorpo');
    if (!corpo) throw new Error('termosModalCorpo não encontrado');

    const meta = corpo.querySelector('.termos-meta')?.textContent || '';
    termosVersao = meta.match(/Versão\s+([0-9.]+)/i)?.[1] || null;
    if (!termosVersao) throw new Error('versão dos termos não encontrada');

    const destino = $('aceite-termos-corpo');
    destino.innerHTML = '';
    while (corpo.firstChild) destino.appendChild(corpo.firstChild);

    termosProntos = true;
    if ('speechSynthesis' in window) $('aceite-ouvir').hidden = false;
  }

  // ============================================================
  // Ouvir: fila de utterances por parágrafo (o Chrome corta
  // utterance única longa) + destaque do trecho sendo lido
  // ============================================================
  let lendo = false;

  function pararLeitura() {
    lendo = false;
    window.speechSynthesis?.cancel();
    $('aceite-ouvir-txt').textContent = '🔊 Ouvir';
    document.querySelectorAll('.aceite-lendo').forEach((el) => el.classList.remove('aceite-lendo'));
  }

  function ouvirTermos() {
    if (lendo) { pararLeitura(); return; }
    lendo = true;
    $('aceite-ouvir-txt').textContent = '⏹ Parar';

    const vozPt = window.speechSynthesis.getVoices()
      .find((v) => v.lang?.toLowerCase().startsWith('pt-br'))
      || window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('pt'));

    const trechos = [...$('aceite-termos-corpo').querySelectorAll('p, h3, h4, li')]
      .filter((el) => el.textContent.trim());

    trechos.forEach((el, i) => {
      const u = new SpeechSynthesisUtterance(el.textContent.trim());
      u.lang = 'pt-BR';
      if (vozPt) u.voice = vozPt;
      u.rate = 0.95;
      u.onstart = () => {
        if (!lendo) return;
        document.querySelectorAll('.aceite-lendo').forEach((x) => x.classList.remove('aceite-lendo'));
        el.classList.add('aceite-lendo');
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      if (i === trechos.length - 1) u.onend = () => { if (lendo) pararLeitura(); };
      window.speechSynthesis.speak(u);
    });
  }

  // ============================================================
  // Aceitar
  // ============================================================
  async function aceitar(nome) {
    const btn = $('aceite-btn');
    const nota = $('aceite-rodape-nota');
    btn.disabled = true;
    $('aceite-btn-txt').textContent = 'Registrando…';

    const { data, error } = await window.supabase
      .rpc('aceitar_termos_link', { p_token: token, p_versao: termosVersao });

    if (error || !data?.ok) {
      btn.disabled = false;
      $('aceite-btn-txt').textContent = 'LI E ACEITO';
      nota.textContent = 'Não deu certo 😕 Toque no botão de novo.';
      nota.classList.add('aceite-rodape-nota--erro');
      console.error('aceitar_termos_link:', error || data);
      return;
    }

    pararLeitura();
    const quando = new Date(data.aceito_em).toLocaleString('pt-BR', FMT_DATA);
    mostrarSucesso(nome, `Seu aceite foi registrado em ${quando}.`);
  }

  // ============================================================
  // Boot
  // ============================================================
  async function init() {
    if (!token || !window.supabase?.rpc) { mostrar('aceite-invalido'); return; }

    let info;
    try {
      // Termos e info em paralelo; os dois precisam dar certo
      const [i] = await Promise.all([
        window.supabase.rpc('aceite_info', { p_token: token }),
        carregarTermos(),
      ]);
      info = i;
    } catch (e) {
      console.error('aceite init:', e);
      mostrar('aceite-invalido');
      return;
    }

    if (info.error || !info.data) {
      if (info.error) console.error('aceite_info:', info.error);
      mostrar('aceite-invalido');
      return;
    }

    const { nome, aceito, aceito_em } = info.data;
    const primeiroNome = String(nome || '').trim().split(/\s+/)[0] || 'tudo bem';

    if (aceito) {
      const quando = new Date(aceito_em).toLocaleString('pt-BR', FMT_DATA);
      mostrarSucesso(primeiroNome, `Você já tinha aceitado em ${quando}. Está tudo certo!`);
      return;
    }

    $('aceite-nome').textContent = primeiroNome;
    $('aceite-btn').disabled = !termosProntos;
    mostrar('aceite-form');

    $('aceite-btn').addEventListener('click', () => aceitar(primeiroNome));
    $('aceite-ouvir').addEventListener('click', ouvirTermos);
    // Vozes carregam async em alguns navegadores; basta estarem
    // disponíveis quando o cliente tocar em "Ouvir".
    window.speechSynthesis?.getVoices();
  }

  init();
});
