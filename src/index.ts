import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { Bindings } from './types'
import { authMiddleware } from './middleware/auth'
import { webhookRoutes } from './routes/webhook'
import { verifyRoutes } from './routes/verify'
import { adminRoutes } from './routes/admin'

const app = new Hono<{ Bindings: Bindings }>()

// Global Middleware
app.use('*', logger())
app.use('*', cors())

// Health check endpoint (Public)
app.get('/', (c) => {
  return c.json({
    service: 'PagoMóvil Receiver & Reconciliation Engine',
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  })
})

app.get('/health', (c) => c.json({ status: 'ok' }))

// Apply Authentication Middleware for all subsequent routes
app.use('*', authMiddleware)

// Mount Route Modules
app.route('/webhooks', webhookRoutes)
app.route('/api/pagos', verifyRoutes)
app.route('/api/pagos', adminRoutes)

export default app
