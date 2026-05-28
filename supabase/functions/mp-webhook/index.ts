// Webhook do Mercado Pago.
// Recebe notificação, valida assinatura (se MP_WEBHOOK_SECRET configurado),
// consulta /v1/payments/{id}, e se aprovado chama RPC confirmar_pedido_pago.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MP_ACCESS_TOKEN   = Deno.env.get('MP_ACCESS_TOKEN')!
const MP_WEBHOOK_SECRET = Deno.env.get('MP_WEBHOOK_SECRET') || ''
const TG_BOT            = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const TG_CHAT           = Deno.env.get('TELEGRAM_CHAT_ID')   || ''

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function verifySignature(req: Request, dataId: string): Promise<boolean> {
  if (!MP_WEBHOOK_SECRET) return true // sem secret configurado, pula validação
  const sigHeader = req.headers.get('x-signature') || ''
  const reqId     = req.headers.get('x-request-id') || ''
  if (!sigHeader || !reqId) return false

  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.trim().split('=').map(s => s.trim())) as [string, string][],
  )
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return false

  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(MP_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest))
  const hex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return hex === v1
}

Deno.serve(async (req) => {
  try {
    // MP manda info via query string E body. Aceitar ambos.
    const url = new URL(req.url)
    const qsType = url.searchParams.get('type') || url.searchParams.get('topic')
    const qsId   = url.searchParams.get('data.id') || url.searchParams.get('id')

    let body: any = {}
    try { body = await req.json() } catch { /* algumas notificações vêm vazias */ }

    const type  = body?.type || qsType
    const dataId = String(body?.data?.id || qsId || '')

    if (!dataId) return j({ ok: true, skipped: 'no data.id' })
    if (type && type !== 'payment') return j({ ok: true, skipped: `type=${type}` })

    // Valida assinatura (se secret configurado)
    if (!(await verifySignature(req, dataId))) {
      return j({ error: 'invalid signature' }, 401)
    }

    // Consulta o pagamento na MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    })
    if (!mpRes.ok) {
      return j({ error: 'mp payment fetch failed', status: mpRes.status }, 400)
    }
    const pay = await mpRes.json()

    if (pay.status !== 'approved') {
      return j({ ok: true, status: pay.status })
    }

    const chave = pay.external_reference
    if (!chave) return j({ error: 'external_reference ausente' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Valida valor contra pedido.valor_total
    const { data: pedido, error: pedErr } = await supabase
      .from('pedidos')
      .select('id, valor_total, status')
      .eq('chave_pedido', chave)
      .maybeSingle()
    if (pedErr || !pedido) return j({ error: 'pedido not found' }, 400)
    if (pedido.status !== 'pendente') return j({ ok: true, skipped: 'already processed' })

    const esperado = Math.round(Number(pedido.valor_total ?? 0) * 100)
    const recebido = Math.round(Number(pay.transaction_amount ?? 0) * 100)
    if (Math.abs(recebido - esperado) > 1) {
      return j({ error: 'amount mismatch', recebido, esperado }, 400)
    }

    const metodo = pay.payment_type_id === 'credit_card' ? 'cartao'
                 : pay.payment_method_id === 'pix' ? 'pix'
                 : (pay.payment_type_id || 'mp')

    const { error: rpcErr } = await supabase.rpc('confirmar_pedido_pago', {
      p_chave:  chave,
      p_metodo: metodo,
    })
    if (rpcErr) return j({ error: 'update failed', detail: rpcErr.message }, 500)

    // Notificação Telegram
    const { data: agendamentos } = await supabase
      .from('agendamentos')
      .select('data_agendamento, hora_inicio, tipo_leitura, terapeuta, valor_cobrado')
      .eq('chave_pedido', chave)

    const { data: pc } = await supabase
      .from('pedidos')
      .select('nome_cliente, whatsapp_cliente, valor_total, metodo_pagamento')
      .eq('chave_pedido', chave)
      .maybeSingle()

    if (TG_BOT && TG_CHAT && pc && agendamentos) {
      const linhas = agendamentos.map((a: any, i: number) => {
        const d = new Date(a.data_agendamento).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        return `  ${i + 1}. ${a.tipo_leitura} — ${d} às ${a.hora_inicio.slice(0,5)} (${a.terapeuta}) — R$ ${Number(a.valor_cobrado).toFixed(2)}`
      }).join('\n')
      const msg = `🔔 *Novo pedido confirmado!*\n\n👤 ${pc.nome_cliente}\n📱 ${pc.whatsapp_cliente}\n\n📋 *Leituras:*\n${linhas}\n\n💰 *Total: R$ ${Number(pc.valor_total).toFixed(2)}*\n💳 ${metodo}`
      const tg = await fetch(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'Markdown' }),
      })
      if (!tg.ok) console.error('Telegram error:', tg.status, await tg.text())
    }

    return j({ ok: true })
  } catch (err) {
    return j({ error: String(err) }, 400)
  }
})
