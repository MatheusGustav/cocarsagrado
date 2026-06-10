// Webhook InfinitePay: valida pagamento e confirma pedido.
// InfinitePay chama este endpoint com { order_nsu, transaction_nsu, capture_method }.
//
// Garantias:
// - Toda chamada fica registrada em public.webhook_log (diagnóstico).
// - Valor: aceita recebido >= esperado (juros de parcelamento somam ao
//   total); rejeita só pagamento A MENOR.
// - Respostas não-2xx em condições transitórias para a InfinitePay
//   reentregar o webhook.
// - Falha na notificação Telegram nunca derruba a confirmação,
//   mas fica registrada em webhook_log (resultado 'telegram_erro').
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TG_BOT  = Deno.env.get('TELEGRAM_BOT_TOKEN')  || ''
const TG_CHAT = Deno.env.get('TELEGRAM_CHAT_ID')    || ''
const HANDLE  = Deno.env.get('INFINITYPAY_HANDLE')  || ''

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

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

// Registra o resultado no log (best-effort: nunca lança)
async function log(chave: string | null, resultado: string, detalhe: string, payload?: unknown) {
  try {
    await supabase.from('webhook_log').insert({ chave, resultado, detalhe, payload: payload ?? null })
  } catch (e) {
    console.error('webhook_log insert falhou:', e)
  }
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY' (sem Date(): evita shift de fuso)
function dataBR(iso: string) {
  const [y, m, d] = String(iso).split('-')
  return (y && m && d) ? `${d}/${m}/${y}` : String(iso)
}

async function notificarTelegram(chave: string, captureMethod: string) {
  if (!TG_BOT || !TG_CHAT) return
  try {
    const { data: agendamentos, error: agErr } = await supabase
      .from('agendamentos')
      .select('data_agendamento, hora_agendamento, terapeuta, valor_final, tipos_leitura(nome)')
      .eq('chave_pedido', chave)

    const { data: pc } = await supabase
      .from('pedidos')
      .select('cliente_nome, cliente_whatsapp, valor_total')
      .eq('chave_pedido', chave)
      .maybeSingle()

    if (agErr || !pc || !agendamentos?.length) {
      console.error('Telegram: dados incompletos', agErr?.message)
      await log(chave, 'telegram_erro', `dados incompletos: ${agErr?.message ?? 'pedido/agendamentos não encontrados'}`)
      return
    }

    const linhas = agendamentos.map((a: any, i: number) => {
      const nome = a.tipos_leitura?.nome ?? 'Leitura'
      const hora = (a.hora_agendamento && a.hora_agendamento !== '00:00:00')
        ? ` até ${String(a.hora_agendamento).slice(0, 5)}`
        : ''
      return `  ${i + 1}. ${esc(nome)} — ${dataBR(a.data_agendamento)}${hora} (${esc(a.terapeuta)}) — R$ ${Number(a.valor_final).toFixed(2)}`
    }).join('\n')

    const msg = `🔔 *Novo pedido confirmado!*\n\n🔑 ${esc(chave)}\n👤 ${esc(pc.cliente_nome)}\n📱 ${esc(pc.cliente_whatsapp)}\n\n📋 *Leituras:*\n${linhas}\n\n💰 *Total: R$ ${Number(pc.valor_total).toFixed(2)}*\n💳 ${esc(captureMethod)}`
    const tg = await fetch(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'Markdown' }),
    })
    if (!tg.ok) {
      const detalhe = await tg.text()
      console.error('Telegram error:', tg.status, detalhe)
      await log(chave, 'telegram_erro', `sendMessage HTTP ${tg.status}: ${detalhe.slice(0, 500)}`)
    }
  } catch (e) {
    console.error('Telegram exception:', e)
    await log(chave, 'telegram_erro', String(e))
  }
}

Deno.serve(async (req) => {
  let chave: string | null = null
  try {
    const body = await req.json()

    chave                = body.order_nsu ?? null
    const transactionNsu = body.transaction_nsu
    const captureMethod  = body.capture_method ?? 'cartao'

    if (!chave || !transactionNsu) {
      await log(chave, 'rejeitado', 'payload sem order_nsu/transaction_nsu', body)
      return json({ error: 'missing order_nsu or transaction_nsu' }, 400)
    }

    // Verifica pagamento na InfinitePay (exige handle + slug — sem eles a API responde 404)
    const checkRes = await fetch('https://api.infinitepay.io/invoices/public/checkout/payment_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: HANDLE,
        order_nsu: chave,
        transaction_nsu: transactionNsu,
        ...(body.invoice_slug && { slug: body.invoice_slug }),
      }),
    })

    if (!checkRes.ok) {
      // Transitório: 500 induz a InfinitePay a reentregar
      await log(chave, 'erro', `payment_check HTTP ${checkRes.status}`, body)
      return json({ error: 'payment_check request failed', status: checkRes.status }, 500)
    }

    const check = await checkRes.json()

    if (!check.paid) {
      await log(chave, 'rejeitado', 'payment_check: paid=false', { body, check })
      return json({ error: 'payment not confirmed by InfinitePay' }, 400)
    }

    const { data: pedido, error: pedErr } = await supabase
      .from('pedidos')
      .select('id, valor_total, status')
      .eq('chave_pedido', chave)
      .maybeSingle()

    if (pedErr) {
      await log(chave, 'erro', `consulta pedido: ${pedErr.message}`, body)
      return json({ error: 'pedido lookup failed' }, 500)
    }
    if (!pedido) {
      await log(chave, 'rejeitado', 'pedido não encontrado', body)
      return json({ error: 'pedido not found' }, 400)
    }
    if (pedido.status !== 'pendente') {
      await log(chave, 'ignorado', `status já era '${pedido.status}'`, body)
      return json({ ok: true, skipped: 'already processed' })
    }

    // Valor: recebido pode ser MAIOR (juros de parcelamento); nunca menor.
    const esperado = Math.round(Number(pedido.valor_total ?? 0) * 100)
    const recebido = Number(check.amount ?? 0)
    if (recebido < esperado - 1) {
      await log(chave, 'rejeitado', `valor a menor: recebido ${recebido}, esperado ${esperado}`, { body, check })
      return json({ error: 'amount below expected', recebido, esperado }, 400)
    }

    const { error: rpcErr } = await supabase.rpc('confirmar_pedido_pago', {
      p_chave:  chave,
      p_metodo: captureMethod,
    })
    if (rpcErr) {
      await log(chave, 'erro', `confirmar_pedido_pago: ${rpcErr.message}`, body)
      return json({ error: 'update failed', detail: rpcErr.message }, 500)
    }

    await log(chave, 'confirmado', `pago via ${captureMethod} (recebido ${recebido}, esperado ${esperado})`, body)

    await notificarTelegram(chave, captureMethod)

    return json({ ok: true })
  } catch (err) {
    await log(chave, 'erro', String(err))
    return json({ error: String(err) }, 500)
  }
})
