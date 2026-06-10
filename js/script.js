/* ============================================================
   COCAR SAGRADO — JAVASCRIPT COMPLETO
   Organizado em seções comentadas para fácil personalização
   Autor: gerado para Matheus & Camila — Cocar Sagrado
   ============================================================

   ÍNDICE:
   1. CONFIGURAÇÃO DE DESCONTO (edite aqui para ativar promoções)
   2. OVERLAY DE PRIMEIRA VISITA (localStorage)
   3. HEADER — scroll shadow + menu mobile
   4. ANIMAÇÕES DE SCROLL (IntersectionObserver)
   5. FILTROS DO CATÁLOGO
   6. SCROLL SUAVE PARA ÂNCORAS
   7. INICIALIZAÇÃO GERAL (DOMContentLoaded)
   ============================================================ */


/* ============================================================
   1. CONFIGURAÇÃO DE DESCONTO AUTOMÁTICO
   ============================================================
   Para ativar um desconto, altere as configurações abaixo:
   - DESCONTO_ATIVO: mude para true para exibir o banner
   - DESCONTO_PERCENTUAL: valor do desconto (ex: 15 = 15% off)
   - DESCONTO_MENSAGEM: texto que aparece no banner
   - DESCONTO_CODIGO: código que o cliente menciona no WhatsApp
   ============================================================ */

const DESCONTO_CONFIG = {
  ATIVO: false,                          // ← mude para TRUE para ativar
  PERCENTUAL: 15,                        // ← valor do desconto em %
  MENSAGEM: "Aproveite 15% de desconto em todos os atendimentos esta semana!",
  CODIGO: "SAGRADO15",                   // ← código que o cliente menciona
  VALIDADE: "Oferta por tempo limitado"  // ← texto de validade
};

/**
 * Exibe um banner de desconto no topo da página quando ATIVO = true.
 * O banner aparece acima do header com mensagem e código.
 */
function aplicarDescontoAutomatico() {
  if (!DESCONTO_CONFIG.ATIVO) return;

  const banner = document.createElement('div');
  banner.id = 'banner-desconto';
  banner.innerHTML = `
    <div class="desconto-inner">
      <span class="desconto-texto">
        ✨ ${DESCONTO_CONFIG.MENSAGEM}
        Use o código <strong>${DESCONTO_CONFIG.CODIGO}</strong> no WhatsApp.
        <em>${DESCONTO_CONFIG.VALIDADE}</em>
      </span>
      <button class="desconto-fechar" id="fecharBannerDesconto" aria-label="Fechar banner">✕</button>
    </div>
  `;

  const header = document.getElementById('header');
  document.body.insertBefore(banner, header);

  document.getElementById('fecharBannerDesconto').addEventListener('click', () => {
    banner.style.display = 'none';
  });
}



/* ============================================================
   3. HEADER — SCROLL SHADOW + MENU MOBILE
   ============================================================ */

/**
 * Adiciona sombra ao header quando a página é rolada.
 * A classe 'scrolled' é controlada pelo CSS (box-shadow).
 */
function inicializarHeader() {
  const header = document.getElementById('header');
  if (!header) return;

  // Shadow on scroll
  window.addEventListener('scroll', () => {
    if (window.scrollY > 10) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, { passive: true }); // passive: true melhora performance do scroll

  // Menu mobile (hambúrguer)
  const hamburger = document.getElementById('hamburger');
  const navLinks   = document.getElementById('navLinks');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const estaAberto = navLinks.classList.toggle('open');
      hamburger.classList.toggle('open', estaAberto);
      hamburger.setAttribute('aria-expanded', estaAberto);
    });

    // Fecha o menu ao clicar em qualquer link de navegação
    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });

    // Fecha o menu ao clicar fora dele
    document.addEventListener('click', (e) => {
      if (!header.contains(e.target)) {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }
}


/* ============================================================
   4. ANIMAÇÕES DE SCROLL (IntersectionObserver)
   ============================================================
   O IntersectionObserver detecta quando um elemento entra
   na área visível da tela e adiciona a classe 'visible',
   que dispara a animação CSS de fade-in + slide-up.
   ============================================================ */

function inicializarAnimacoesScroll() {
  // Seleciona todos os elementos marcados para animar ao rolar
  const elementosAnimados = document.querySelectorAll('.fade-in-scroll');
  if (!elementosAnimados.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        // Pequeno atraso progressivo para efeito cascata entre elementos
        setTimeout(() => {
          entry.target.classList.add('visible');
        }, index * 80); // 80ms entre cada elemento do grupo

        // Para de observar após animar (performance)
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.12,   // Dispara quando 12% do elemento está visível
    rootMargin: '0px 0px -40px 0px' // Antecipa um pouco antes de chegar na borda
  });

  elementosAnimados.forEach(el => observer.observe(el));
}


