const ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN') ?? ''
const SITE_URL     = Deno.env.get('SITE_URL') ?? 'https://cocarsagrado.com.br'
const WEBHOOK_URL  = Deno.env.get('WEBHOOK_URL') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    const { chave, tipo, valor, nome } = await req.json()
    const unitPrice = parseFloat(String(valor).replace(',', '.'))

    const preference = {
      items: [{
        title: tipo,
        quantity: 1,
        unit_price: unitPrice,
        currency_id: 'BRL',
      }],
      ...(nome && { payer: { name: nome } }),
      back_urls: {
        success: SITE_URL,
        failure: SITE_URL,
        pending: SITE_URL,
      },
      auto_return: 'approved',
      external_reference: chave,
      ...(WEBHOOK_URL && { notification_url: WEBHOOK_URL }),
      payment_methods: {
        excluded_payment_types: [
          { id: 'debit_card' },
          { id: 'bank_transfer' },
          { id: 'ticket' },
          { id: 'atm' },
        ],
        installments: 12,
      },
    }

    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    })

    const data = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ url: data.init_point }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
