/* ============================================================
   COCAR SAGRADO — Widget de Chat IA
   - Mobile (<1024px): bottom sheet com arrastar
   - Tablet (1024-1279px): painel lateral overlay
   - Desktop largo (≥1280px): painel lateral + site encolhe
   ============================================================ */

(function () {
  const EDGE_URL = 'https://demxedudbislzausvhwx.supabase.co/functions/v1/ai-chat';

  const SUGESTOES = [
    'Quais serviços vocês oferecem?',
    'Como funciona o agendamento?',
    'Qual a diferença entre Combo + 10 e Consulta Ao Vivo?',
  ];

  const WA_MSG = encodeURIComponent('oi, vim pelo site e gostaria de tirar uma duvida');
  const WA_MATHEUS = `https://wa.me/5528999476620?text=${WA_MSG}`;
  const WA_CAMILA  = `https://wa.me/5527998528483?text=${WA_MSG}`;

  const WA_ICON = `<svg viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>`;

  /* ---------- estilos ---------- */
  const css = `
    /* Botão flutuante */
    #cs-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 52px; height: 52px; border-radius: 50%;
      background: #2D4A2D; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(1,55,24,.35);
      display: flex; align-items: center; justify-content: center;
      transition: background .2s, transform .2s, opacity .25s, right .25s ease;
    }
    #cs-chat-btn:hover { background: #4A7A4A; transform: scale(1.08); }
    #cs-chat-btn svg { width: 24px; height: 24px; fill: #D4B254; }
    #cs-chat-btn::after {
      content: ''; position: absolute;
      width: 52px; height: 52px; border-radius: 50%;
      border: 2px solid rgba(1,55,24,.5);
      animation: cs-pulse 2.4s ease-out infinite;
    }
    @keyframes cs-pulse {
      0%   { transform: scale(1);   opacity: .7; }
      70%  { transform: scale(1.6); opacity: 0;  }
      100% { transform: scale(1.6); opacity: 0;  }
    }
    body.cs-chat-active #cs-chat-btn {
      opacity: 0; pointer-events: none; transform: scale(.85);
    }
    body.cs-chat-active #cs-chat-btn::after { animation: none; }

    /* Backdrop */
    #cs-chat-backdrop {
      position: fixed; inset: 0; z-index: 9997;
      background: rgba(15, 30, 20, .28);
      opacity: 0; pointer-events: none;
      transition: opacity .25s ease;
    }
    #cs-chat-backdrop.cs-open { opacity: 1; pointer-events: all; }

    /* Painel — base comum */
    #cs-chat-panel {
      position: fixed; z-index: 9999;
      background: #F5F2E6;
      display: flex; flex-direction: column; overflow: hidden;
      will-change: transform;
    }

    /* Cabeçalho, mensagens, sugestões, WhatsApp bar, form — comuns a todas as telas */
    #cs-chat-header {
      background: #2D4A2D; padding: 16px 18px;
      display: flex; align-items: center; gap: 12px;
      flex-shrink: 0;
    }
    #cs-chat-header .cs-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: #B8923E; display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0; color: #F5F2E6;
    }
    #cs-chat-header .cs-title {
      color: #F5F2E6; font-family: 'Cormorant Garamond', serif;
      font-size: 18px; font-weight: 600; line-height: 1.1;
    }
    #cs-chat-header .cs-sub { color: #A8C8B0; font-size: 12px; margin-top: 2px; }
    #cs-chat-header .cs-close {
      margin-left: auto; background: none; border: none; cursor: pointer;
      color: #A8C8B0; font-size: 20px; line-height: 1; padding: 6px 8px;
      border-radius: 6px; transition: background .15s, color .15s;
    }
    #cs-chat-header .cs-close:hover { color: #F5F2E6; background: rgba(255,255,255,.08); }

    #cs-chat-msgs {
      flex: 1 1 auto; overflow-y: auto;
      padding: 18px 16px;
      display: flex; flex-direction: column; gap: 12px;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
    }
    #cs-chat-msgs::-webkit-scrollbar { width: 5px; }
    #cs-chat-msgs::-webkit-scrollbar-thumb { background: #C8C0B4; border-radius: 4px; }

    .cs-msg {
      max-width: 85%; padding: 11px 14px; border-radius: 14px;
      font-size: 14.5px; line-height: 1.5;
      font-family: 'DM Sans', sans-serif;
      animation: cs-msg-in .22s ease-out;
    }
    @keyframes cs-msg-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .cs-msg--bot {
      background: #fff; color: #1A1410; border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,.07); align-self: flex-start;
    }
    .cs-msg--user {
      background: #2D4A2D; color: #F5F2E6; border-bottom-right-radius: 4px;
      align-self: flex-end;
    }
    .cs-typing { display: flex; gap: 4px; align-items: center; padding: 12px 14px; }
    .cs-typing span {
      width: 7px; height: 7px; border-radius: 50%; background: #8C8478;
      animation: cs-bounce .9s infinite;
    }
    .cs-typing span:nth-child(2) { animation-delay: .15s; }
    .cs-typing span:nth-child(3) { animation-delay: .30s; }
    @keyframes cs-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }

    #cs-sugestoes {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 0 16px 10px;
      flex-shrink: 0;
    }
    .cs-sug-btn {
      background: none; border: 1px solid #B8923E; border-radius: 20px;
      padding: 6px 12px; font-size: 12.5px; color: #5A481A;
      font-family: 'DM Sans', sans-serif; cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left; line-height: 1.4;
    }
    .cs-sug-btn:hover { background: #B8923E; color: #fff; }

    #cs-wa-bar {
      display: flex; gap: 8px; padding: 8px 14px 0;
      background: #F5F2E6;
      flex-shrink: 0;
    }
    .cs-wa-btn {
      flex: 1; display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; padding: 9px 10px; border-radius: 18px;
      background: #25D366; color: #fff; text-decoration: none;
      font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600;
      transition: background .15s, transform .15s;
    }
    .cs-wa-btn:hover { background: #1DA851; transform: translateY(-1px); }
    .cs-wa-btn svg { width: 14px; height: 14px; fill: #fff; }

    #cs-chat-form {
      display: flex; gap: 8px; padding: 12px 14px;
      padding-bottom: calc(12px + env(safe-area-inset-bottom));
      border-top: 1px solid #EDE8D2; background: #F5F2E6;
      flex-shrink: 0;
    }
    #cs-chat-input {
      flex: 1; border: 1px solid #C8C0B4; border-radius: 22px;
      padding: 10px 16px; font-size: 14px; background: #fff;
      font-family: 'DM Sans', sans-serif; outline: none;
      color: #1A1410;
    }
    #cs-chat-input:focus { border-color: #B8923E; }
    #cs-chat-send {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: #B8923E; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .2s;
    }
    #cs-chat-send:hover { background: #8A6E28; }
    #cs-chat-send svg { width: 18px; height: 18px; fill: #fff; }
    #cs-chat-send:disabled { background: #C8C0B4; cursor: not-allowed; }

    /* ============ MOBILE — bottom sheet ============ */
    @media (max-width: 1023px) {
      #cs-handle {
        flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        height: 22px; cursor: grab; touch-action: none;
        background: #F5F2E6;
      }
      #cs-handle:active { cursor: grabbing; }
      #cs-handle::before {
        content: ''; width: 44px; height: 5px; border-radius: 999px;
        background: #C8C0B4;
      }
      #cs-chat-panel {
        left: 0; right: 0; bottom: 0;
        width: 100%;
        height: 0;
        max-height: 100vh; max-height: 100dvh;
        border-radius: 22px 22px 0 0;
        box-shadow: 0 -10px 40px rgba(1,55,24,.22);
        transition: height .3s cubic-bezier(.4,0,.2,1);
      }
      #cs-chat-panel.cs-open {
        height: 82vh; height: 82dvh;
      }
      #cs-chat-panel.cs-open.cs-expanded {
        height: 100vh; height: 100dvh;
      }
    }

    /* ============ TABLET — painel lateral overlay ============ */
    @media (min-width: 1024px) {
      #cs-handle { display: none; }
      #cs-chat-panel {
        top: 0; right: 0; bottom: 0;
        width: 420px; max-width: 100vw;
        height: 100vh; height: 100dvh;
        border-radius: 0;
        box-shadow: -8px 0 40px rgba(1,55,24,.18);
        transform: translateX(100%);
        transition: transform .28s cubic-bezier(.4,0,.2,1);
      }
      #cs-chat-panel.cs-open { transform: translateX(0); }
    }

    /* ============ TABLET / DESKTOP — empurra o site ============ */
    @media (min-width: 1024px) {
      html { transition: padding-right .28s cubic-bezier(.4,0,.2,1); }
      html.cs-chat-pushing { padding-right: 420px; }
      #cs-chat-backdrop { display: none !important; }
    }
  `;

  /* ---------- HTML ---------- */
  const html = `
    <button id="cs-chat-btn" aria-label="Abrir chat">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
    </button>
    <div id="cs-chat-backdrop"></div>
    <div id="cs-chat-panel" role="dialog" aria-label="Chat de atendimento" aria-modal="false">
      <div id="cs-handle" aria-label="Arrastar para expandir ou fechar" role="button" tabindex="0"></div>
      <div id="cs-chat-header">
        <div class="cs-avatar">✦</div>
        <div>
          <div class="cs-title">Cocar Sagrado</div>
          <div class="cs-sub">Assistente virtual</div>
        </div>
        <button class="cs-close" id="cs-chat-close" aria-label="Fechar">✕</button>
      </div>
      <div id="cs-chat-msgs"></div>
      <div id="cs-sugestoes"></div>
      <div id="cs-wa-bar">
        <a class="cs-wa-btn" href="${WA_MATHEUS}" target="_blank" rel="noopener" aria-label="WhatsApp Matheus">
          ${WA_ICON}
          Matheus
        </a>
        <a class="cs-wa-btn" href="${WA_CAMILA}" target="_blank" rel="noopener" aria-label="WhatsApp Camila">
          ${WA_ICON}
          Camila
        </a>
      </div>
      <form id="cs-chat-form" autocomplete="off">
        <input id="cs-chat-input" type="text" placeholder="Tire sua dúvida…" maxlength="400" />
        <button type="submit" id="cs-chat-send" aria-label="Enviar">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </form>
    </div>
  `;

  /* ---------- init ---------- */
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  const btn      = document.getElementById('cs-chat-btn');
  const panel    = document.getElementById('cs-chat-panel');
  const backdrop = document.getElementById('cs-chat-backdrop');
  const handle   = document.getElementById('cs-handle');
  const msgs     = document.getElementById('cs-chat-msgs');
  const input    = document.getElementById('cs-chat-input');
  const send     = document.getElementById('cs-chat-send');
  const form     = document.getElementById('cs-chat-form');
  const sugBox   = document.getElementById('cs-sugestoes');

  let history = [];
  let opened  = false;

  const isMobile      = () => window.matchMedia('(max-width: 1023px)').matches;
  const isDesktopPush = () => window.matchMedia('(min-width: 1024px)').matches;

  btn.addEventListener('click', openChat);
  document.getElementById('cs-chat-close').addEventListener('click', closeChat);
  backdrop.addEventListener('click', closeChat);

  function openChat() {
    if (opened) return;
    opened = true;
    panel.classList.add('cs-open');
    backdrop.classList.add('cs-open');
    document.body.classList.add('cs-chat-active');
    if (isDesktopPush()) document.documentElement.classList.add('cs-chat-pushing');
    if (!msgs.children.length) {
      addMsg('bot', 'Olá! Sou o assistente do Cocar Sagrado. Posso te ajudar com dúvidas sobre os serviços. Como posso ajudar?');
      renderSugestoes();
    }
    setTimeout(() => input.focus(), 240);
  }

  function closeChat() {
    if (!opened) return;
    opened = false;
    panel.classList.remove('cs-open', 'cs-expanded');
    backdrop.classList.remove('cs-open');
    document.body.classList.remove('cs-chat-active');
    document.documentElement.classList.remove('cs-chat-pushing');
  }

  /* ---------- drag (mobile bottom sheet) ---------- */
  let dragStartY = null;
  let dragStartHeightPx = 0;
  let dragMoved = false;

  function onDragStart(clientY) {
    if (!isMobile() || !opened) return;
    dragStartY = clientY;
    dragStartHeightPx = panel.getBoundingClientRect().height;
    dragMoved = false;
    panel.style.transition = 'none';
  }

  function onDragMove(clientY) {
    if (dragStartY == null) return;
    const dy = clientY - dragStartY;
    if (Math.abs(dy) > 4) dragMoved = true;
    const vh = window.innerHeight;
    const next = Math.max(0, Math.min(vh, dragStartHeightPx - dy));
    panel.style.height = `${next}px`;
  }

  function onDragEnd(clientY) {
    if (dragStartY == null) return;
    const finalHeight = panel.getBoundingClientRect().height;
    const vh = window.innerHeight;

    panel.style.transition = '';
    panel.style.height = '';

    if (finalHeight < vh * 0.4) {
      closeChat();
    } else if (finalHeight > vh * 0.92) {
      panel.classList.add('cs-expanded');
    } else {
      panel.classList.remove('cs-expanded');
    }
    dragStartY = null;
  }

  handle.addEventListener('touchstart', (e) => onDragStart(e.touches[0].clientY), { passive: true });
  handle.addEventListener('touchmove',  (e) => onDragMove(e.touches[0].clientY),  { passive: true });
  handle.addEventListener('touchend',   (e) => onDragEnd(e.changedTouches[0].clientY));
  handle.addEventListener('touchcancel',(e) => onDragEnd(e.changedTouches[0].clientY));

  handle.addEventListener('mousedown', (e) => {
    onDragStart(e.clientY);
    const onMove = (ev) => onDragMove(ev.clientY);
    const onUp   = (ev) => {
      onDragEnd(ev.clientY);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('click', () => {
    if (dragMoved) { dragMoved = false; return; }
    if (!isMobile() || !opened) return;
    panel.classList.toggle('cs-expanded');
  });

  /* ---------- resize: ajusta classe de push se mudar breakpoint ---------- */
  window.addEventListener('resize', () => {
    if (!opened) return;
    if (isDesktopPush()) document.documentElement.classList.add('cs-chat-pushing');
    else document.documentElement.classList.remove('cs-chat-pushing');
    if (!isMobile()) panel.classList.remove('cs-expanded');
  });

  /* ---------- mensagens ---------- */
  function renderSugestoes() {
    sugBox.innerHTML = '';
    SUGESTOES.forEach(txt => {
      const b = document.createElement('button');
      b.className = 'cs-sug-btn';
      b.textContent = txt;
      b.type = 'button';
      b.addEventListener('click', () => {
        sugBox.innerHTML = '';
        enviar(txt);
      });
      sugBox.appendChild(b);
    });
  }

  function addMsg(role, text) {
    const el = document.createElement('div');
    el.className = `cs-msg cs-msg--${role}`;
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'cs-msg cs-msg--bot cs-typing';
    el.id = 'cs-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    document.getElementById('cs-typing')?.remove();
  }

  async function enviar(text) {
    sugBox.innerHTML = '';
    input.value = '';
    send.disabled = true;
    addMsg('user', text);
    showTyping();

    try {
      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      removeTyping();

      if (data.error) throw new Error(data.error);

      addMsg('bot', data.reply);
      history.push({ role: 'user',      content: text });
      history.push({ role: 'assistant', content: data.reply });
      if (history.length > 20) history = history.slice(-20);
    } catch {
      removeTyping();
      addMsg('bot', 'Desculpe, não consegui responder agora. Tente novamente em instantes.');
    }

    send.disabled = false;
    input.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) enviar(text);
  });
})();
