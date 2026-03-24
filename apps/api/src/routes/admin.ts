import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { onboardingQueue } from '../queue/onboarding.queue'
import { logger } from '../utils/logger'

const router = Router()
const prisma = new PrismaClient()

function adminAuth(req: Request, res: Response, next: () => void) {
  const secret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

router.use(adminAuth)

/**
 * POST /admin/test-onboarding
 * Creates a test client and queues onboarding without Stripe.
 */
router.post('/test-onboarding', async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessName = 'Test Business', email, plan = 'GROWTH' } = req.body as Record<string, string>
    if (!email) {
      res.status(400).json({ error: 'email is required' })
      return
    }

    const client = await prisma.client.create({
      data: {
        businessName,
        email,
        passwordHash: 'test-bypass',
        stripeCustomerId: `test_${Date.now()}`,
        plan: plan as never,
        status: 'PENDING'
      }
    })

    await onboardingQueue.add(
      { clientId: client.id },
      { jobId: `onboarding-${client.id}` }
    )

    logger.info('Test onboarding queued', { clientId: client.id })
    res.json({ clientId: client.id, businessName, email, plan })
  } catch (error) {
    logger.error('Test onboarding failed', { error })
    res.status(500).json({ error: 'Failed to create test onboarding' })
  }
})

/**
 * POST /admin/rerun/:clientId
 * Clears existing agent deployments, resets onboarding, and re-queues the
 * onboarding job — reusing all stored ClientCredential records so you never
 * need to re-enter credentials.
 */
router.post('/rerun/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params

  try {
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      res.status(404).json({ error: 'Client not found' })
      return
    }

    // 1. Remove existing agent deployments (N8N workflows will be cleaned up on next deploy)
    const deleted = await prisma.agentDeployment.deleteMany({ where: { clientId } })
    logger.info('Cleared agent deployments for rerun', { clientId, count: deleted.count })

    // 2. Reset or recreate the onboarding record
    await prisma.onboarding.upsert({
      where: { clientId },
      update: {
        step: 1,
        status: 'IN_PROGRESS',
        completedAt: null,
        data: { message: 'Re-run triggered' }
      },
      create: {
        clientId,
        step: 1,
        status: 'IN_PROGRESS',
        data: { message: 'Re-run triggered' }
      }
    })

    // 3. Set client back to PENDING so the progress screen shows correctly
    await prisma.client.update({
      where: { id: clientId },
      data: { status: 'PENDING' }
    })

    // 4. Remove any stale queued/failed jobs for this client
    const existingJobs = await onboardingQueue.getJobs(['waiting', 'active', 'failed', 'delayed'])
    for (const job of existingJobs) {
      if (job.data?.clientId === clientId) {
        await job.remove().catch(() => {})
      }
    }

    // 5. Re-queue — existing ClientCredential records are untouched and will be reused
    await onboardingQueue.add(
      { clientId },
      { jobId: `onboarding-${clientId}-${Date.now()}` }
    )

    logger.info('Rerun onboarding queued', { clientId, businessName: client.businessName })

    res.json({
      success: true,
      clientId,
      businessName: client.businessName,
      message: 'Onboarding re-queued. Credentials reused from previous run.'
    })
  } catch (error) {
    logger.error('Rerun onboarding failed', { clientId, error })
    res.status(500).json({ error: 'Failed to rerun onboarding' })
  }
})

/**
 * GET /admin/client/:clientId
 * Quick summary of a client's current state — useful for debugging.
 */
router.get('/client/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        agents: { select: { agentType: true, status: true, n8nWorkflowId: true, retellAgentId: true, createdAt: true } },
        credentials: { select: { service: true, createdAt: true } },
        onboarding: { select: { step: true, status: true, completedAt: true, data: true } }
      }
    })
    if (!client) {
      res.status(404).json({ error: 'Client not found' })
      return
    }
    const { passwordHash: _, ...safe } = client as typeof client & { passwordHash?: string }
    res.json(safe)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch client' })
  }
})

/**
 * POST /admin/fix-crm-nulls
 * One-time cleanup: sets crmType = null for any client where it was stored
 * as the string "NONE" or "none" instead of a proper null.
 */
router.post('/fix-crm-nulls', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.$executeRaw`UPDATE "Client" SET "crmType" = NULL WHERE "crmType" IN ('NONE', 'none')`
    logger.info('Fixed crmType nulls', { rowsAffected: result })
    res.json({ success: true, rowsAffected: result })
  } catch (error) {
    logger.error('Failed to fix crmType nulls', { error })
    res.status(500).json({ error: 'Failed to fix crmType nulls' })
  }
})

export default router
