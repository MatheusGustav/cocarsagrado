/* ==========================================================
   Descadastro do lembrete de recompra
   ----------------------------------------------------------
   Chega aqui pelo rodapé do e-mail: /descadastro?e=<email>&t=<token>.
   O token é HMAC do e-mail (segredo no Vault) — sem ele ninguém
   descadastra o e-mail alheio. Quem confere é a RPC.

   O clique do cliente é que descadastra, NÃO o carregamento da
   página: Gmail e Outlook abrem os links do e-mail sozinhos pra
   checar vírus, e no automático isso tirava da lista quem nunca
   clicou em nada.

   Depende de: supabase-config.js (window.supabase inicializado)
   ========================================================== */

(function () {
  'use strict';

  function mostrar(id) {
    ['desc-carregando', 'desc-invalido', 'desc-confirmar', 'desc-sucesso']
      .forEach(function (el) {
        var no = document.getElementById(el);
        if (no) no.hidden = (el !== id);
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(location.search);
    var email  = (params.get('e') || '').trim();
    var token  = (params.get('t') || '').trim();

    if (!email || !token || !window.supabase || !window.supabase.rpc) {
      mostrar('desc-invalido');
      return;
    }

    // Só o rosto do e-mail na tela — confirmar é papel da RPC.
    var alvo = document.getElementById('desc-email');
    if (alvo) alvo.textContent = email;
    mostrar('desc-confirmar');

    var btn  = document.getElementById('desc-btn');
    var txt  = document.getElementById('desc-btn-txt');
    var nota = document.getElementById('desc-nota');
    if (!btn) return;

    btn.addEventListener('click', function () {
      btn.disabled = true;
      if (txt) txt.textContent = 'SAINDO DA LISTA…';

      window.supabase
        .rpc('descadastrar_email', { p_email: email, p_token: token })
        .then(function (res) {
          // A RPC devolve false quando o token não bate com o e-mail.
          if (res.error || res.data !== true) {
            mostrar('desc-invalido');
            return;
          }
          mostrar('desc-sucesso');
        })
        .catch(function () {
          btn.disabled = false;
          if (txt)  txt.textContent  = 'NÃO QUERO MAIS RECEBER';
          if (nota) nota.textContent = 'A internet oscilou — tenta de novo?';
        });
    });
  });
})();