/* ============================================================
   CARROSSEL INFINITO DE DEPOIMENTOS
   ============================================================
   Clona os cards do .depos-track uma vez para fechar o loop
   da animação CSS sem costura (translateX -50%).
   ============================================================ */

function inicializarCarrosselDepoimentos() {
  document.querySelectorAll('[data-marquee]').forEach(track => {
    if (track.dataset.marqueeReady === '1') return;

    // 1) Clona os cards uma vez para fechar o loop sem costura.
    const originais = Array.from(track.children);
    originais.forEach(card => {
      const clone = card.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('img').forEach(img => img.setAttribute('alt', ''));
      track.appendChild(clone);
    });
    track.dataset.marqueeReady = '1';

    // 2) Assume o controle do movimento via JS (substitui a animação CSS).
    //    Se o JS não rodar, a animação CSS continua valendo (fallback).
    track.classList.add('is-js');

    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let loopDist = 0;   // distância de um conjunto (px) — ponto de costura
    let velocidade = 0; // px/s
    let offset = 0;
    let ultimo = performance.now();

    let tapPausa   = false; // tap pra ler (mobile)
    let arrastando = false;
    let startX = 0, startOffset = 0, movido = 0, pointerId = null;

    function medir() {
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const durRaw = getComputedStyle(track).getPropertyValue('--depo-duration');
      const dur = parseFloat(durRaw) || 40; // segundos p/ percorrer 1 conjunto
      loopDist = (track.scrollWidth + gap) / 2;
      velocidade = loopDist > 0 ? loopDist / dur : 0;
    }

    function normalizar() {
      if (loopDist <= 0) return;
      while (offset <= -loopDist) offset += loopDist;
      while (offset > 0)          offset -= loopDist;
    }

    function aplicar() {
      track.style.transform = `translate3d(${offset}px, 0, 0)`;
    }

    function frame(agora) {
      const dt = Math.min((agora - ultimo) / 1000, 0.05); // clamp p/ aba inativa
      ultimo = agora;
      const rodando = !tapPausa && !arrastando && !reduzido;
      if (rodando && velocidade > 0) {
        offset -= velocidade * dt;
        normalizar();
        aplicar();
      }
      requestAnimationFrame(frame);
    }

    // --- Arrastar / deslizar (mouse + touch via Pointer Events) ---
    track.addEventListener('pointerdown', (e) => {
      arrastando = true;
      movido = 0;
      startX = e.clientX;
      startOffset = offset;
      pointerId = e.pointerId;
      try { track.setPointerCapture(pointerId); } catch {}
      track.classList.add('dragging');
    });

    track.addEventListener('pointermove', (e) => {
      if (!arrastando) return;
      const dx = e.clientX - startX;
      movido = Math.max(movido, Math.abs(dx));
      offset = startOffset + dx;
      normalizar();
      aplicar();
    });

    function fimArraste(e) {
      if (!arrastando) return;
      arrastando = false;
      track.classList.remove('dragging');
      try { track.releasePointerCapture(e.pointerId); } catch {}
      // Tap curto (toque) → alterna pausa pra leitura no mobile.
      if (e.pointerType === 'touch' && movido < 8) tapPausa = !tapPausa;
    }
    track.addEventListener('pointerup', fimArraste);
    track.addEventListener('pointercancel', fimArraste);

    // --- Recalcula em resize (largura dos cards é responsiva) ---
    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => { medir(); normalizar(); aplicar(); }, 150);
    });

    medir();
    aplicar();
    requestAnimationFrame((t) => { ultimo = t; frame(t); });
  });
}


