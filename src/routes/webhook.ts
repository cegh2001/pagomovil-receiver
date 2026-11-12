import { Hono } from 'hono'
import { Bindings, PaymentPayload } from '../types'

export const webhookRoutes = new Hono<{ Bindings: Bindings }>()

webhookRoutes.post('/pagomovil', async (c) => {
  const data = await c.req.json<PaymentPayload>()

  if (!data.bank || data.amount_bs === undefined || !data.phone_number || !data.date) {
    return c.json({ ok: false, error: 'Invalid payload: Missing required fields' }, 400)
  }

  try {
    await c.env.DB.prepare(`
      INSERT INTO pagos (
        bank, amount_bs, raw_amount, phone_number, phone_prefix,
        phone_last_digits, reference, date, time, raw_title,
        raw_body, received_at, used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      data.bank,
      data.amount_bs,
      data.raw_amount || String(data.amount_bs),
      data.phone_number,
      data.phone_prefix || null,
      data.phone_last_digits || null,
      data.reference || null,
      data.date,
      data.time || null,
      data.raw_title || '',
      data.raw_body || '',
      data.received_at || Date.now()
    ).run()

    // Real-time Push pattern forwarding (if configured)
    if (c.env.FORWARD_WEBHOOK_URL) {
      c.executionCtx.waitUntil(
        fetch(c.env.FORWARD_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': c.env.WEBHOOK_SECRET
          },
          body: JSON.stringify(data)
        }).catch((err) => console.error('Forwarding webhook error:', err))
      )
    }

    return c.json({ ok: true, status: 'created', message: 'Payment recorded successfully' }, 201)
  } catch (error: any) {
    const errorMsg = String(error?.message || error)
    
    // Idempotency: Return HTTP 200 on duplicate to allow Android Outbox to mark as SYNCED
    if (errorMsg.includes('UNIQUE') || errorMsg.includes('constraint') || errorMsg.includes('19')) {
      return c.json({
        ok: true,
        status: 'duplicate',
        message: 'Payment already recorded previously (idempotent response)'
      }, 200)
    }

    console.error('Database insertion error:', error)
    return c.json({ ok: false, error: 'Internal database error', details: errorMsg }, 500)
  }
})
