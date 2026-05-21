/* ============================================================
   ADMIN SHELL — Topbar mobile + Drawer da sidebar
   ============================================================
   Controla a abertura/fechamento da sidebar como drawer em
   telas < 900px. Em desktop a sidebar fica fixa e este código
   é inerte (o hamburger nem é renderizado).
   ============================================================ */

(function () {
  const MOBILE_MQ = window.matchMedia('(max-width: 899px)');

  function init() {
    const hamb    = document.getElementById('adm-hamburger');
    const sidebar = document.getElementById('adm-sidebar');
    const overlay = document.getElementById('adm-drawer-overlay');
    if (!hamb || !sidebar || !overlay) return;

    function abrir() {
      sidebar.classList.add('open');
      overlay.classList.add('open');
      hamb.classList.add('open');
      hamb.setAttribute('aria-expanded', 'true');
      document.body.classList.add('drawer-aberto');
    }

    function fechar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      hamb.classList.remove('open');
      hamb.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('drawer-aberto');
    }

    function toggle() {
      sidebar.classList.contains('open') ? fechar() : abrir();
    }

    hamb.addEventListener('click', toggle);
    overlay.addEventListener('click', fechar);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) fechar();
    });

    // Click em qualquer link da nav fecha o drawer (só no mobile)
    sidebar.querySelectorAll('.adm-nav a').forEach(link => {
      link.addEventListener('click', () => {
        if (MOBILE_MQ.matches) fechar();
      });
    });

    // Se a tela for redimensionada para desktop, garante drawer fechado
    MOBILE_MQ.addEventListener('change', e => {
      if (!e.matches) fechar();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
