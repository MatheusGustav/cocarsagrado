// Cria pagamento no Mercado Pago.
// - tipo "pix"   : retorna QR Code + código copia-e-cola + payment_id
// - tipo "cartao": recebe token+installments do Brick e cria payment
// external_reference = chave_pedido → o webhook usa pra confirmar.

const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const NOTIFICATION_URL = `${SUPABASE_URL}/functions/v1/mp-webhook`

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function emailFromWhatsapp(wpp: string): string {
  const digits = (wpp || '').replace(/\D/g, '') || 'cliente'
  return `wpp${digits}@cocarsagrado.com.br`
}

function splitNome(nome: string): { first: string; last: string } {
  const parts = (nome || '').trim().split(/\s+/)
  return {
    first: parts[0] || 'Cliente',
    last:  parts.slice(1).join(' ') || 'CocarSagrado',
  }
}

function valorTotal(items: any[] | undefined, valor: any): number {
  if (Array.isArray(items) && items.length) {
    return items.reduce((acc, it) => {
      const p = parseFloat(String(it.price).replace(',', '.'))
      return acc + (Number.isFinite(p) ? p : 0)
    }, 0)
  }
  const v = parseFloat(String(valor ?? 0).replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

function descricao(items: any[] | undefined, tipo: string | undefined): string {
  if (Array.isArray(items) && items.length) {
    return items.map(it => it.description).join(' + ').slice(0, 250)
  }
  return tipo || 'Leitura'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    const body = await req.json()
    const { tipo, chave, nome, whatsapp, items, valor } = body

    if (!chave) return json({ error: 'chave do pedido ausente' }, 400)
    if (!tipo || (tipo !== 'pix' && tipo !== 'cartao')) {
      return json({ error: 'tipo inválido (use pix ou cartao)' }, 400)
    }

    const total = valorTotal(items, valor)
    if (total <= 0) return json({ error: 'valor inválido' }, 400)

    const { first, last } = splitNome(nome)
    const payerEmail = emailFromWhatsapp(whatsapp)

    // Base do payload comum a Pix e Cartão
    const payload: Record<string, unknown> = {
      transaction_amount: Math.round(total * 100) / 100,
      description: descricao(items, body.tipo_leitura),
      external_reference: chave,
      notification_url: NOTIFICATION_URL,
      statement_descriptor: 'COCARSAGRADO',
    }

    if (tipo === 'pix') {
      payload.payment_method_id = 'pix'
      payload.payer = {
        email: payerEmail,
        first_name: first,
        last_name: last,
      }
    } else {
      // cartao
      const { token, installments, payment_method_id, issuer_id, payer } = body
      if (!token || !installments || !payment_method_id) {
        return json({ error: 'dados do cartão incompletos (token/installments/payment_method_id)' }, 400)
      }
      payload.token = token
      payload.installments = Number(installments)
      payload.payment_method_id = payment_method_id
      if (issuer_id) payload.issuer_id = issuer_id
      payload.payer = {
        email: payer?.email || payerEmail,
        first_name: first,
        last_name: last,
        identification: payer?.identification,
      }
    }

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': `${chave}-${tipo}`,
      },
      body: JSON.stringify(payload),
    })

    const data = await mpRes.json().catch(() => ({}))

    if (!mpRes.ok) {
      const msg = data?.message || data?.error || 'falha ao criar pagamento'
      return json({ error: msg, mp_status: mpRes.status, mp_data: data }, 400)
    }

    if (tipo === 'pix') {
      const poi = data?.point_of_interaction?.transaction_data || {}
      return json({
        payment_id: data.id,
        status: data.status,
        qr_code: poi.qr_code,                 // copia-e-cola
        qr_code_base64: poi.qr_code_base64,   // imagem PNG base64
        ticket_url: poi.ticket_url,
      })
    }

    // cartao
    return json({
      payment_id: data.id,
      status: data.status,                  // approved | in_process | rejected | pending
      status_detail: data.status_detail,
    })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
