import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const body = await req.json()

    const chave        = body.order_nsu
    const paidAmount   = Number(body.paid_amount ?? 0)   // em centavos
    const captureMethod = body.capture_method ?? 'cartao'

    if (!chave) {
      return new Response(JSON.stringify({ error: 'no order_nsu' }), { status: 400 })
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

    // valor_final no DB está em reais → converter para centavos para comparar
    const esperado = Math.round(Number(ag.valor_final ?? 0) * 100)
    if (Math.abs(paidAmount - esperado) > 1) {
      return new Response(
        JSON.stringify({ error: 'amount mismatch', paidAmount, esperado }),
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
