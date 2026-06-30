/* ============================================================
   COCAR SAGRADO — Drawer "Minha conta" (login opcional, OTP por e-mail)
   Depende de: supabase-config.js (window.supabase já inicializado)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const overlay   = document.getElementById('contaDrawerOverlay');
  const fechar    = document.getElementById('contaDrawerFechar');
  const gatilhos  = document.querySelectorAll('[data-cs-account]');

  const telaEmail  = document.getElementById('contaTelaEmail');
  const telaCodigo = document.getElementById('contaTelaCodigo');
  const telaLogado = document.getElementById('contaTelaLogado');

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

  const nomeLogadoEl  = document.getElementById('contaNomeLogado');
  const emailLogadoEl = document.getElementById('contaEmailLogado');
  const sairBtn       = document.getElementById('contaSairBtn');

  if (!overlay || !window.supabase) return;

  let emailPendente = '';

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
  // Trocar de tela dentro do drawer
  // ============================================================
  function mostrarTela(tela) {
    [telaEmail, telaCodigo, telaLogado].forEach(t => { if (t) t.hidden = (t !== tela); });
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
  // Sair
  // ============================================================
  sairBtn?.addEventListener('click', async () => {
    sairBtn.disabled = true;
    await window.supabase.auth.signOut();
    sairBtn.disabled = false;
  });

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

  async function buscarNomePerfil(userId) {
    const { data } = await window.supabase
      .from('perfis')
      .select('nome')
      .eq('id', userId)
      .maybeSingle();
    return data?.nome || null;
  }

  async function atualizarUiLogado(session) {
    if (!session) {
      atualizarIconeNav(false, '');
      mostrarTela(telaEmail);
      return;
    }
    const email = session.user.email || '';
    const nome  = await buscarNomePerfil(session.user.id);
    const nomeExibido = nome || email;
    const inicial = (nome || email || '?').trim().charAt(0).toUpperCase();

    nomeLogadoEl.textContent  = nomeExibido;
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
