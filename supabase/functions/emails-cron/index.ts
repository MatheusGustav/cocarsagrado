// E-mails automáticos (Resend): cupom pessoal ganho + lembrete de recompra.
// Chamada pelo pg_cron a cada 15 min (job 'emails-cron'); o gate é o header
// x-cron-secret (mesmo valor no Vault 'cron_emails_secret' e no env CRON_SECRET).
//
// Garantias:
// - Só sai e-mail pra quem marcou o opt-in (perfis.aceita_emails) — a fila
//   inteira vem pronta da RPC emails_pendentes() (service_role).
// - Idempotência: cada envio vira linha em emails_enviados (UNIQUE tipo+ref);
//   a RPC não devolve de novo o que já foi enviado.
// - Falha num envio não derruba os demais; falhas disparam aviso no Telegram
//   (best-effort, como no webhook de pagamento).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CRON_SECRET    = Deno.env.get('CRON_SECRET')     || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')  || ''
const EMAIL_FROM     = Deno.env.get('EMAIL_FROM')      || ''   // ex: "Cocar Sagrado <contato@dominio>"
const SITE_URL       = Deno.env.get('SITE_URL')        || 'https://cocarsagrado.com'
const TG_BOT         = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const TG_CHAT        = Deno.env.get('TELEGRAM_CHAT_ID')   || ''

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function alertaTelegram(texto: string) {
  if (!TG_BOT || !TG_CHAT) return
  try {
    const tg = await fetch(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: texto }),
    })
    if (!tg.ok) console.error('Telegram alerta error:', tg.status, await tg.text())
  } catch (e) {
    console.error('Telegram alerta exception:', e)
  }
}

const brl = (v: unknown) => {
  const n = Number(v) || 0
  return Number.isInteger(n) ? `R$ ${n}` : `R$ ${n.toFixed(2).replace('.', ',')}`
}

