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
  if (!DESCONTO_CONFIG.ATIVO) return; // Sai da função se desconto estiver desativado

  // Cria o elemento do banner
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

  // Estilo inline do banner (paleta Cocar Sagrado: verde floresta + dourado)
  banner.style.cssText = `
    background: #013718;
    color: #F5E8C0;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-align: center;
    padding: 10px 16px;
    position: relative;
    z-index: 200;
    font-family: 'DM Sans', sans-serif;
    border-bottom: 1px solid rgba(201, 168, 76, 0.25);
  `;

  // Insere o banner antes do header
  const header = document.getElementById('header');
  document.body.insertBefore(banner, header);

  // Botão de fechar o banner
  document.getElementById('fecharBannerDesconto').addEventListener('click', () => {
    banner.style.display = 'none';
  });

  // Estilo do botão fechar
  const btnFechar = document.getElementById('fecharBannerDesconto');
  btnFechar.style.cssText = `
    background: none;
    border: none;
    color: #F5E8C0;
    cursor: pointer;
    font-size: 14px;
    margin-left: 16px;
    opacity: 0.7;
    vertical-align: middle;
  `;
}


/* ============================================================
   2. OVERLAY DE PRIMEIRA VISITA
   ============================================================
   Usa localStorage para detectar se o usuário já visitou o site.
   Na primeira visita: exibe overlay + blur na página.
   Nas visitas seguintes: não exibe nada.

   Para resetar e testar a primeira visita novamente:
   Abra o console do navegador e execute:
   localStorage.removeItem('cocarsagrado_visitou')
   ============================================================ */

const CHAVE_LOCALSTORAGE = 'cocarsagrado_visitou'; // Nome da chave salva no localStorage

/**
 * Verifica se é a primeira visita e exibe o overlay se necessário.
 */
function inicializarOverlay() {
  const overlayBackdrop = document.getElementById('overlayBackdrop');
  if (!overlayBackdrop) return;

  // Verifica se o usuário já visitou antes
  const jaVisitou = localStorage.getItem(CHAVE_LOCALSTORAGE);

  if (jaVisitou) {
    // Já visitou antes — esconde o overlay imediatamente
    overlayBackdrop.classList.add('overlay--hidden');
    return;
  }

  // Primeira visita — mostra o overlay e aplica blur na página
  document.body.classList.add('overlay-active');

  // Botão principal: "Conhecer os atendimentos"
  const btnEntrar = document.getElementById('overlayEnter');
  if (btnEntrar) {
    btnEntrar.addEventListener('click', () => {
      fecharOverlay();
      // Rola suavemente até o catálogo
      setTimeout(() => {
        const catalogo = document.getElementById('catalogo');
        if (catalogo) catalogo.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    });
  }

  // Botão secundário: "Explorar o site primeiro"
  const btnPular = document.getElementById('overlaySkip');
  if (btnPular) {
    btnPular.addEventListener('click', fecharOverlay);
  }

  // Botão X de fechar
  const btnFechar = document.getElementById('overlayClose');
  if (btnFechar) {
    btnFechar.addEventListener('click', fecharOverlay);
  }

  // Fecha ao clicar fora do card (no backdrop escuro)
  overlayBackdrop.addEventListener('click', (e) => {
    if (e.target === overlayBackdrop) fecharOverlay();
  });

  // Fecha ao pressionar ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharOverlay();
  });
}

/**
 * Fecha o overlay, remove o blur e salva no localStorage.
 */
function fecharOverlay() {
  const overlayBackdrop = document.getElementById('overlayBackdrop');
  if (!overlayBackdrop) return;

  // Animação de saída suave
  overlayBackdrop.style.opacity = '0';
  overlayBackdrop.style.transition = 'opacity 0.3s ease';

  setTimeout(() => {
    overlayBackdrop.classList.add('overlay--hidden');
    document.body.classList.remove('overlay-active');
  }, 300);

  // Salva no localStorage que o usuário já visitou
  localStorage.setItem(CHAVE_LOCALSTORAGE, 'true');
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

  botoesFiltro.forEach(botao => {
    botao.addEventListener('click', () => {
      const filtro = botao.dataset.filter;

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
    });
  });
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

const CHAVE_TEMA = 'cocarsagrado-theme';

function inicializarToggleTema() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const temaSalvo = localStorage.getItem(CHAVE_TEMA);
  if (temaSalvo) document.documentElement.setAttribute('data-theme', temaSalvo);

  btn.addEventListener('click', () => {
    const temaAtual = document.documentElement.getAttribute('data-theme') || 'light';
    const novoTema = temaAtual === 'dark' ? 'light' : 'dark';

    // Rotação via keyframe CSS — sem stutter ao remover
    btn.classList.add('rotating');
    btn.addEventListener('animationend', () => {
      btn.classList.remove('rotating');
      btn.blur();
    }, { once: true });

    // Transições suaves durante a troca de tema
    document.documentElement.classList.add('theme-switching');
    document.documentElement.setAttribute('data-theme', novoTema);
    setTimeout(() => document.documentElement.classList.remove('theme-switching'), 350);

    try { localStorage.setItem(CHAVE_TEMA, novoTema); } catch(e) {}
  });
}


/* ============================================================
   8. ANIMAÇÕES DECORATIVAS HAND-DRAWN
   ============================================================
   As animações CSS já controlam visibilidade via :root e
   [data-theme="dark"]. Esta função garante que ao trocar o
   tema as nuvens reiniciem a posição para não aparecer no meio.
   ============================================================ */

function inicializarDecoracoes() {
  const nuvens = document.querySelectorAll('.deco-nuvem');
  if (!nuvens.length) return;

  // Reinicia animação das nuvens ao trocar tema (evita posição estranha)
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      nuvens.forEach(n => {
        n.style.animation = 'none';
        void n.offsetWidth;
        n.style.animation = '';
      });
    });
  }
}


/* ============================================================
   9. INICIALIZAÇÃO GERAL
   ============================================================
   DOMContentLoaded garante que o HTML está totalmente carregado
   antes de qualquer manipulação do DOM.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // 1. Banner de desconto (só aparece se DESCONTO_CONFIG.ATIVO = true)
  aplicarDescontoAutomatico();

  // 2. Overlay de primeira visita
  inicializarOverlay();

  // 3. Header com shadow e menu mobile
  inicializarHeader();

  // 4. Animações ao rolar a página
  inicializarAnimacoesScroll();

  // 5. Filtros do catálogo
  inicializarFiltrosCatalogo();

  // 6. Scroll suave para âncoras
  inicializarScrollSuave();

  // 7. Toggle de tema claro/escuro
  inicializarToggleTema();

  // 8. Decorações hand-drawn
  inicializarDecoracoes();

});
