import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYMENT_CHECK_URL = 'https://api.infinitepay.io/invoices/public/checkout/payment_check'

Deno.serve(async (req) => {
  try {
    const body = await req.json()

    const chave          = body.order_nsu
    const transactionNsu = body.transaction_nsu
    const captureMethod  = body.capture_method ?? 'cartao'

    if (!chave || !transactionNsu) {
      return new Response(JSON.stringify({ error: 'missing order_nsu or transaction_nsu' }), { status: 400 })
    }

    // Verificação server-to-server na InfinityPay
    const checkRes = await fetch(PAYMENT_CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_nsu: chave, transaction_nsu: transactionNsu }),
    })

    if (!checkRes.ok) {
      return new Response(JSON.stringify({ error: 'payment_check request failed' }), { status: 400 })
    }

    const check = await checkRes.json()

    if (!check.paid) {
      return new Response(JSON.stringify({ error: 'payment not confirmed by InfinityPay' }), { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: ag, error: agErr } = await supabase
      .from('agendamentos')
      .select('valor_final, status')
      .eq('chave_pedido', chave)
      .maybeSingle()

    if (agErr || !ag) {
      return new Response(JSON.stringify({ error: 'agendamento not found' }), { status: 400 })
    }

    // Valida usando amount (valor original, sem juros de parcelamento)
    const esperado = Math.round(Number(ag.valor_final ?? 0) * 100)
    const recebido = Number(check.amount ?? 0)
    if (Math.abs(recebido - esperado) > 1) {
      return new Response(
        JSON.stringify({ error: 'amount mismatch', recebido, esperado }),
        { status: 400 },
      )
    }

    await supabase
      .from('agendamentos')
      .update({
        status: 'pago',
        pago_em: new Date().toISOString(),
        metodo_pagamento: captureMethod,
      })
      .eq('chave_pedido', chave)
      .eq('status', 'pendente')

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 400 })
  }
})
