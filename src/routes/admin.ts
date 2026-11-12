import { Hono } from 'hono'
import { Bindings, PagoEntity } from '../types'

export const adminRoutes = new Hono<{ Bindings: Bindings }>()

adminRoutes.get('/recientes', async (c) => {
  const limitParam = c.req.query('limit')
  const limit = Math.min(Number(limitParam) || 25, 100)

  const { results } = await c.env.DB.prepare(`
    SELECT id, bank, amount_bs, raw_amount, phone_number, phone_last_digits, reference, date, time, used, used_at, received_at, created_at
    FROM pagos
    ORDER BY received_at DESC
    LIMIT ?
  `).bind(limit).all<PagoEntity>()

  return c.json({
    ok: true,
    total: results.length,
    pagos: results
  })
})

adminRoutes.get('/stats', async (c) => {
  const total = await c.env.DB.prepare(`SELECT count(*) as count FROM pagos`).first<any>()
  const usados = await c.env.DB.prepare(`SELECT count(*) as count FROM pagos WHERE used = 1`).first<any>()
  const pendientes = await c.env.DB.prepare(`SELECT count(*) as count FROM pagos WHERE used = 0`).first<any>()

  return c.json({
    ok: true,
    estadisticas: {
      total: total?.count || 0,
      usados: usados?.count || 0,
      disponibles_para_conciliar: pendientes?.count || 0
    }
  })
})
