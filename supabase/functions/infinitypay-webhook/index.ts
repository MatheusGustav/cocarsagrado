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

    // Busca o pedido pai por chave_pedido (order_nsu)
    const { data: pedido, error: pedErr } = await supabase
      .from('pedidos')
      .select('id, valor_total, status')
      .eq('chave_pedido', chave)
      .maybeSingle()

    if (pedErr || !pedido) {
      return new Response(JSON.stringify({ error: 'pedido not found' }), { status: 400 })
    }

    if (pedido.status !== 'pendente') {
      return new Response(JSON.stringify({ error: 'pedido already processed' }), { status: 400 })
    }

    // Valida amount contra pedido.valor_total
    const esperado = Math.round(Number(pedido.valor_total ?? 0) * 100)
    const recebido = Number(check.amount ?? 0)
    if (Math.abs(recebido - esperado) > 1) {
      return new Response(
        JSON.stringify({ error: 'amount mismatch', recebido, esperado }),
        { status: 400 },
      )
    }

    // Atualização atômica do pai + filhos numa única transação (RPC).
    // Evita o estado inconsistente "pedido pago / agendamentos pendentes".
    const { error: rpcErr } = await supabase.rpc('confirmar_pedido_pago', {
      p_chave:  chave,
      p_metodo: captureMethod,
    })
    if (rpcErr) {
      return new Response(
        JSON.stringify({ error: 'update failed', detail: rpcErr.message }),
        { status: 500 },
      )
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 400 })
  }
})
