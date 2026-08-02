// Gera link de checkout InfinitePay (PIX ou cartão de crédito).
// Payload: { chave, nome, whatsapp, metodo: 'online'|'pix'|'cartao', items: [{description, price}] }
// 'online' (botão único do site) libera os dois métodos no checkout;
// 'pix'/'cartao' seguem aceitos para retrocompatibilidade.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HANDLE      = Deno.env.get('INFINITYPAY_HANDLE') ?? ''
const SITE_URL    = Deno.env.get('SITE_URL')            ?? 'https://cocarsagrado.com.br'
const WEBHOOK_URL = Deno.env.get('INFINITYPAY_WEBHOOK_URL') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    const { chave, nome, whatsapp, metodo, items } = await req.json()

    if (!chave || !items?.length) return json({ error: 'chave e items são obrigatórios' }, 400)

    const ipItems = items.map((i: { description: string; price: number | string }) => ({
      quantity: 1,
      price: Math.round(parseFloat(String(i.price).replace(',', '.')) * 100),
      description: i.description,
    }))

    // Revalida o valor contra o pedido já gravado (criar_pedido valida o total
    // contra o catálogo). Sem isso o cliente forjaria items[] baratos e geraria
    // link de R$1 no handle da loja — o webhook rejeitaria, mas o dinheiro já
    // teria entrado (suporte/estorno manual). Amarrar a uma linha real de pedido
    // também impede gerar links de cobrança arbitrários no endpoint aberto.
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'servidor mal configurado' }, 500)

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: pedido, error: pErr } = await supabase
      .from('pedidos')
      .select('valor_total, status')
      .eq('chave_pedido', chave)
      .maybeSingle()

    if (pErr) return json({ error: 'falha ao validar pedido' }, 500)
    if (!pedido) return json({ error: 'pedido não encontrado' }, 404)

    // Pedido que não está mais pendente não ganha link novo: a InfinitePay
    // cobraria de novo (o link não sabe que o pedido já foi quitado) e o
    // webhook depois só ignoraria — dinheiro entrando duas vezes em silêncio.
    if (pedido.status !== 'pendente') {
      return json({
        error: pedido.status === 'pago' ? 'pedido já pago' : 'pedido cancelado',
        status: pedido.status,
      }, 409)
    }

    // Tolerância de 1 centavo, a MESMA do webhook (que rejeita recebido <
    // esperado-1). Com folga maior aqui, o link sairia até 5c abaixo do
    // pedido, o cliente pagaria e o webhook travaria a confirmação.
    const totalItens = ipItems.reduce((s: number, i: { price: number }) => s + i.price, 0)
    const totalPedido = Math.round(Number(pedido.valor_total) * 100)
    if (Math.abs(totalItens - totalPedido) > 1) {
      return json({ error: 'valor dos itens não confere com o pedido' }, 400)
    }

    // Email plus-address da loja: pré-preenche o checkout (cliente não digita)
    // e o recibo cai filtrado/arquivado no Gmail da loja.
    const fone = String(whatsapp ?? '').replace(/\D/g, '')

    const payload: Record<string, unknown> = {
      handle: HANDLE,
      items: ipItems,
      order_nsu: chave,
      redirect_url: SITE_URL,
      payment_methods: metodo === 'pix' ? ['pix'] : metodo === 'cartao' ? ['credit'] : ['pix', 'credit'],
      ...(WEBHOOK_URL && { webhook_url: WEBHOOK_URL }),
      customer: {
        email: 'cocarsagrado+ip@gmail.com',
        ...(nome && { name: nome }),
        ...(fone && { phone_number: fone }),
      },
    }

    const res = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await res.json().catch(() => null)

    // A resposta crua da InfinitePay fica no log da function, nunca no
    // cliente: é endpoint aberto e o corpo pode carregar detalhe interno.
    if (!res.ok) {
      console.error('InfinitePay /links HTTP', res.status, JSON.stringify(data)?.slice(0, 500))
      return json({ error: 'falha ao gerar link de pagamento' }, 500)
    }

    const url = data?.url ?? data?.link ?? data?.checkout_url ?? data?.payment_url
    if (!url) {
      console.error('InfinitePay /links sem URL:', JSON.stringify(data)?.slice(0, 500))
      return json({ error: 'falha ao gerar link de pagamento' }, 500)
    }

    return json({ url })
  } catch (err) {
    console.error('checkout exception:', err)
    return json({ error: 'erro interno' }, 500)
  }
})
