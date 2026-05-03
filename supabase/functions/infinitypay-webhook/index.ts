import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const body = await req.json()

    // Ignorar notificações que não sejam pagamento
    if (body.type !== 'payment') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const paymentId = body.data?.id
    if (!paymentId) {
      return new Response(JSON.stringify({ error: 'no payment id' }), { status: 400 })
    }

    const accessToken = Deno.env.get('MP_ACCESS_TOKEN')!

    // Buscar detalhes do pagamento para obter external_reference (nossa chave)
    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
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

    await supabase
      .from('agendamentos')
      .update({ status: 'pago' })
      .eq('chave', chave)
      .eq('status', 'pendente')

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 400 })
  }
})
