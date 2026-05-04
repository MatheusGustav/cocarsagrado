import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MP_TOKEN  = Deno.env.get('MP_ACCESS_TOKEN')!
const MP_SECRET = Deno.env.get('MP_WEBHOOK_SECRET') ?? ''

// Mercado Pago x-signature header: "ts=<ts>,v1=<hash>"
// Hash = HMAC-SHA256( "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" , secret )
async function _verificarAssinatura(req: Request, dataId: string): Promise<boolean> {
  if (!MP_SECRET) return true // sem secret configurado: aceita (modo dev)

  const sigHeader = req.headers.get('x-signature') ?? ''
  const requestId = req.headers.get('x-request-id') ?? ''
  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.trim().split('=').map(s => s.trim())),
  ) as Record<string, string>

  const ts   = parts.ts
  const v1   = parts.v1
  if (!ts || !v1) return false

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(MP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest))
  const hex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return hex === v1
}

Deno.serve(async (req) => {
  try {
    const body = await req.json()

    if (body.type !== 'payment') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const paymentId = body.data?.id
    if (!paymentId) {
      return new Response(JSON.stringify({ error: 'no payment id' }), { status: 400 })
    }

    if (!(await _verificarAssinatura(req, String(paymentId)))) {
      return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401 })
    }

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_TOKEN}` },
    })
    const payment = await paymentRes.json()

    if (payment.status !== 'approved') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const chave = payment.external_reference
    if (!chave) {
      return new Response(JSON.stringify({ error: 'no external_reference' }), { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Confere o valor pago contra o valor_final do agendamento (evita pagamento parcial)
    const { data: ag, error: agErr } = await supabase
      .from('agendamentos')
      .select('valor_final, status')
      .eq('chave_pedido', chave)
      .maybeSingle()

    if (agErr || !ag) {
      return new Response(JSON.stringify({ error: 'agendamento not found' }), { status: 404 })
    }

    const pago = Number(payment.transaction_amount ?? 0)
    const esperado = Number(ag.valor_final ?? 0)
    if (Math.abs(pago - esperado) > 0.01) {
      return new Response(
        JSON.stringify({ error: 'amount mismatch', pago, esperado }),
        { status: 400 },
      )
    }

    await supabase
      .from('agendamentos')
      .update({ status: 'pago', pago_em: new Date().toISOString(), metodo_pagamento: 'cartao' })
      .eq('chave_pedido', chave)
      .eq('status', 'pendente')

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 400 })
  }
})