// 'YYYY-MM-DD...' -> 'DD/MM/YYYY' (sem Date(): evita shift de fuso)
function dataBR(iso: unknown) {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-')
  return (y && m && d) ? `${d}/${m}/${y}` : ''
}

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Moldura no clima do site (céu verde-noite + dourado); conteúdo por tipo.
// Regras de sobrevivência no Gmail:
// - Tabela fluida (width=100% + max-width), NÃO div de largura fixa — div
//   fixa faz o Gmail mobile dar zoom e a letra explodir.
// - Já nasce escura: cartão claro o modo escuro do Gmail inverte à força
//   e vira lama; design escuro ele deixa em paz.
function moldura(miolo: string) {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#0E2117;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E2117;">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr><td align="center" style="padding:0 0 18px;font-family:Georgia,'Times New Roman',serif;">
          <div style="font-size:26px;line-height:1;">🪶</div>
          <div style="color:#D9B776;font-size:17px;letter-spacing:3px;padding-top:8px;">COCAR SAGRADO</div>
        </td></tr>
        <tr><td style="background:#142E20;border:1px solid #2C4A38;border-radius:14px;padding:24px 22px;font-family:Georgia,'Times New Roman',serif;color:#EFE9DB;font-size:15px;line-height:1.6;">
          ${miolo}
        </td></tr>
        <tr><td align="center" style="padding:16px 8px 0;font-family:Georgia,'Times New Roman',serif;color:#7D8F83;font-size:11px;line-height:1.5;">
          Você recebe estes e-mails porque ativou as novidades na sua conta.
          Para parar, abra <a href="${SITE_URL}" style="color:#D9B776;">o site</a>,
          entre em <strong style="color:#D9B776;">Minha conta</strong> e desligue
          "Receber novidades por e-mail".
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

// "Matheus Gustav Koblinger de Almeida" → "Matheus" (e-mail é conversa, não boleto)
function primeiroNome(nome: string) {
  return String(nome || '').trim().split(/\s+/)[0] || 'cliente'
}

function emailCupom(nome: string, payload: Record<string, unknown>) {
  const validade = payload.expira_em
    ? `<p style="margin:14px 0 0;font-size:13px;color:#A8B5AA;">Válido até <strong style="color:#EFE9DB;">${dataBR(payload.expira_em)}</strong>.</p>`
    : ''
  return {
    subject: '✦ Você ganhou um cupom — Cocar Sagrado',
    html: moldura(`
      <p style="margin:0 0 12px;">Olá, <strong>${esc(primeiroNome(nome))}</strong>.</p>
      <p style="margin:0;">Um presente apareceu na sua conta: um cupom de
        <strong style="color:#D9B776;">${brl(payload.valor)}</strong> de desconto, só seu.</p>
      <div style="text-align:center;margin:22px 0;">
        <span style="display:inline-block;background:#0E2117;border:1px solid #C0954E;color:#D9B776;font-size:20px;letter-spacing:4px;padding:12px 24px;border-radius:10px;">${esc(payload.codigo)}</span>
      </div>
      <p style="margin:0;">É só digitar o código na revisão do seu próximo pedido.
        Ele também fica guardado em <strong>Minha conta → Seus cupons</strong>.</p>
      ${validade}
      <div style="text-align:center;margin:24px 0 4px;">
        <a href="${SITE_URL}" style="display:inline-block;background:#C0954E;color:#13251A;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 28px;border-radius:999px;">Escolher minha leitura</a>
      </div>
    `),
  }
}

function emailAniversario(nome: string, payload: Record<string, unknown>) {
  const validade = payload.expira_em
    ? `<p style="margin:14px 0 0;font-size:13px;color:#A8B5AA;">Vale até <strong style="color:#EFE9DB;">${dataBR(payload.expira_em)}</strong> — depois a estrela se apaga.</p>`
    : ''
  return {
    subject: '✦ Feliz aniversário! Um presente te espera — Cocar Sagrado',
    html: moldura(`
      <p style="margin:0 0 12px;">Feliz aniversário, <strong>${esc(primeiroNome(nome))}</strong>! 🌙</p>
      <p style="margin:0;">Hoje o céu gira em sua homenagem — e deixamos um presente
        na sua conta: <strong style="color:#D9B776;">${brl(payload.valor)}</strong> de
        desconto em qualquer leitura.</p>
      <div style="text-align:center;margin:22px 0;">
        <span style="display:inline-block;background:#0E2117;border:1px solid #C0954E;color:#D9B776;font-size:20px;letter-spacing:4px;padding:12px 24px;border-radius:10px;">${esc(payload.codigo)}</span>
      </div>
      <p style="margin:0;">É só digitar o código na revisão do seu pedido.
        Ele também fica guardado em <strong>Minha conta → Seus cupons</strong>.</p>
      ${validade}
      <div style="text-align:center;margin:24px 0 4px;">
        <a href="${SITE_URL}" style="display:inline-block;background:#C0954E;color:#13251A;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 28px;border-radius:999px;">Escolher meu presente</a>
      </div>
    `),
  }
}

function emailLembrete(nome: string, payload: Record<string, unknown>) {
  return {
    subject: '✦ As cartas sentem sua falta — Cocar Sagrado',
    html: moldura(`
      <p style="margin:0 0 12px;">Olá, <strong>${esc(primeiroNome(nome))}</strong>.</p>
      <p style="margin:0 0 12px;">Já faz uma lua desde a sua
        <strong style="color:#D9B776;">${esc(payload.tipo_nome)}</strong>,
        no dia ${dataBR(payload.data)}. Muita coisa se move em um ciclo — talvez
        seja hora de olhar as cartas de novo.</p>
      <p style="margin:0;">Quando sentir o chamado, estamos aqui.</p>
      <div style="text-align:center;margin:24px 0 4px;">
        <a href="${SITE_URL}" style="display:inline-block;background:#C0954E;color:#13251A;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 28px;border-radius:999px;">Ver as leituras</a>
      </div>
    `),
  }
}

async function enviarResend(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  })
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    console.error('emails-cron: RESEND_API_KEY/EMAIL_FROM não configurados')
    return json({ error: 'missing RESEND_API_KEY or EMAIL_FROM' }, 500)
  }

  // Modo prévia (dev): { preview: 'cupom'|'lembrete', to: 'email' } manda um
  // exemplo com dados fictícios — pra revisar o visual sem forjar dados no
  // banco. Não toca em emails_enviados. Exige o mesmo x-cron-secret.
  const body = await req.json().catch(() => null)
  if (body?.preview && body?.to) {
    const amostra = body.preview === 'lembrete'
      ? emailLembrete('Matheus', { tipo_nome: 'Leitura de Naipes da Pomba Gira', data: '2026-06-02' })
      : body.preview === 'aniversario'
        ? emailAniversario('Matheus', { codigo: 'NIVER26-EXEMPLO', valor: 15, expira_em: '2026-07-09T23:59:59-03:00' })
        : emailCupom('Matheus', { codigo: 'EXEMPLO10', valor: 10, expira_em: '2026-07-31T23:59:59-03:00' })
    try {
      await enviarResend(String(body.to), `[PRÉVIA] ${amostra.subject}`, amostra.html)
      return json({ ok: true, preview: body.preview })
    } catch (e) {
      return json({ error: String(e) }, 500)
    }
  }

  const { data: fila, error } = await supabase.rpc('emails_pendentes')
  if (error) {
    console.error('emails_pendentes:', error.message)
    return json({ error: error.message }, 500)
  }
  if (!fila?.length) return json({ ok: true, enviados: 0 })

  let enviados = 0
  const falhas: string[] = []

  for (const item of fila) {
    try {
      const { subject, html } = item.tipo === 'cupom_ganho'
        ? emailCupom(item.nome || 'cliente', item.payload || {})
        : item.tipo === 'aniversario'
          ? emailAniversario(item.nome || 'cliente', item.payload || {})
          : emailLembrete(item.nome || 'cliente', item.payload || {})

      await enviarResend(item.email, subject, html)

      // Registra DEPOIS do envio: se o insert falhar o pior caso é um
      // reenvio no próximo tick (o UNIQUE tipo+ref barra duplicata no log).
      const { error: logErr } = await supabase.from('emails_enviados').insert({
        tipo: item.tipo, ref: item.ref, user_id: item.user_id, email: item.email,
      })
      if (logErr) console.error('emails_enviados insert:', logErr.message)
      enviados++

      // Resend limita ~2 req/s — pausa curta entre envios.
      if (fila.length > 1) await new Promise(r => setTimeout(r, 600))
    } catch (e) {
      console.error(`envio falhou (${item.tipo} ${item.ref}):`, e)
      falhas.push(`${item.tipo} ${item.ref}: ${String(e).slice(0, 120)}`)
    }
  }

  if (falhas.length) {
    await alertaTelegram(`⚠️ E-mails automáticos com falha (${falhas.length}):\n\n${falhas.join('\n')}`)
  }
  return json({ ok: true, enviados, falhas: falhas.length })
})
