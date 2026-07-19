/* ============================================================
   COCAR SAGRADO — Termos de Uso + espelho de sessão
   Herdado do antigo conta-cliente.js quando o drawer "Minha
   conta" foi removido (jul/2026). Sobrou o que o checkout usa:
   - Modal de Termos aberto por qualquer [data-cs-termos]
   - window._csLogado (checkout esconde e-mail/termos pra sessão
     ativa — hoje só admin tem sessão, cliente não loga mais)
   - Wipe dos dados lembrados no logout real (SIGNED_OUT)
   Depende de: supabase-config.js (window.supabase inicializado)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // ============================================================
  // Modal de Termos de Uso
  // ============================================================
  const termosOverlay = document.getElementById('termosModalOverlay');
  const termosFechar  = document.getElementById('termosModalFechar');
  function abrirTermos() { if (termosOverlay) termosOverlay.hidden = false; }
  function fecharTermos() { if (termosOverlay) termosOverlay.hidden = true; }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-cs-termos]')) { e.preventDefault(); abrirTermos(); }
  });
  termosFechar?.addEventListener('click', fecharTermos);
  termosOverlay?.addEventListener('click', (e) => { if (e.target === termosOverlay) fecharTermos(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && termosOverlay && !termosOverlay.hidden) fecharTermos();
  });

  // ============================================================
  // Espelho de sessão pro checkout (admin navegando no site tem
  // sessão do painel — mesmo storage do supabase-js).
  // ============================================================
  window.supabase?.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') return;
    // Só o logout REAL apaga os dados lembrados (aparelho compartilhado).
    // Boot sem sessão (guest) preserva — é o que lembra o e-mail dele.
    if (event === 'SIGNED_OUT' && typeof esquecerDadosPessoaisLocal === 'function') esquecerDadosPessoaisLocal();
    const mudou = window._csLogado !== !!session;
    window._csLogado = !!session;
    // Sessão mudou: cupom pessoal aplicado no carrinho pode ter deixado
    // de valer (logout) ou passado a valer (login) — revalida já.
    if (mudou && typeof window._csRevalidarCupom === 'function') window._csRevalidarCupom();
  });
});