/* ============================================================
   BADGES DE MODALIDADE DE ATENDIMENTO
   ============================================================ */

function aplicarBadgesModalidade() {
  document.querySelectorAll('.cat-card[data-modalidade]').forEach(card => {
    const modalidade = card.dataset.modalidade;
    const body = card.querySelector('.cat-body');
    const desc = body && body.querySelector('.cat-desc');
    if (!desc) return;

    const badge = document.createElement('span');
    badge.className = modalidade === 'video'
      ? 'cat-badge-atendimento cat-badge-atendimento--video'
      : 'cat-badge-atendimento cat-badge-atendimento--mensagem';
    badge.textContent = modalidade === 'video' ? 'Vídeo-chamada' : 'Mensagem';

    desc.insertAdjacentElement('afterend', badge);
  });
}


/* ============================================================
   5. FILTROS DO CATÁLOGO
   ============================================================
   Filtra os cards do catálogo pelo data-category de cada card.
   Cada card tem data-category com um ou mais termos separados
   por espaço (ex: data-category="buzios matheus").
   ============================================================ */

function inicializarFiltrosCatalogo() {
  const botoesFiltro = document.querySelectorAll('.cat-filter');
  const cardsCatalogo = document.querySelectorAll('.cat-card');
  if (!botoesFiltro.length || !cardsCatalogo.length) return;

  let pendingTimers = [];

  function aplicarFiltro(botao, atualizarURL) {
    const filtro = botao.dataset.filter;

    // Reflete o filtro na URL (deep link compartilhável)
    if (atualizarURL) {
      const url = new URL(window.location);
      if (filtro === 'todos') url.searchParams.delete('filtro');
      else url.searchParams.set('filtro', filtro);
      history.replaceState(null, '', url);
    }

      pendingTimers.forEach(clearTimeout);
      pendingTimers = [];

      botoesFiltro.forEach(b => b.classList.remove('active'));
      botao.classList.add('active');

      cardsCatalogo.forEach(card => {
        const cats = card.dataset.category || '';
        const mostrar = filtro === 'todos' || cats.split(' ').includes(filtro);
        const visivel = !card.classList.contains('hidden');

        card.classList.remove('entrando', 'saindo');

        if (mostrar && !visivel) {
          card.classList.remove('hidden');
          void card.offsetWidth; // força reflow para a animação iniciar do zero
          card.classList.add('entrando');
          const t = setTimeout(() => card.classList.remove('entrando'), 350);
          pendingTimers.push(t);
        } else if (!mostrar && visivel) {
          card.classList.add('saindo');
          const t = setTimeout(() => {
            card.classList.remove('saindo');
            card.classList.add('hidden');
          }, 220);
          pendingTimers.push(t);
        }
      });
  }

  botoesFiltro.forEach(botao => {
    botao.addEventListener('click', () => aplicarFiltro(botao, true));
  });

  // Aplica filtro vindo da URL (?filtro=camila)
  const filtroURL = new URLSearchParams(window.location.search).get('filtro');
  if (filtroURL && filtroURL !== 'todos') {
    const botao = Array.from(botoesFiltro).find(b => b.dataset.filter === filtroURL);
    if (botao) aplicarFiltro(botao, false);
  }
}


/* ============================================================
   6. SCROLL SUAVE PARA ÂNCORAS
   ============================================================
   Intercepta cliques em links internos (#ancora) e
   faz scroll suave compensando a altura do header fixo.
   ============================================================ */

