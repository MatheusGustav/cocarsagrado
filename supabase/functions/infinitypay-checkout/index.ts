// Gera link de checkout InfinitePay (PIX ou cartão de crédito).
// Payload: { chave, nome, whatsapp, metodo: 'pix'|'cartao', items: [{description, price}] }
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

    // Email plus-address da loja: pré-preenche o checkout (cliente não digita)
    // e o recibo cai filtrado/arquivado no Gmail da loja.
    const fone = String(whatsapp ?? '').replace(/\D/g, '')

    const payload: Record<string, unknown> = {
      handle: HANDLE,
      items: ipItems,
      order_nsu: chave,
      redirect_url: SITE_URL,
      payment_methods: metodo === 'pix' ? ['pix'] : ['credit'],
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

    const data = await res.json()

    if (!res.ok) return json({ error: data }, 500)

    const url = data.url ?? data.link ?? data.checkout_url ?? data.payment_url
    if (!url) return json({ error: 'URL não retornada pela InfinitePay', data }, 500)

    return json({ url })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
