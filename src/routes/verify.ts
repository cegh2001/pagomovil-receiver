import { Hono } from 'hono'
import { Bindings, PagoEntity, VerifyRequest } from '../types'

export const verifyRoutes = new Hono<{ Bindings: Bindings }>()

verifyRoutes.post('/verificar', async (c) => {
  const body = await c.req.json<VerifyRequest>()
  const { referencia, telefonoUltimos4, montoEsperado, fecha } = body

  if (montoEsperado === undefined || montoEsperado === null || isNaN(Number(montoEsperado))) {
    return c.json({ verificado: false, motivo: 'montoEsperado numérico es requerido' }, 400)
  }

  const expectedAmount = Number(montoEsperado)
  let pago: PagoEntity | null = null

  // Strategy A: Reconciliation by reference suffix (e.g. BDV, Mercantil)
  if (referencia && referencia.trim().length >= 4) {
    const cleanRef = referencia.trim()
    let query = `
      SELECT * FROM pagos 
      WHERE reference LIKE ? AND used = 0
    `
    const params: any[] = [`%${cleanRef}`]

    if (fecha) {
      query += ` AND date LIKE ?`
      params.push(`%${fecha.trim()}%`)
    }

    query += ` ORDER BY received_at DESC LIMIT 1`

    pago = await c.env.DB.prepare(query).bind(...params).first<PagoEntity>()
  } 
  // Strategy B: Reconciliation by last 4 digits of phone number (e.g. BFC push without reference)
  else if (telefonoUltimos4 && telefonoUltimos4.trim().length === 4) {
    const cleanPhone = telefonoUltimos4.trim()
    let query = `
      SELECT * FROM pagos 
      WHERE phone_last_digits = ? AND used = 0
    `
    const params: any[] = [cleanPhone]

    if (fecha) {
      query += ` AND date LIKE ?`
      params.push(`%${fecha.trim()}%`)
    }

    query += ` ORDER BY received_at DESC LIMIT 1`

    pago = await c.env.DB.prepare(query).bind(...params).first<PagoEntity>()
  } else {
    return c.json({
      verificado: false,
      motivo: 'Debe proporcionar al menos "referencia" (mínimo 4 dígitos) o "telefonoUltimos4" (exactamente 4 dígitos)'
    }, 400)
  }

  if (!pago) {
    return c.json({
      verificado: false,
      motivo: 'Pago no encontrado o ya fue utilizado previamente'
    }, 404)
  }

  // Exact amount matching with floating point tolerance of 0.01 Bs
  if (Math.abs(Number(pago.amount_bs) - expectedAmount) > 0.01) {
    return c.json({
      verificado: false,
      motivo: 'El monto no coincide con el pago recibido',
      montoRecibido: pago.amount_bs,
      montoEsperado: expectedAmount
    }, 400)
  }

  // Atomically mark payment as used to prevent double-spending
  await c.env.DB.prepare(`
    UPDATE pagos 
    SET used = 1, used_at = datetime('now') 
    WHERE id = ?
  `).bind(pago.id).run()

  return c.json({
    verificado: true,
    mensaje: 'Pago verificado y marcado como utilizado exitosamente',
    pago: {
      id: pago.id,
      bank: pago.bank,
      amount_bs: pago.amount_bs,
      reference: pago.reference,
      phone_number: pago.phone_number,
      phone_last_digits: pago.phone_last_digits,
      date: pago.date,
      time: pago.time,
      received_at: pago.received_at
    }
  })
})

// Read-only inspection endpoint (does not mark as used)
verifyRoutes.post('/consultar', async (c) => {
  const body = await c.req.json<VerifyRequest>()
  const { referencia, telefonoUltimos4, montoEsperado } = body

  let pago: PagoEntity | null = null

  if (referencia && referencia.trim().length >= 4) {
    pago = await c.env.DB.prepare(`
      SELECT * FROM pagos 
      WHERE reference LIKE ? 
      ORDER BY received_at DESC LIMIT 1
    `).bind(`%${referencia.trim()}`).first<PagoEntity>()
  } else if (telefonoUltimos4 && telefonoUltimos4.trim().length === 4) {
    pago = await c.env.DB.prepare(`
      SELECT * FROM pagos 
      WHERE phone_last_digits = ? 
      ORDER BY received_at DESC LIMIT 1
    `).bind(telefonoUltimos4.trim()).first<PagoEntity>()
  }

  if (!pago) {
    return c.json({ encontrado: false, mensaje: 'Pago no encontrado en el sistema' }, 404)
  }

  return c.json({
    encontrado: true,
    usado: pago.used === 1,
    pago: {
      id: pago.id,
      bank: pago.bank,
      amount_bs: pago.amount_bs,
      reference: pago.reference,
      phone_last_digits: pago.phone_last_digits,
      date: pago.date,
      time: pago.time,
      used: pago.used,
      used_at: pago.used_at,
      received_at: pago.received_at
    }
  })
})
