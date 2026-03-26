import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { onboardingQueue } from '../queue/onboarding.queue'
import { n8nService } from '../services/n8n.service'
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

    // 1. Delete ALL N8N workflows for this client (by name search) to clear webhook conflicts
    const n8nDeleted = await n8nService.deleteAllClientWorkflows(clientId)
    logger.info('Deleted N8N workflows for rerun', { clientId, count: n8nDeleted })

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
        agents: { select: { agentType: true, status: true, n8nWorkflowId: true, retellAgentId: true, metrics: true, createdAt: true } },
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
 * GET /admin/n8n-executions/:workflowId
 * Proxies to N8N executions API using the server's N8N_API_KEY.
 */
router.get('/n8n-executions/:workflowId', async (req: Request, res: Response): Promise<void> => {
  const { workflowId } = req.params
  const n8nKey = process.env.N8N_API_KEY
  const n8nUrl = process.env.N8N_BASE_URL
  if (!n8nKey || !n8nUrl) {
    res.status(500).json({ error: 'N8N_API_KEY or N8N_BASE_URL not configured' })
    return
  }
  try {
    const response = await fetch(`${n8nUrl}/api/v1/executions?workflowId=${workflowId}&limit=5`, {
      headers: { 'X-N8N-API-KEY': n8nKey }
    })
    const data = await response.json()
    res.json({ status: response.status, data })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * POST /admin/test-claude-score
 * Calls Claude directly with a sample lead to verify the API key works
 * and the response format is what the N8N workflow expects.
 */
router.post('/test-claude-score', async (_req: Request, res: Response): Promise<void> => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })
    return
  }
  try {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: 'You are a lead qualification specialist. Score leads 0-100 based on ICP fit. Always return valid JSON only — no markdown, no explanation.',
      messages: [{
        role: 'user',
        content: 'Score this lead 0-100. Return ONLY valid JSON with this exact structure: {"score":number,"summary":"string","nextAction":"string","tags":["string"]}.\n\nLead data:\n{"name":"James Carter","company":"Carter Consulting","industry":"Business Consulting","employees":12,"message":"We need help automating our lead follow-up and sales process"}'
      }]
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await response.json() as Record<string, unknown>
    const content = (data.content as Array<{ text: string }>)?.[0]?.text || ''
    let parsed = null
    try { parsed = JSON.parse(content.replace(/^```json\s*/, '').replace(/```\s*$/, '')) } catch {}
    res.json({ status: response.status, rawResponse: content, parsed, claudeWorking: response.ok })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * POST /admin/test-lead-score/:clientId
 * Simulates an N8N lead score callback — useful for verifying the score
 * endpoint and metrics update work end-to-end without needing N8N.
 */
router.post('/test-lead-score/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const secret = process.env.N8N_API_SECRET
  if (!secret) {
    res.status(500).json({ error: 'N8N_API_SECRET not configured on server' })
    return
  }
  try {
    const payload = { contactId: 'admin-test-001', score: 85, tags: ['high-score-lead'], summary: 'Admin test lead', nextAction: 'Book a call' }
    const response = await fetch(`${process.env.API_BASE_URL || 'http://localhost:4000'}/n8n/${clientId}/contacts/score`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': secret },
      body: JSON.stringify(payload)
    })
    const result = await response.json()
    res.json({ status: response.status, result, secretConfigured: true, apiBaseUrl: process.env.API_BASE_URL || 'not set' })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * POST /admin/fix-crm-nulls
 * Two-step fix:
 * 1. ALTER the crmType column to be nullable (in case db push didn't apply it)
 * 2. Update any rows where crmType was stored as the string "NONE"/"none" to NULL
 */
router.post('/fix-crm-nulls', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Step 1: make column nullable if it isn't already
    await prisma.$executeRaw`ALTER TABLE "Client" ALTER COLUMN "crmType" DROP NOT NULL`
    logger.info('Altered crmType column to nullable')

    // Step 2: null out the bad string values
    const updated = await prisma.$executeRaw`UPDATE "Client" SET "crmType" = NULL WHERE "crmType" IN ('NONE', 'none')`
    logger.info('Fixed crmType nulls', { rowsAffected: updated })

    res.json({ success: true, rowsAffected: updated })
  } catch (error) {
    logger.error('Failed to fix crmType nulls', { error })
    res.status(500).json({ error: 'Failed to fix crmType nulls' })
  }
})

export default router
