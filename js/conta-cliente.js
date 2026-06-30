/* ============================================================
   COCAR SAGRADO — Drawer "Minha conta" (login opcional, OTP por e-mail)
   Depende de: supabase-config.js (window.supabase já inicializado)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const overlay   = document.getElementById('contaDrawerOverlay');
  const fechar    = document.getElementById('contaDrawerFechar');
  const gatilhos  = document.querySelectorAll('[data-cs-account]');

  const telaEmail   = document.getElementById('contaTelaEmail');
  const telaCodigo  = document.getElementById('contaTelaCodigo');
  const telaPerfil  = document.getElementById('contaTelaPerfil');
  const telaLogado  = document.getElementById('contaTelaLogado');

  const formEmail   = document.getElementById('contaFormEmail');
  const inputEmail  = document.getElementById('conta-email');
  const emailErro   = document.getElementById('contaEmailErro');
  const emailBtn    = document.getElementById('contaEmailBtn');

  const formCodigo  = document.getElementById('contaFormCodigo');
  const inputCodigo = document.getElementById('conta-codigo');
  const codigoErro  = document.getElementById('contaCodigoErro');
  const codigoBtn   = document.getElementById('contaCodigoBtn');
  const codigoEmailRef = document.getElementById('contaCodigoEmailRef');
  const voltarEmailBtn = document.getElementById('contaVoltarEmail');

  const formPerfil   = document.getElementById('contaFormPerfil');
  const perfilNome   = document.getElementById('conta-perfil-nome');
  const perfilNasc   = document.getElementById('conta-perfil-nasc');
  const perfilDdi    = document.getElementById('conta-perfil-ddi');
  const perfilFone   = document.getElementById('conta-perfil-fone');
  const perfilErro   = document.getElementById('contaPerfilErro');
  const perfilBtn    = document.getElementById('contaPerfilBtn');

  const telaAdmin     = document.getElementById('contaTelaAdmin');
  const emailAdminEl  = document.getElementById('contaEmailAdmin');
  const sairAdminBtn  = document.getElementById('contaSairAdminBtn');

  const nomeLogadoEl  = document.getElementById('contaNomeLogado');
  const emailLogadoEl = document.getElementById('contaEmailLogado');
  const sairBtn       = document.getElementById('contaSairBtn');

  if (!overlay || !window.supabase) return;

  let emailPendente = '';

  // Máscara de telefone simples (BR formatada; outros DDIs livres) —
  // versão isolada da de agendamento-system.js pra não colidir com #f-ddi/#f-fone.
  if (perfilFone) {
    const atualizarMascaraFone = () => {
      const isBR = !perfilDdi || perfilDdi.value === '+55';
      if (isBR) {
        let v = perfilFone.value.replace(/\D/g, '').slice(0, 11);
        if (v.length > 6) v = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
        else if (v.length > 2) v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
        else if (v.length) v = `(${v}`;
        perfilFone.value = v;
      } else {
        perfilFone.value = perfilFone.value.replace(/[^\d\s\-().+]/g, '');
      }
    };
    perfilFone.addEventListener('input', atualizarMascaraFone);
    perfilDdi?.addEventListener('change', () => { perfilFone.value = ''; atualizarMascaraFone(); });
  }
  if (typeof aplicarMascaraData === 'function' && perfilNasc) {
    aplicarMascaraData(perfilNasc);
  }

  // ============================================================
  // Abrir / Fechar
  // ============================================================
  function abrirDrawer() {
    overlay.classList.add('open');
    document.body.classList.add('conta-drawer-aberto');
  }
  function fecharDrawer() {
    overlay.classList.remove('open');
    document.body.classList.remove('conta-drawer-aberto');
  }

  gatilhos.forEach(el => el.addEventListener('click', abrirDrawer));
  fechar?.addEventListener('click', fecharDrawer);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharDrawer(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) fecharDrawer();
  });

  // ============================================================
  // Ampliar o drawer arrastando a alça da borda esquerda (desktop).
  // Largura escolhida fica salva no localStorage. No mobile a alça
  // some (CSS) e o drawer cobre a tela toda.
  // ============================================================
  const panel  = document.getElementById('contaDrawerPanel');
  const resize = document.getElementById('contaDrawerResize');
  const DRAWER_WIDTH_KEY = 'cocar_drawer_width_v1';
  const DRAWER_MIN = 320;
  const drawerMax = () => Math.round(window.innerWidth * 0.95);

  function aplicarLargura(px) {
    const largura = Math.max(DRAWER_MIN, Math.min(px, drawerMax()));
    panel.style.setProperty('--conta-drawer-width', `${largura}px`);
    return largura;
  }

  // Restaura largura salva (só faz sentido no desktop; no mobile o CSS força 100%).
  const larguraSalva = parseInt(_lsGet(DRAWER_WIDTH_KEY) || '', 10);
  if (Number.isFinite(larguraSalva)) aplicarLargura(larguraSalva);

  if (resize && panel) {
    let arrastando = false;

    const aoMover = (clientX) => {
      // Drawer encostado à direita: largura = distância do cursor até a borda direita.
      aplicarLargura(window.innerWidth - clientX);
    };

    const iniciar = (clientX) => {
      arrastando = true;
      panel.classList.add('is-resizing');
      document.body.style.userSelect = 'none';
      aoMover(clientX);
    };
    const terminar = () => {
      if (!arrastando) return;
      arrastando = false;
      panel.classList.remove('is-resizing');
      document.body.style.userSelect = '';
      const atual = parseInt(panel.style.getPropertyValue('--conta-drawer-width'), 10);
      if (Number.isFinite(atual)) _lsSet(DRAWER_WIDTH_KEY, String(atual));
    };

    resize.addEventListener('mousedown', (e) => { e.preventDefault(); iniciar(e.clientX); });
    window.addEventListener('mousemove', (e) => { if (arrastando) aoMover(e.clientX); });
    window.addEventListener('mouseup', terminar);

    resize.addEventListener('touchstart', (e) => { iniciar(e.touches[0].clientX); }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (arrastando) aoMover(e.touches[0].clientX); }, { passive: true });
    window.addEventListener('touchend', terminar);
  }

  // ============================================================
  // Trocar de tela dentro do drawer
  // ============================================================
  function mostrarTela(tela) {
    [telaEmail, telaCodigo, telaPerfil, telaLogado, telaAdmin].forEach(t => { if (t) t.hidden = (t !== tela); });
  }

  function limparErro(el) { el.hidden = true; el.textContent = ''; }
  function mostrarErroEl(el, msg) { el.textContent = msg; el.hidden = false; }

  // ============================================================
  // Passo 1 — enviar código por e-mail
  // ============================================================
  formEmail?.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErro(emailErro);
    const email = inputEmail.value.trim();
    if (!email) return;

    emailBtn.disabled = true;
    emailBtn.textContent = 'Enviando…';
    const { error } = await window.supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    emailBtn.disabled = false;
    emailBtn.textContent = 'Enviar código';

    if (error) {
      mostrarErroEl(emailErro, 'Não foi possível enviar o código. Tente novamente.');
      return;
    }

    emailPendente = email;
    codigoEmailRef.textContent = email;
    inputCodigo.value = '';
    limparErro(codigoErro);
    mostrarTela(telaCodigo);
  });

  // ============================================================
  // Passo 2 — confirmar código
  // ============================================================
  formCodigo?.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErro(codigoErro);
    const codigo = inputCodigo.value.trim();
    if (!codigo) return;

    codigoBtn.disabled = true;
    codigoBtn.textContent = 'Confirmando…';
    const { error } = await window.supabase.auth.verifyOtp({
      email: emailPendente,
      token: codigo,
      type: 'email',
    });
    codigoBtn.disabled = false;
    codigoBtn.textContent = 'Confirmar';

    if (error) {
      mostrarErroEl(codigoErro, 'Código inválido ou expirado.');
      return;
    }
    // onAuthStateChange cuida de atualizar a UI pra tela de logado.
  });

  voltarEmailBtn?.addEventListener('click', () => {
    limparErro(codigoErro);
    mostrarTela(telaEmail);
  });

  // ============================================================
  // 1º login — completar perfil (nome/nascimento/whatsapp)
  // ============================================================
  formPerfil?.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErro(perfilErro);

    const nome = perfilNome.value.trim();
    const nascIso = typeof dataBrParaISO === 'function' ? dataBrParaISO(perfilNasc.value.trim()) : '';
    const fone = perfilFone.value.trim();

    if (nome.length < 3) { mostrarErroEl(perfilErro, 'Nome deve ter pelo menos 3 caracteres.'); return; }
    if (!nascIso) { mostrarErroEl(perfilErro, 'Data de nascimento inválida.'); return; }
    if (fone.length < 6) { mostrarErroEl(perfilErro, 'Número inválido.'); return; }

    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) return;

    perfilBtn.disabled = true;
    perfilBtn.textContent = 'Salvando…';
    const whatsapp = `${perfilDdi.value} ${fone}`;
    const { error } = await window.supabase.from('perfis').insert({
      id: user.id,
      nome,
      nascimento: nascIso,
      whatsapp,
    });
    perfilBtn.disabled = false;
    perfilBtn.textContent = 'Salvar e continuar';

    if (error) {
      mostrarErroEl(perfilErro, 'Não foi possível salvar. Tente novamente.');
      return;
    }

    // Espelha no localStorage pra autofill funcionar offline (mesmo padrão de salvarDadosPessoaisLocal).
    if (typeof _lsSet === 'function' && typeof CLIENTE_LOCAL_KEY === 'string') {
      _lsSet(CLIENTE_LOCAL_KEY, JSON.stringify({
        nome, nasc: perfilNasc.value.trim(), ddi: perfilDdi.value, fone,
      }));
    }

    atualizarUiLogado(await window.supabase.auth.getSession().then(r => r.data.session));
  });

  // ============================================================
  // Sair
  // ============================================================
  async function sair(btn) {
    btn.disabled = true;
    await window.supabase.auth.signOut();
    btn.disabled = false;
  }
  sairBtn?.addEventListener('click', () => sair(sairBtn));
  sairAdminBtn?.addEventListener('click', () => sair(sairAdminBtn));

  // ============================================================
  // Ícone da nav: estado logado/deslogado + inicial do nome
  // ============================================================
  function atualizarIconeNav(estaLogado, letraInicial) {
    document.querySelectorAll('.nav-account-btn').forEach(btn => {
      btn.classList.toggle('nav-account-btn--logged-in', estaLogado);
      const span = btn.querySelector('.nav-account-initial');
      if (span) span.textContent = estaLogado ? letraInicial : '';
    });
  }

  async function buscarPerfil(userId) {
    const { data } = await window.supabase
      .from('perfis')
      .select('nome')
      .eq('id', userId)
      .maybeSingle();
    return data;
  }

  async function atualizarUiLogado(session) {
    if (!session) {
      atualizarIconeNav(false, '');
      mostrarTela(telaEmail);
      return;
    }
    const email = session.user.email || '';

    // Admin (cocarsagrado@gmail.com, sessão aal2): drawer com atalho pro painel,
    // sem passar pelo fluxo de perfil/carrinho de cliente.
    const { data: ehAdmin } = await window.supabase.rpc('is_admin');
    if (ehAdmin) {
      emailAdminEl.textContent = email;
      atualizarIconeNav(true, email.trim().charAt(0).toUpperCase());
      mostrarTela(telaAdmin);
      return;
    }

    const perfil = await buscarPerfil(session.user.id);

    if (!perfil) {
      // 1º login: ainda não tem perfil — pede os dados antes de liberar a conta.
      atualizarIconeNav(false, '');
      formPerfil?.reset();
      limparErro(perfilErro);
      mostrarTela(telaPerfil);
      return;
    }

    const inicial = (perfil.nome || email || '?').trim().charAt(0).toUpperCase();
    nomeLogadoEl.textContent  = perfil.nome || email;
    emailLogadoEl.textContent = email;
    atualizarIconeNav(true, inicial);
    mostrarTela(telaLogado);
  }

  window.supabase.auth.onAuthStateChange((_event, session) => {
    atualizarUiLogado(session);
  });

  window.supabase.auth.getSession().then(({ data }) => {
    atualizarUiLogado(data.session);
  });
});
