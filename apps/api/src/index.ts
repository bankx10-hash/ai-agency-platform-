import 'dotenv/config'
import express from 'express'
import { PrismaClient } from '@prisma/client'
import { apiRateLimit } from './middleware/rateLimit'
import authRouter from './routes/auth'
import billingRouter from './routes/billing'
import clientsRouter from './routes/clients'
import agentsRouter from './routes/agents'
import onboardingRouter from './routes/onboarding'
import webhooksRouter from './routes/webhooks'
import n8nCallbacksRouter from './routes/n8n-callbacks'
import adminRouter from './routes/admin'
import { logger } from './utils/logger'

async function runStartupMigrations() {
  const prisma = new PrismaClient()
  try {
    await prisma.$executeRaw`ALTER TABLE "Client" ALTER COLUMN "crmType" DROP NOT NULL`
    await prisma.$executeRaw`UPDATE "Client" SET "crmType" = NULL WHERE "crmType" IN ('NONE', 'none')`
    logger.info('Startup migrations complete')
  } catch (err) {
    logger.warn('Startup migration skipped (may already be applied)', { err })
  } finally {
    await prisma.$disconnect()
  }
}

const app = express()
app.set('trust proxy', 1)
const PORT = process.env.PORT || 4000

const ALLOWED_ORIGINS = [
  'https://app.nodusaisystems.com',
  'http://localhost:3000',
]

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.use(apiRateLimit)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/auth', authRouter)
app.use('/billing', billingRouter)
app.use('/clients', clientsRouter)
app.use('/agents', agentsRouter)
app.use('/onboarding', onboardingRouter)
app.use('/webhooks', webhooksRouter)
app.use('/n8n', n8nCallbacksRouter)
app.use('/admin', adminRouter)

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack
  })

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  })
})

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

runStartupMigrations().then(() => {
  app.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`, {
      port: PORT,
      environment: process.env.NODE_ENV || 'development'
    })
  })
})

export default app
