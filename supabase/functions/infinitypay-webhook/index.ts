// Webhook InfinitePay: valida pagamento e confirma pedido.
// InfinitePay chama este endpoint com { order_nsu, transaction_nsu, capture_method }.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TG_BOT  = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const TG_CHAT = Deno.env.get('TELEGRAM_CHAT_ID')   || ''

// Escapa caracteres que quebram o parse_mode Markdown do Telegram
function esc(s: unknown) {
  return String(s ?? '').replace(/([_*`\[])/g, '\\$1')
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  try {
    const body = await req.json()

    const chave          = body.order_nsu
    const transactionNsu = body.transaction_nsu
    const captureMethod  = body.capture_method ?? 'cartao'

    if (!chave || !transactionNsu) {
      return json({ error: 'missing order_nsu or transaction_nsu' }, 400)
    }

    // Verifica pagamento na InfinitePay
    const checkRes = await fetch('https://api.infinitepay.io/invoices/public/checkout/payment_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_nsu: chave, transaction_nsu: transactionNsu }),
    })

    if (!checkRes.ok) {
      return json({ error: 'payment_check request failed', status: checkRes.status }, 400)
    }

    const check = await checkRes.json()

    if (!check.paid) {
      return json({ error: 'payment not confirmed by InfinitePay' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: pedido, error: pedErr } = await supabase
      .from('pedidos')
      .select('id, valor_total, status')
      .eq('chave_pedido', chave)
      .maybeSingle()

    if (pedErr || !pedido) return json({ error: 'pedido not found' }, 400)
    if (pedido.status !== 'pendente') return json({ ok: true, skipped: 'already processed' })

    const esperado = Math.round(Number(pedido.valor_total ?? 0) * 100)
    const recebido = Number(check.amount ?? 0)
    if (Math.abs(recebido - esperado) > 1) {
      return json({ error: 'amount mismatch', recebido, esperado }, 400)
    }

    const { error: rpcErr } = await supabase.rpc('confirmar_pedido_pago', {
      p_chave:  chave,
      p_metodo: captureMethod,
    })
    if (rpcErr) return json({ error: 'update failed', detail: rpcErr.message }, 500)

    // Notificação Telegram
    if (TG_BOT && TG_CHAT) {
      const { data: agendamentos } = await supabase
        .from('agendamentos')
        .select('data_agendamento, hora_inicio, tipo_leitura, terapeuta, valor_cobrado')
        .eq('chave_pedido', chave)

      const { data: pc } = await supabase
        .from('pedidos')
        .select('cliente_nome, cliente_whatsapp, valor_total')
        .eq('chave_pedido', chave)
        .maybeSingle()

      if (pc && agendamentos) {
        const linhas = agendamentos.map((a: any, i: number) => {
          const d = new Date(a.data_agendamento).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
          return `  ${i + 1}. ${esc(a.tipo_leitura)} — ${d} às ${a.hora_inicio.slice(0, 5)} (${esc(a.terapeuta)}) — R$ ${Number(a.valor_cobrado).toFixed(2)}`
        }).join('\n')
        const msg = `🔔 *Novo pedido confirmado!*\n\n👤 ${esc(pc.cliente_nome)}\n📱 ${esc(pc.cliente_whatsapp)}\n\n📋 *Leituras:*\n${linhas}\n\n💰 *Total: R$ ${Number(pc.valor_total).toFixed(2)}*\n💳 ${esc(captureMethod)}`
        const tg = await fetch(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'Markdown' }),
        })
        if (!tg.ok) console.error('Telegram error:', tg.status, await tg.text())
      }
    }

    return json({ ok: true })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