function inicializarScrollSuave() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href === '#') return; // Ignora links sem destino

      const destino = document.querySelector(href);
      if (!destino) return;

      e.preventDefault();

      // Pega a altura do header para compensar no offset
      const header = document.getElementById('header');
      const alturaHeader = header ? header.offsetHeight : 0;

      const posicaoDestino = destino.getBoundingClientRect().top
        + window.scrollY
        - alturaHeader
        - 16; // 16px de respiro extra

      window.scrollTo({
        top: posicaoDestino,
        behavior: 'smooth'
      });
    });
  });
}


/* ============================================================
   7. TOGGLE DE TEMA (CLARO / ESCURO)
   ============================================================ */

// Mantém a cor da barra do navegador alinhada ao tema atual
function sincronizarThemeColor() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#080F08' : '#213D2C');
}

function inicializarToggleTema() {
  const btns = document.querySelectorAll('.theme-toggle');
  if (!btns.length) return;

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const temaAtual = document.documentElement.getAttribute('data-theme') || 'light';
      const novoTema = temaAtual === 'dark' ? 'light' : 'dark';

      btn.classList.add('rotating');
      btn.addEventListener('animationend', () => {
        btn.classList.remove('rotating');
        btn.blur();
      }, { once: true });

      document.documentElement.classList.add('theme-switching');
      document.documentElement.setAttribute('data-theme', novoTema);
      sincronizarThemeColor();
      setTimeout(() => document.documentElement.classList.remove('theme-switching'), 350);
    });
  });
}



/* ============================================================
   9. MODAL NAVEGADOR IN-APP (Instagram / TikTok)
   ============================================================ */

function detectarNavegadorInApp() {
  const ua = navigator.userAgent || '';
  return /Instagram|BytedanceWebview|TikTok|musical_ly/i.test(ua);
}

function inicializarModalInApp() {
  if (!detectarNavegadorInApp()) return false;

  const backdrop = document.getElementById('inappBackdrop');
  if (!backdrop) return false;

  backdrop.classList.add('inapp--visible');
  document.body.style.overflow = 'hidden';

  document.getElementById('inappClose').addEventListener('click', () => {
    backdrop.classList.remove('inapp--visible');
    document.body.style.overflow = '';
  });

  return true;
}

/* ============================================================
   10. INICIALIZAÇÃO GERAL
   ============================================================
   DOMContentLoaded garante que o HTML está totalmente carregado
   antes de qualquer manipulação do DOM.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // 1. Banner de desconto (só aparece se DESCONTO_CONFIG.ATIVO = true)
  aplicarDescontoAutomatico();

  // 2. Modal de navegador in-app (Instagram / TikTok)
  inicializarModalInApp();

  // 3. Header com shadow e menu mobile
  inicializarHeader();

  // 4. Animações ao rolar a página
  inicializarAnimacoesScroll();

  // 4b. Carrossel infinito de depoimentos (clona os cards p/ loop)
  inicializarCarrosselDepoimentos();

  // 5. Filtros do catálogo
  inicializarFiltrosCatalogo();

  // 6. Scroll suave para âncoras
  inicializarScrollSuave();

  // 7. Toggle de tema claro/escuro
  inicializarToggleTema();
  sincronizarThemeColor();

  // 8. Sistema de descontos (usuários que retornam já com escolha feita)
  if (typeof renderizarDescontos === 'function') {
    renderizarDescontos();
  }

  // 9. Badges de modalidade (videochamada / por mensagem)
  aplicarBadgesModalidade();

  // 10. Status online dos terapeutas
  atualizarStatusOnline();

});

async function atualizarStatusOnline() {
  if (typeof supabase === 'undefined') return;
  const hoje = new Date();
  const str  = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;

  const { data } = await supabase
    .from('disponibilidade_override')
    .select('profissional, ativo')
    .eq('data', str)
    .eq('ativo', true)
    .gt('vagas_total', 0);

  const ativos = new Set((data || []).map(r => r.profissional));

  ['camila', 'matheus'].forEach(prof => {
    const dot = document.getElementById(`status-${prof}`);
    if (dot) dot.classList.toggle('online', ativos.has(prof));
  });
}
