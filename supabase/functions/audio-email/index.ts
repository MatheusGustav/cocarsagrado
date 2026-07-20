// Entrega da leitura em áudio por e-mail (Resend, com anexo).
// Decisão 2026-07-19: cliente não precisa de conta — o e-mail com o
// áudio anexado É o histórico dele.
//
// Chamadas:
// - Painel admin ao tocar no ✉️ de um áudio salvo ({ audio_id }): envio
//   imediato, JWT admin no Authorization (is_admin exige aal2).
// - pg_cron a cada 10 min (body {}): varre os LIBERADOS pendentes — retry
//   de falha de rede/painel fechado. Gate: header x-cron-secret (mesmo
//   secret do emails-cron).
//
// Garantias:
// - Salvar não envia nada sozinho: só entra na fila áudio que a admin
//   liberou no painel (email_liberado_em preenchido).
// - Só envia com pedido pago (status pago/confirmado/atendido) e com
//   e-mail no agendamento; o resto fica pendente pro cron re-olhar.
// - Anexo até ANEXO_MAX_BYTES (~24MB — teto prático do Resend após o
//   inchaço do base64). Maior que isso: botão com link assinado (90d).
// - Idempotência: enviado_email_em marca o envio; a fila só devolve NULL.
// - Falha num envio não derruba os demais; falhas avisam no Telegram.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const CRON_SECRET    = Deno.env.get('CRON_SECRET')     || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')  || ''
const EMAIL_FROM     = Deno.env.get('EMAIL_FROM')      || ''
const SITE_URL       = Deno.env.get('SITE_URL')        || 'https://cocarsagrado.com'
const TG_BOT         = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const TG_CHAT        = Deno.env.get('TELEGRAM_CHAT_ID')   || ''

const ANEXO_MAX_BYTES  = 24 * 1024 * 1024   // acima disso vai link assinado
const LINK_VALIDADE_S  = 90 * 24 * 60 * 60  // 90 dias

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

function dataBR(iso: unknown) {
  const s = String(iso ?? '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-')
    return `${d}/${m}/${y}`
  }
  return s
}

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function primeiroNome(nome: string) {
  return String(nome || '').trim().split(/\s+/)[0] || 'cliente'
}

const EXT: Record<string, string> = {
  'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
}

// Mesma moldura do emails-cron (Gmail-proof: tabela fluida, já nasce
// escura), com rodapé transacional — este e-mail É a entrega do produto,
// não marketing; não tem opt-out.
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
          Você recebe este e-mail porque pediu uma leitura em
          <a href="${SITE_URL}" style="color:#D9B776;">nosso site</a>.
          Guarde-o com carinho — ele é o registro da sua leitura.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function emailAnexo(nome: string, tipo: string, data: string) {
  return moldura(`
    <p style="margin:0 0 12px;">Olá, <strong>${esc(primeiroNome(nome))}</strong>.</p>
    <p style="margin:0 0 12px;">Sua <strong style="color:#D9B776;">${esc(tipo)}</strong>
      do dia ${dataBR(data)} está pronta. 🌙</p>
    <p style="margin:0;">O áudio está <strong>anexado neste e-mail</strong> —
      é só tocar pra ouvir, no seu tempo, quantas vezes quiser.</p>
  `)
}

function emailLink(nome: string, tipo: string, data: string, url: string) {
  return moldura(`
    <p style="margin:0 0 12px;">Olá, <strong>${esc(primeiroNome(nome))}</strong>.</p>
    <p style="margin:0 0 12px;">Sua <strong style="color:#D9B776;">${esc(tipo)}</strong>
      do dia ${dataBR(data)} está pronta. 🌙</p>
    <p style="margin:0;">O áudio ficou longo demais pra viajar anexado —
      toque no botão pra ouvir e baixar (guarde o arquivo: o botão vale por 90 dias).</p>
    <div style="text-align:center;margin:24px 0 4px;">
      <a href="${url}" style="display:inline-block;background:#C0954E;color:#13251A;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 28px;border-radius:999px;">▶ Ouvir minha leitura</a>
    </div>
  `)
}

