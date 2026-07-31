// Webhook do Resend: guarda o aviso ASSINADO de cada e-mail que sai.
//
// Por quê: enviado_email_em só prova que o Resend ACEITOU o envio. Quem
// diz que chegou (ou que quicou) é o Resend, por aqui — e o registro
// dele expira em 30 dias, então o aviso tem que morar no nosso banco.
//
// Garantias:
// - Assinatura Svix conferida ANTES de qualquer parse; sem assinatura
//   válida nada entra (o endpoint é público, verify_jwt = false).
// - O corpo é guardado CRU: a assinatura só fecha com os bytes exatos.
//   Reserializar (jsonb) destruiria a possibilidade de re-conferir.
// - Idempotência por svix-id (o Svix re-entrega o mesmo aviso).
// - Erro de banco devolve 500 pro Svix re-entregar mais tarde.
// - Quicou/reclamou avisa no Telegram: e-mail errado hoje passa batido.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') || '' // whsec_...
const TG_BOT  = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const TG_CHAT = Deno.env.get('TELEGRAM_CHAT_ID')   || ''

const TOLERANCIA_S = 300 // 5 min de folga no relógio (padrão do Svix)

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

function b64ParaBytes(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesParaB64(bytes: Uint8Array) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

// Comparação de tempo constante: sair no primeiro caractere diferente
// deixa vazar, pelo relógio, quanto do palpite estava certo.
function igualdadeSegura(a: string, b: string) {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

// Svix: assina `${id}.${timestamp}.${corpo}` com HMAC-SHA256 e manda o
// resultado em base64. O header pode trazer várias versões separadas por
// espaço ("v1,aaa v1,bbb") durante uma troca de segredo — basta uma bater.
async function assinaturaConfere(id: string, ts: string, corpo: string, header: string) {
  const bruto = WEBHOOK_SECRET.startsWith('whsec_') ? WEBHOOK_SECRET.slice(6) : WEBHOOK_SECRET
  let chave: CryptoKey
  try {
    chave = await crypto.subtle.importKey(
      'raw', b64ParaBytes(bruto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
  } catch (e) {
    console.error('RESEND_WEBHOOK_SECRET inválido:', e)
    return false
  }
  const mac = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${id}.${ts}.${corpo}`))
  const esperado = bytesParaB64(new Uint8Array(mac))

  return header.split(' ').some(parte => {
    const [versao, assinatura] = parte.split(',')
    return versao === 'v1' && !!assinatura && igualdadeSegura(assinatura, esperado)
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!WEBHOOK_SECRET) {
    console.error('resend-webhook: RESEND_WEBHOOK_SECRET não configurado')
    return json({ error: 'missing RESEND_WEBHOOK_SECRET' }, 500)
  }

  const svixId  = req.headers.get('svix-id')        || ''
  const svixTs  = req.headers.get('svix-timestamp') || ''
  const svixSig = req.headers.get('svix-signature') || ''
  if (!svixId || !svixTs || !svixSig) return json({ error: 'sem cabeçalhos svix' }, 400)

  // Janela de tempo: sem isso, um POST antigo capturado poderia ser
  // reenviado pra sempre — a assinatura dele continua válida.
  const idade = Math.abs(Math.floor(Date.now() / 1000) - Number(svixTs))
  if (!Number(svixTs) || idade > TOLERANCIA_S) return json({ error: 'timestamp fora da janela' }, 400)

  // .text() e NÃO .json(): a assinatura cobre os bytes exatos.
  const corpo = await req.text()
  if (!await assinaturaConfere(svixId, svixTs, corpo, svixSig)) {
    console.warn('resend-webhook: assinatura inválida', svixId)
    return json({ error: 'assinatura inválida' }, 401)
  }

  let evento: Record<string, unknown>
  try {
    evento = JSON.parse(corpo)
  } catch {
    return json({ error: 'corpo não é json' }, 400)
  }

  const dados    = (evento?.data ?? {}) as Record<string, unknown>
  const tipo     = String(evento?.type || 'desconhecido')
  const resendId = String(dados?.email_id || dados?.id || '')
  const para     = Array.isArray(dados?.to) ? dados.to.join(', ') : String(dados?.to || '')
  const ocorrido = String(evento?.created_at || dados?.created_at || '') || null

  const { error } = await supabase.from('email_eventos').insert({
    svix_id:     svixId,
    resend_id:   resendId || null,
    tipo,
    para:        para || null,
    ocorrido_em: ocorrido,
    corpo_cru:   corpo,
    assinatura:  svixSig,
    svix_ts:     svixTs,
  })

  if (error) {
    // 23505 = svix_id repetido: é re-entrega, já está guardado. 200 pra parar.
    if (error.code === '23505') return json({ ok: true, duplicado: true })
    console.error('email_eventos insert:', error.message)
    return json({ error: error.message }, 500) // 500 → o Svix tenta de novo
  }

  if (tipo === 'email.bounced' || tipo === 'email.failed') {
    await alertaTelegram(`⚠️ E-mail NÃO chegou (${tipo})\n\n📧 ${para || '(sem destinatário)'}\n🆔 ${resendId || '—'}\n\nConfira o e-mail do cliente no painel.`)
  } else if (tipo === 'email.complained') {
    await alertaTelegram(`🚩 Cliente marcou como spam\n\n📧 ${para || '(sem destinatário)'}\n🆔 ${resendId || '—'}`)
  }

  return json({ ok: true, tipo })
})
