/* ============================================================
   COCAR SAGRADO — Widget de Chat IA
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

  /* ---------- estilos ---------- */
  const css = `
    #cs-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 52px; height: 52px; border-radius: 50%;
      background: #2D4A2D; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(1,55,24,.35);
      display: flex; align-items: center; justify-content: center;
      transition: background .2s, transform .2s;
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
    #cs-chat-btn.cs-btn-open::after { animation: none; }

    #cs-chat-panel {
      position: fixed; bottom: 88px; right: 24px; z-index: 9999;
      width: 340px; max-width: calc(100vw - 32px);
      background: #F5F2E6; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(1,55,24,.18);
      display: flex; flex-direction: column; overflow: hidden;
      transform: scale(.92) translateY(12px); opacity: 0;
      pointer-events: none; transition: transform .22s ease, opacity .22s ease;
    }
    #cs-chat-panel.cs-open {
      transform: scale(1) translateY(0); opacity: 1; pointer-events: all;
    }

    @media (max-width: 480px) {
      #cs-chat-btn { bottom: 16px; right: 16px; }
      #cs-chat-panel {
        right: 0; left: 0; bottom: 0;
        width: 100%; max-width: 100%;
        border-radius: 16px 16px 0 0;
        max-height: 90vh;
      }
    }

    #cs-chat-header {
      background: #2D4A2D; padding: 14px 16px;
      display: flex; align-items: center; gap: 10px;
    }
    #cs-chat-header .cs-avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: #B8923E; display: flex; align-items: center; justify-content: center;
      font-size: 16px; flex-shrink: 0;
    }
    #cs-chat-header .cs-title { color: #F5F2E6; font-family: 'Cormorant Garamond', serif; font-size: 16px; font-weight: 600; }
    #cs-chat-header .cs-sub { color: #A8C8B0; font-size: 11px; }
    #cs-chat-header .cs-close {
      margin-left: auto; background: none; border: none; cursor: pointer;
      color: #A8C8B0; font-size: 18px; line-height: 1; padding: 4px;
    }
    #cs-chat-header .cs-close:hover { color: #F5F2E6; }

    #cs-chat-msgs {
      flex: 1; overflow-y: auto; padding: 14px 12px;
      display: flex; flex-direction: column; gap: 10px;
      max-height: 320px; min-height: 120px;
    }
    @media (max-width: 480px) {
      #cs-chat-msgs { max-height: calc(90vh - 160px); }
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
      background: #2D4A2D; color: #F5F2E6; border-bottom-right-radius: 4px;
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

    #cs-sugestoes {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 0 12px 10px;
    }
    .cs-sug-btn {
      background: none; border: 1px solid #B8923E; border-radius: 20px;
      padding: 5px 11px; font-size: 12px; color: #5A481A;
      font-family: 'DM Sans', sans-serif; cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left; line-height: 1.4;
    }
    .cs-sug-btn:hover { background: #B8923E; color: #fff; }

    #cs-wa-bar {
      display: flex; gap: 6px; padding: 8px 12px 0;
      background: #F5F2E6;
    }
    .cs-wa-btn {
      flex: 1; display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; padding: 7px 10px; border-radius: 18px;
      background: #25D366; color: #fff; text-decoration: none;
      font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600;
      transition: background .15s, transform .15s;
    }
    .cs-wa-btn:hover { background: #1DA851; transform: translateY(-1px); }
    .cs-wa-btn svg { width: 14px; height: 14px; fill: #fff; }

    #cs-chat-form {
      display: flex; gap: 8px; padding: 10px 12px;
      border-top: 1px solid #EDE8D2; background: #F5F2E6;
    }
    #cs-chat-input {
      flex: 1; border: 1px solid #C8C0B4; border-radius: 20px;
      padding: 8px 14px; font-size: 13px; background: #fff;
      font-family: 'DM Sans', sans-serif; outline: none;
      color: #1A1410; resize: none;
    }
    #cs-chat-input:focus { border-color: #B8923E; }
    #cs-chat-send {
      width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
      background: #B8923E; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .2s;
    }
    #cs-chat-send:hover { background: #8A6E28; }
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
      <div id="cs-sugestoes"></div>
      <div id="cs-wa-bar">
        <a class="cs-wa-btn" href="${WA_MATHEUS}" target="_blank" rel="noopener" aria-label="WhatsApp Matheus">
          <svg viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          Matheus
        </a>
        <a class="cs-wa-btn" href="${WA_CAMILA}" target="_blank" rel="noopener" aria-label="WhatsApp Camila">
          <svg viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
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
  const msgs     = document.getElementById('cs-chat-msgs');
  const input    = document.getElementById('cs-chat-input');
  const send     = document.getElementById('cs-chat-send');
  const form     = document.getElementById('cs-chat-form');
  const sugBox   = document.getElementById('cs-sugestoes');

  let history = [];
  let opened  = false;

  btn.addEventListener('click', toggle);
  document.getElementById('cs-chat-close').addEventListener('click', toggle);

  function toggle() {
    opened = !opened;
    panel.classList.toggle('cs-open', opened);
    btn.classList.toggle('cs-btn-open', opened);
    if (opened && !msgs.children.length) {
      addMsg('bot', 'Olá! Sou o assistente do Cocar Sagrado. Posso te ajudar com dúvidas sobre os serviços. Como posso ajudar?');
      renderSugestoes();
    }
    if (opened) setTimeout(() => input.focus(), 220);
  }

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