async function enviarResend(to: string, subject: string, html: string,
                            anexo?: { filename: string; content: string; content_type: string }) {
  const body: Record<string, unknown> = { from: EMAIL_FROM, to: [to], subject, html }
  if (anexo) body.attachments = [anexo]
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

Deno.serve(async (req) => {
  // Gate 1: cron (x-cron-secret). Gate 2: admin logado (JWT + is_admin).
  const ehCron = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET
  if (!ehCron) {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)
    const cliente = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    )
    const { data: ehAdmin, error } = await cliente.rpc('is_admin')
    if (error || ehAdmin !== true) return json({ error: 'unauthorized' }, 401)
  }
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    console.error('audio-email: RESEND_API_KEY/EMAIL_FROM não configurados')
    return json({ error: 'missing RESEND_API_KEY or EMAIL_FROM' }, 500)
  }

  const body = await req.json().catch(() => null)
  const audioId = Number(body?.audio_id) || null

  let query = supabase
    .from('audios_cliente')
    .select(`id, storage_path, mime, tamanho_bytes, agendamentos!inner(
      cliente_nome, cliente_email, data_agendamento, status, tipos_leitura(nome))`)
    .is('enviado_email_em', null)
    .not('email_liberado_em', 'is', null)
  if (audioId) query = query.eq('id', audioId)

  const { data: fila, error } = await query
  if (error) {
    console.error('fila:', error.message)
    return json({ error: error.message }, 500)
  }
  if (!fila?.length) return json({ ok: true, enviados: 0 })

  let enviados = 0
  let pulados = 0
  const falhas: string[] = []

  for (const a of fila) {
    const ag = a.agendamentos as Record<string, unknown> | null
    const email  = String(ag?.cliente_email || '').trim()
    const status = String(ag?.status || '')
    // Sem e-mail ou sem pagamento confirmado: fica pendente, o cron re-olha.
    if (!email || !['pago', 'confirmado', 'atendido'].includes(status)) { pulados++; continue }

    const nome = String(ag?.cliente_nome || '')
    const tipo = String((ag?.tipos_leitura as Record<string, unknown>)?.nome || 'leitura')
    const data = String(ag?.data_agendamento || '')

    try {
      const subject = '🪶 Sua leitura chegou — Cocar Sagrado'
      const mime    = String(a.mime || 'audio/webm')
      const tamanho = Number(a.tamanho_bytes) || 0

      if (tamanho > 0 && tamanho <= ANEXO_MAX_BYTES) {
        const { data: blob, error: dlErr } = await supabase.storage.from('audios').download(a.storage_path)
        if (dlErr || !blob) throw new Error(`download: ${dlErr?.message || 'vazio'}`)
        const anexo = {
          filename: `sua-leitura-${dataBR(data).replaceAll('/', '-')}.${EXT[mime] || 'webm'}`,
          content: encodeBase64(new Uint8Array(await blob.arrayBuffer())),
          content_type: mime,
        }
        await enviarResend(email, subject, emailAnexo(nome, tipo, data), anexo)
      } else {
        const { data: signed, error: urlErr } = await supabase.storage
          .from('audios').createSignedUrl(a.storage_path, LINK_VALIDADE_S)
        if (urlErr || !signed?.signedUrl) throw new Error(`signedUrl: ${urlErr?.message || 'vazio'}`)
        await enviarResend(email, subject, emailLink(nome, tipo, data, signed.signedUrl))
      }

      // Marca DEPOIS do envio: se o update falhar, o pior caso é reenvio
      // no próximo tick (cliente recebe 2×, nunca 0×).
      const { error: upErr } = await supabase.from('audios_cliente')
        .update({ enviado_email_em: new Date().toISOString() }).eq('id', a.id)
      if (upErr) console.error('marca enviado:', upErr.message)
      enviados++

      // Resend limita ~2 req/s — pausa curta entre envios.
      if (fila.length > 1) await new Promise(r => setTimeout(r, 600))
    } catch (e) {
      console.error(`envio falhou (audio ${a.id}):`, e)
      falhas.push(`audio ${a.id} → ${email}: ${String(e).slice(0, 120)}`)
    }
  }

  if (falhas.length) {
    await alertaTelegram(`⚠️ E-mail de áudio com falha (${falhas.length}):\n\n${falhas.join('\n')}`)
  }
  return json({ ok: true, enviados, pulados, falhas: falhas.length })
})
