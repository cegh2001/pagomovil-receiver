import { Context, Next } from 'hono'
import { Bindings } from '../types'

export async function authMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  // Allow health check endpoint without authentication
  const path = c.req.path
  if (path === '/' || path === '/health') {
    return await next()
  }

  const secret = c.req.header('x-webhook-secret')
    || c.req.header('x-api-key')
    || c.req.header('authorization')?.replace('Bearer ', '')

  if (!secret || secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ ok: false, error: 'Unauthorized: Invalid or missing authentication secret' }, 401)
  }

  await next()
}
