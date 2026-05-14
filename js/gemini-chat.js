/* ============================================================
   COCAR SAGRADO — Widget de Chat IA (Gemini)
   ============================================================ */

(function () {
  const EDGE_URL = 'https://demxedudbislzausvhwx.supabase.co/functions/v1/gemini-chat';

  /* ---------- estilos ---------- */
  const css = `
    #cs-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 52px; height: 52px; border-radius: 50%;
      background: #013718; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(1,55,24,.35);
      display: flex; align-items: center; justify-content: center;
      transition: background .2s, transform .2s;
    }
    #cs-chat-btn:hover { background: #025522; transform: scale(1.08); }
    #cs-chat-btn svg { width: 24px; height: 24px; fill: #E2C97E; }

    #cs-chat-panel {
      position: fixed; bottom: 88px; right: 24px; z-index: 9999;
      width: 340px; max-width: calc(100vw - 32px);
      background: #F5F0E8; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(1,55,24,.18);
      display: flex; flex-direction: column; overflow: hidden;
      transform: scale(.92) translateY(12px); opacity: 0;
      pointer-events: none; transition: transform .22s ease, opacity .22s ease;
    }
    #cs-chat-panel.cs-open {
      transform: scale(1) translateY(0); opacity: 1; pointer-events: all;
    }

    #cs-chat-header {
      background: #013718; padding: 14px 16px;
      display: flex; align-items: center; gap: 10px;
    }
    #cs-chat-header .cs-avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: #C9A84C; display: flex; align-items: center; justify-content: center;
      font-size: 16px; flex-shrink: 0;
    }
    #cs-chat-header .cs-title { color: #F5F0E8; font-family: 'Cormorant Garamond', serif; font-size: 16px; font-weight: 600; }
    #cs-chat-header .cs-sub { color: #A8C8B0; font-size: 11px; }
    #cs-chat-header .cs-close {
      margin-left: auto; background: none; border: none; cursor: pointer;
      color: #A8C8B0; font-size: 18px; line-height: 1; padding: 4px;
    }
    #cs-chat-header .cs-close:hover { color: #F5F0E8; }

    #cs-chat-msgs {
      flex: 1; overflow-y: auto; padding: 14px 12px;
      display: flex; flex-direction: column; gap: 10px;
      max-height: 320px; min-height: 120px;
    }
    #cs-chat-msgs::-webkit-scrollbar { width: 4px; }
    #cs-chat-msgs::-webkit-scrollbar-thumb { background: #C8C0B4; border-radius: 4px; }

    .cs-msg {
      max-width: 85%; padding: 9px 12px; border-radius: 12px;
      font-size: 13.5px; line-height: 1.5; font-family: 'DM Sans', sans-serif;
    }
    .cs-msg--bot {
      background: #fff; color: #1A1410; border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,.07); align-self: flex-start;
    }
    .cs-msg--user {
      background: #013718; color: #F5F0E8; border-bottom-right-radius: 4px;
      align-self: flex-end;
    }
    .cs-typing { display: flex; gap: 4px; align-items: center; padding: 10px 12px; }
    .cs-typing span {
      width: 7px; height: 7px; border-radius: 50%; background: #8C8478;
      animation: cs-bounce .9s infinite;
    }
    .cs-typing span:nth-child(2) { animation-delay: .15s; }
    .cs-typing span:nth-child(3) { animation-delay: .30s; }
    @keyframes cs-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }

    #cs-chat-form {
      display: flex; gap: 8px; padding: 10px 12px;
      border-top: 1px solid #EDE7DC; background: #F5F0E8;
    }
    #cs-chat-input {
      flex: 1; border: 1px solid #C8C0B4; border-radius: 20px;
      padding: 8px 14px; font-size: 13px; background: #fff;
      font-family: 'DM Sans', sans-serif; outline: none;
      color: #1A1410; resize: none;
    }
    #cs-chat-input:focus { border-color: #C9A84C; }
    #cs-chat-send {
      width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
      background: #C9A84C; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .2s;
    }
    #cs-chat-send:hover { background: #B8902A; }
    #cs-chat-send svg { width: 16px; height: 16px; fill: #fff; }
    #cs-chat-send:disabled { background: #C8C0B4; cursor: not-allowed; }
  `;

  /* ---------- HTML ---------- */
  const html = `
    <button id="cs-chat-btn" aria-label="Abrir chat">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
    </button>
    <div id="cs-chat-panel" role="dialog" aria-label="Chat de atendimento">
      <div id="cs-chat-header">
        <div class="cs-avatar">✦</div>
        <div>
          <div class="cs-title">Cocar Sagrado</div>
          <div class="cs-sub">Assistente virtual</div>
        </div>
        <button class="cs-close" id="cs-chat-close" aria-label="Fechar">✕</button>
      </div>
      <div id="cs-chat-msgs"></div>
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

  const panel  = document.getElementById('cs-chat-panel');
  const msgs   = document.getElementById('cs-chat-msgs');
  const input  = document.getElementById('cs-chat-input');
  const send   = document.getElementById('cs-chat-send');
  const form   = document.getElementById('cs-chat-form');

  let history = [];
  let opened  = false;

  document.getElementById('cs-chat-btn').addEventListener('click', toggle);
  document.getElementById('cs-chat-close').addEventListener('click', toggle);

  function toggle() {
    opened = !opened;
    panel.classList.toggle('cs-open', opened);
    if (opened && !msgs.children.length) addMsg('bot', 'Olá! Sou o assistente do Cocar Sagrado. Posso te ajudar com dúvidas sobre os serviços. Como posso ajudar?');
    if (opened) setTimeout(() => input.focus(), 220);
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

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
      history.push({ role: 'user',  parts: [{ text }] });
      history.push({ role: 'model', parts: [{ text: data.reply }] });
      if (history.length > 20) history = history.slice(-20);
    } catch {
      removeTyping();
      addMsg('bot', 'Desculpe, não consegui responder agora. Tente novamente em instantes.');
    }

    send.disabled = false;
    input.focus();
  });
})();
