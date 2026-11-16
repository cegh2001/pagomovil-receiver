import { Hono } from 'hono'
import { Bindings, PagoEntity, VerifyRequest } from '../types'

export const verifyRoutes = new Hono<{ Bindings: Bindings }>()

function parseExpectedAmount(raw: number | string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'number') return isNaN(raw) ? null : raw
  const clean = String(raw).trim().replace(',', '.')
  const num = parseFloat(clean)
  return isNaN(num) ? null : num
}

function extractLast4Digits(phone?: string, explicitLast4?: string): string | null {
  if (explicitLast4 && explicitLast4.trim().length === 4) {
    return explicitLast4.trim()
  }
  if (!phone) return null
  const digits = phone.replace(/[^0-9]/g, '')
  if (digits.length >= 4) {
    return digits.slice(-4)
  }
  return null
}

verifyRoutes.post('/verificar', async (c) => {
  const body = await c.req.json<VerifyRequest>()
  const { referencia, telefono, telefonoUltimos4, montoEsperado, fecha, banco } = body

  const expectedAmount = parseExpectedAmount(montoEsperado)
  if (expectedAmount === null) {
    return c.json({ verificado: false, motivo: 'montoEsperado numérico es requerido' }, 400)
  }

  const phoneLast4 = extractLast4Digits(telefono, telefonoUltimos4)
  const cleanRef = referencia?.trim()

  if ((!cleanRef || cleanRef.length < 4) && !phoneLast4) {
    return c.json({
      verificado: false,
      motivo: 'Debe proporcionar al menos "referencia" (mínimo 4 dígitos) o teléfono (mínimo 4 dígitos)'
    }, 400)
  }

  let pago: PagoEntity | null = null
  let matchMethod: 'referencia' | 'telefono_monto' | null = null

  // -------------------------------------------------------------
  // PASO 1 (Prioridad Alta): Buscar por Sufijo de Referencia (e.g. BDV)
  // -------------------------------------------------------------
  if (cleanRef && cleanRef.length >= 4) {
    let query = `
      SELECT * FROM pagos 
      WHERE reference LIKE ? AND used = 0
    `
    const params: any[] = [`%${cleanRef}`]

    if (banco) {
      query += ` AND bank = ?`
      params.push(banco.trim().toUpperCase())
    }

    if (fecha) {
      query += ` AND date LIKE ?`
      params.push(`%${fecha.trim()}%`)
    }

    query += ` ORDER BY received_at DESC LIMIT 1`

    const candidate = await c.env.DB.prepare(query).bind(...params).first<PagoEntity>()

    // Si encontró el pago por referencia, validamos el monto
    if (candidate) {
      if (Math.abs(Number(candidate.amount_bs) - expectedAmount) <= 0.01) {
        pago = candidate
        matchMethod = 'referencia'
      }
    }
  }

  // -------------------------------------------------------------
  // PASO 2 (Cascada / Fallback): Buscar por Últimos 4 Dígitos del Teléfono + Monto
  // (Crucial para Bancamiga y BFC que no emiten número de referencia en el push)
  // -------------------------------------------------------------
  if (!pago && phoneLast4) {
    let query = `
      SELECT * FROM pagos 
      WHERE phone_last_digits = ? 
        AND ABS(amount_bs - ?) <= 0.01 
        AND used = 0
    `
    const params: any[] = [phoneLast4, expectedAmount]

    if (banco) {
      query += ` AND bank = ?`
      params.push(banco.trim().toUpperCase())
    }

    if (fecha) {
      query += ` AND date LIKE ?`
      params.push(`%${fecha.trim()}%`)
    }

    query += ` ORDER BY received_at DESC LIMIT 1`

    const candidate = await c.env.DB.prepare(query).bind(...params).first<PagoEntity>()

    if (candidate) {
      pago = candidate
      matchMethod = 'telefono_monto'
    }
  }

  // Si después de la cascada no encontramos ningún pago disponible
  if (!pago) {
    return c.json({
      verificado: false,
      motivo: 'Pago no encontrado o ya fue utilizado previamente',
      criterios_evaluados: {
        referencia: cleanRef || null,
        telefonoUltimos4: phoneLast4 || null,
        montoEsperado: expectedAmount,
        fecha: fecha || null
      }
    }, 404)
  }

  // -------------------------------------------------------------
  // PASO 3: Marcado Atómico como Utilizado (Anti Doble Gasto)
  // -------------------------------------------------------------
  await c.env.DB.prepare(`
    UPDATE pagos 
    SET used = 1, used_at = datetime('now') 
    WHERE id = ?
  `).bind(pago.id).run()

  return c.json({
    verificado: true,
    metodo_coincidencia: matchMethod,
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
  const { referencia, telefono, telefonoUltimos4, montoEsperado, fecha, banco } = body

  const expectedAmount = parseExpectedAmount(montoEsperado)
  const phoneLast4 = extractLast4Digits(telefono, telefonoUltimos4)
  const cleanRef = referencia?.trim()

  let pago: PagoEntity | null = null
  let matchMethod: 'referencia' | 'telefono_monto' | null = null

  // Cascada Paso 1: Por Referencia
  if (cleanRef && cleanRef.length >= 4) {
    let query = `SELECT * FROM pagos WHERE reference LIKE ?`
    const params: any[] = [`%${cleanRef}`]
    if (banco) {
      query += ` AND bank = ?`
      params.push(banco.trim().toUpperCase())
    }
    if (fecha) {
      query += ` AND date LIKE ?`
      params.push(`%${fecha.trim()}%`)
    }
    query += ` ORDER BY received_at DESC LIMIT 1`
    pago = await c.env.DB.prepare(query).bind(...params).first<PagoEntity>()
    if (pago) matchMethod = 'referencia'
  }

  // Cascada Paso 2: Por Teléfono + Monto
  if (!pago && phoneLast4 && expectedAmount !== null) {
    let query = `SELECT * FROM pagos WHERE phone_last_digits = ? AND ABS(amount_bs - ?) <= 0.01`
    const params: any[] = [phoneLast4, expectedAmount]
    if (banco) {
      query += ` AND bank = ?`
      params.push(banco.trim().toUpperCase())
    }
    if (fecha) {
      query += ` AND date LIKE ?`
      params.push(`%${fecha.trim()}%`)
    }
    query += ` ORDER BY received_at DESC LIMIT 1`
    pago = await c.env.DB.prepare(query).bind(...params).first<PagoEntity>()
    if (pago) matchMethod = 'telefono_monto'
  }

  if (!pago) {
    return c.json({ encontrado: false, mensaje: 'Pago no encontrado en el sistema' }, 404)
  }

  return c.json({
    encontrado: true,
    metodo_coincidencia: matchMethod,
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
