import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import bcrypt from 'bcryptjs'
import { onboardingQueue } from '../queue/onboarding.queue'
import { n8nService } from '../services/n8n.service'
import { logger } from '../utils/logger'
import { AGENT_REGISTRY } from '../agents'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { sendDailyDigest } from '../services/digest'

const router = Router()

function adminAuth(req: Request, res: Response, next: () => void) {
  const secret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

/**
 * POST /admin/login
 * Validates admin email + password, returns the admin secret as the session token.
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string }
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminEmail || !adminPassword) {
    res.status(500).json({ error: 'Admin credentials not configured' })
    return
  }

  if (!email || !password || email !== adminEmail || password !== adminPassword) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  logger.info('Admin login', { email })
  res.json({ token: process.env.ADMIN_SECRET, email })
})

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
 * POST /admin/create-client
 * Creates a client with real login credentials, bypassing Stripe.
 * Use this to create demo/review accounts (e.g. Meta app review).
 * Client is created with PENDING status — on login they are redirected to /onboarding/connect.
 */
router.post('/create-client', async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessName, email, password, plan = 'GROWTH' } = req.body as Record<string, string>
    if (!businessName || !email || !password) {
      res.status(400).json({ error: 'businessName, email and password are required' })
      return
    }

    const existing = await prisma.client.findUnique({ where: { email } })
    if (existing) {
      res.status(409).json({ error: 'Client with this email already exists', clientId: existing.id })
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const client = await prisma.client.create({
      data: {
        businessName,
        email,
        passwordHash,
        stripeCustomerId: `manual_${Date.now()}`,
        plan: plan as never,
        status: 'PENDING'
      }
    })

    logger.info('Admin created client', { clientId: client.id, email, businessName, plan })
    res.json({ clientId: client.id, businessName, email, plan, status: 'PENDING' })
  } catch (error) {
    logger.error('Create client failed', { error })
    res.status(500).json({ error: 'Failed to create client' })
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

    // 1. Preserve existing phone numbers and Retell agent IDs before deleting
    const existingDeployments = await prisma.agentDeployment.findMany({
      where: { clientId },
      select: { agentType: true, retellAgentId: true, config: true, n8nWorkflowId: true }
    })

    const preservedPhones: Record<string, string> = {}
    for (const dep of existingDeployments) {
      const depConfig = dep.config as Record<string, any> | null
      if (depConfig?.phone_number) {
        preservedPhones[dep.agentType] = depConfig.phone_number
        logger.info('Preserving phone number for rerun', { clientId, agentType: dep.agentType, phone: depConfig.phone_number })
      }
    }

    // 2. Delete ALL N8N workflows for this client (by name search) to clear webhook conflicts
    const n8nDeleted = await n8nService.deleteAllClientWorkflows(clientId)
    logger.info('Deleted N8N workflows for rerun', { clientId, count: n8nDeleted })

    const deleted = await prisma.agentDeployment.deleteMany({ where: { clientId } })
    logger.info('Cleared agent deployments for rerun', { clientId, count: deleted.count })

    // 3. Reset or recreate the onboarding record — store preserved phones in data
    await prisma.onboarding.upsert({
      where: { clientId },
      update: {
        step: 1,
        status: 'IN_PROGRESS',
        completedAt: null,
        data: { message: 'Re-run triggered', preservedPhones }
      },
      create: {
        clientId,
        step: 1,
        status: 'IN_PROGRESS',
        data: { message: 'Re-run triggered', preservedPhones }
      }
    })

    // 4. Set client back to PENDING so the progress screen shows correctly
    await prisma.client.update({
      where: { id: clientId },
      data: { status: 'PENDING' }
    })

    // 5. Remove any stale queued/failed jobs for this client
    const existingJobs = await onboardingQueue.getJobs(['waiting', 'active', 'failed', 'delayed'])
    for (const job of existingJobs) {
      if (job.data?.clientId === clientId) {
        await job.remove().catch(() => {})
      }
    }

    // 6. Re-queue — existing ClientCredential records are untouched and will be reused
    //    preservedPhones are stored in onboarding.data for deployAgentsByPlan to use
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
 * GET /admin/clients
 * Lists all clients (id, businessName, email, plan, status) for the admin panel client picker.
 */
router.get('/clients', async (_req: Request, res: Response): Promise<void> => {
  try {
    const clients = await prisma.client.findMany({
      select: { id: true, businessName: true, email: true, plan: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    })
    res.json({ clients })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' })
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
    const listRes = await fetch(`${n8nUrl}/api/v1/executions?workflowId=${workflowId}&limit=3`, {
      headers: { 'X-N8N-API-KEY': n8nKey }
    })
    const listData = await listRes.json() as { data: Array<{ id: string }> }
    const executions = listData.data || []
    // Fetch full execution detail
    const detail = executions[0]?.id
      ? await fetch(`${n8nUrl}/api/v1/executions/${executions[0].id}`, { headers: { 'X-N8N-API-KEY': n8nKey } }).then(r => r.json())
      : null
    // Also fetch the workflow itself to inspect injected nodes
    const workflowRes = await fetch(`${n8nUrl}/api/v1/workflows/${workflowId}`, {
      headers: { 'X-N8N-API-KEY': n8nKey }
    })
    const workflowData = await workflowRes.json() as { nodes?: Array<{ name: string; parameters?: Record<string, unknown> }> }
    const prepareNode = workflowData.nodes?.find(n => n.name === 'Prepare Lead Data')
    const buildNode = workflowData.nodes?.find(n => n.name === 'Build Claude Request')
    res.json({
      status: listRes.status,
      executions,
      detail,
      injectedNodes: {
        prepareLeadData: prepareNode?.parameters?.jsCode,
        buildClaudeRequest: buildNode?.parameters?.jsCode
      }
    })
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

/**
 * GET /admin/agents/:clientId
 * Returns all agent types with their current deployment status for a client.
 */
router.get('/agents/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, businessName: true, email: true, plan: true, country: true }
    })
    if (!client) {
      res.status(404).json({ error: 'Client not found' })
      return
    }
    const deployments = await prisma.agentDeployment.findMany({
      where: { clientId },
      select: { agentType: true, status: true, n8nWorkflowId: true, retellAgentId: true, createdAt: true, metrics: true, config: true }
    })
    const deployedMap = Object.fromEntries(deployments.map(d => [d.agentType, d]))
    const allAgentTypes = Object.values(AgentType)
    const agents = allAgentTypes.map(agentType => ({
      agentType,
      deployed: !!deployedMap[agentType],
      status: deployedMap[agentType]?.status || null,
      n8nWorkflowId: deployedMap[agentType]?.n8nWorkflowId || null,
      retellAgentId: deployedMap[agentType]?.retellAgentId || null,
      createdAt: deployedMap[agentType]?.createdAt || null,
      config: deployedMap[agentType]?.config || null
    }))
    res.json({ client, agents })
  } catch (error) {
    logger.error('Failed to fetch agent status', { clientId, error })
    res.status(500).json({ error: 'Failed to fetch agent status' })
  }
})

/**
 * POST /admin/deploy-agent/:clientId
 * Deploys any specific agent for a client regardless of plan.
 * Body: { agentType: string, config?: Record<string, unknown> }
 */
router.post('/deploy-agent/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const { agentType, config = {} } = req.body as { agentType: string; config?: Record<string, unknown> }

  if (!agentType) {
    res.status(400).json({ error: 'agentType is required' })
    return
  }

  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, businessName: true, email: true, country: true }
    })
    if (!client) {
      res.status(404).json({ error: 'Client not found' })
      return
    }

    const AgentClass = AGENT_REGISTRY[agentType as AgentType]
    if (!AgentClass) {
      res.status(400).json({ error: `Unknown agent type: ${agentType}` })
      return
    }

    // Find existing deployments BEFORE deleting so we can clean up N8N
    // and preserve phone numbers / Retell agent IDs for reuse
    const existingDeployments = await prisma.agentDeployment.findMany({
      where: { clientId, agentType: agentType as never },
      select: { n8nWorkflowId: true, retellAgentId: true, config: true }
    })

    // Extract existing phone number and Retell agent ID to avoid re-purchasing
    let existingPhoneNumber: string | undefined
    let existingRetellAgentId: string | undefined
    for (const dep of existingDeployments) {
      const depConfig = dep.config as Record<string, any> | null
      if (depConfig?.phone_number) existingPhoneNumber = depConfig.phone_number
      if (dep.retellAgentId) existingRetellAgentId = dep.retellAgentId
    }

    // Log what we found in the existing deployment config for debugging
    for (const dep of existingDeployments) {
      const depConfig = dep.config as Record<string, any> | null
      logger.info('Existing deployment config keys', { clientId, keys: depConfig ? Object.keys(depConfig) : 'null', phone_number: depConfig?.phone_number })
    }

    if (existingPhoneNumber) {
      logger.info('Reusing existing phone number on redeploy', { clientId, agentType, phone: existingPhoneNumber })
    } else {
      logger.warn('No existing phone number found — will provision new number', { clientId, agentType })
    }
    if (existingRetellAgentId) {
      logger.info('Will clean up old Retell agent on redeploy', { clientId, agentType, retellAgentId: existingRetellAgentId })
    }

    // Delete the N8N workflow(s) by ID
    for (const dep of existingDeployments) {
      if (dep.n8nWorkflowId) {
        await n8nService.deleteWorkflow(dep.n8nWorkflowId).catch(err =>
          logger.warn('Could not delete existing N8N workflow on agent redeploy', {
            clientId, agentType, workflowId: dep.n8nWorkflowId, err
          })
        )
      }
    }

    // Delete old Retell agent (LLM + agent) but NOT the phone number
    if (existingRetellAgentId) {
      const { voiceService } = await import('../services/voice.service')
      await voiceService.deleteAgent(existingRetellAgentId).catch(err =>
        logger.warn('Could not delete old Retell agent on redeploy', { clientId, retellAgentId: existingRetellAgentId, err })
      )
    }

    // Sweep N8N by name in case of orphaned workflows
    await n8nService.deleteAllClientWorkflowsByType(clientId, agentType).catch(err =>
      logger.warn('N8N name-sweep cleanup failed (non-fatal)', { clientId, agentType, err })
    )

    // Remove DB record so deploy() can create a fresh one
    await prisma.agentDeployment.deleteMany({ where: { clientId, agentType: agentType as never } })

    // Merge layers so re-deploys preserve prior config values that the
    // admin form didn't re-type this time. Order: defaults → existing DB
    // config → new form values (only non-empty strings overwrite).
    const existingConfig: Record<string, unknown> = {}
    for (const dep of existingDeployments) {
      const depConfig = dep.config as Record<string, unknown> | null
      if (depConfig) Object.assign(existingConfig, depConfig)
    }
    // Strip internal fields that shouldn't be re-merged
    delete (existingConfig as Record<string, unknown>).generatedPrompt
    delete (existingConfig as Record<string, unknown>).generatedSequence
    delete (existingConfig as Record<string, unknown>).generatedOutreachTemplate

    // Only overwrite existing values with new values that are actually set
    // (non-empty strings, non-null). This means leaving a form field blank
    // preserves the previous value instead of wiping it.
    const filteredNew: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined || value === null) continue
      if (typeof value === 'string' && value.trim() === '') continue
      filteredNew[key] = value
    }

    const agent = new AgentClass()
    const mergedConfig = {
      locationId: '',
      businessName: client.businessName,
      country: client.country || 'AU',
      // Pass existing phone number so deploy() skips purchasing a new one
      existingPhoneNumber,
      ...existingConfig,
      ...filteredNew
    }

    logger.info('Admin deploy merged config', {
      clientId, agentType,
      existingKeys: Object.keys(existingConfig),
      newKeys: Object.keys(filteredNew),
      finalBookingLink: (mergedConfig as Record<string, unknown>).booking_link
    })

    const result = await agent.deploy(clientId, mergedConfig)

    logger.info('Admin deployed agent', { clientId, agentType, result })
    res.json({ success: true, agentType, clientId, result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Admin deploy-agent failed', { clientId, agentType, error: msg })
    res.status(500).json({ error: msg })
  }
})

/**
 * DELETE /admin/client/:clientId
 * Permanently deletes a client and ALL associated data:
 * agent deployments, credentials, onboarding, contacts, contact notes, N8N workflows.
 */
router.delete('/client/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params

  try {
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      res.status(404).json({ error: 'Client not found' })
      return
    }

    // Delete N8N workflows first
    const n8nDeleted = await n8nService.deleteAllClientWorkflows(clientId).catch(() => 0)

    // Delete all DB records in dependency order
    // Contact/ContactNote are raw-SQL tables (not in schema.prisma)
    await prisma.$executeRaw`DELETE FROM "ContactNote" WHERE "contactId" IN (SELECT id FROM "Contact" WHERE "clientId" = ${clientId})`
    await prisma.$executeRaw`DELETE FROM "Contact" WHERE "clientId" = ${clientId}`
    await prisma.agentDeployment.deleteMany({ where: { clientId } })
    await prisma.clientCredential.deleteMany({ where: { clientId } })
    await prisma.onboarding.deleteMany({ where: { clientId } })
    await prisma.client.delete({ where: { id: clientId } })

    logger.info('Admin deleted client', { clientId, businessName: client.businessName, n8nDeleted })
    res.json({ success: true, clientId, businessName: client.businessName, n8nWorkflowsDeleted: n8nDeleted })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Admin delete client failed', { clientId, error: msg })
    res.status(500).json({ error: msg })
  }
})

/**
 * PATCH /admin/client/:clientId/plan
 * Updates a client's plan. Useful for fixing test clients or upgrading manually.
 */
router.patch('/client/:clientId/plan', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const { plan } = req.body as { plan: string }

  if (!plan || !['STARTER', 'GROWTH', 'AGENCY'].includes(plan)) {
    res.status(400).json({ error: 'plan must be STARTER, GROWTH, or AGENCY' })
    return
  }

  try {
    const client = await prisma.client.update({
      where: { id: clientId },
      data: { plan: plan as never }
    })
    logger.info('Admin updated client plan', { clientId, plan })
    res.json({ success: true, clientId, businessName: client.businessName, plan })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: msg })
  }
})

/**
 * POST /admin/test-digest
 * Manually triggers the daily digest for all active clients.
 */
router.post('/test-digest', async (_req: Request, res: Response): Promise<void> => {
  try {
    await sendDailyDigest()
    res.json({ success: true, message: 'Digest triggered — check server logs and your inbox' })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Manual digest trigger failed', { error: msg })
    res.status(500).json({ error: msg })
  }
})

// GET /admin/test-email?to=you@example.com
// Diagnostic endpoint — tests Resend email delivery and returns full response
router.get('/test-email', adminAuth, async (req: Request, res: Response): Promise<void> => {
  const to = (req.query.to as string) || ''
  if (!to) {
    res.status(400).json({ error: 'Provide ?to=email@example.com' })
    return
  }

  const resendApiKey = process.env.SMTP_PASSWORD
  const from = process.env.SMTP_FROM || 'Nodus AI Systems <hello@nodusaisystems.com>'

  if (!resendApiKey) {
    res.status(500).json({ error: 'SMTP_PASSWORD (Resend API key) is not set', env_keys: Object.keys(process.env).filter(k => k.includes('SMTP') || k.includes('RESEND')) })
    return
  }

  try {
    const payload = {
      from,
      to,
      subject: 'Nodus AI — Email Test',
      html: '<h1>Email is working!</h1><p>This is a test from the Nodus AI platform.</p>'
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const body = await response.text()

    res.json({
      status: response.status,
      ok: response.ok,
      resendResponse: body,
      config: {
        from,
        to,
        keyPrefix: resendApiKey.slice(0, 8) + '...',
        keyLength: resendApiKey.length
      }
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: msg })
  }
})

// GET /admin/diagnose-voice/:clientId
// Check the deployed Retell agent's config — tools, LLM, phone number
router.get('/diagnose-voice/:clientId', adminAuth, async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const retellApiKey = process.env.RETELL_API_KEY

  try {
    // Get agent deployment from DB
    const deployment = await prisma.agentDeployment.findFirst({
      where: { clientId, agentType: 'VOICE_INBOUND' as never },
      select: { id: true, status: true, config: true, n8nWorkflowId: true }
    })

    if (!deployment) {
      res.json({ error: 'No VOICE_INBOUND deployment found', clientId })
      return
    }

    const config = deployment.config as Record<string, unknown>
    const retellAgentId = config?.retellAgentId || config?.retell_agent_id

    // Check calendar provider
    const { calendarService } = await import('../services/calendar.service')
    const calendarProvider = await calendarService.getCalendarProvider(clientId)

    // Check Retell agent
    let retellAgent: Record<string, any> | null = null
    let retellLlm: Record<string, any> | null = null
    if (retellAgentId && retellApiKey) {
      try {
        const agentRes = await fetch(`https://api.retellai.com/get-agent/${retellAgentId}`, {
          headers: { Authorization: `Bearer ${retellApiKey}` }
        })
        retellAgent = await agentRes.json() as Record<string, any>

        const llmId = retellAgent?.response_engine?.llm_id
        if (llmId) {
          const llmRes = await fetch(`https://api.retellai.com/get-retell-llm/${llmId}`, {
            headers: { Authorization: `Bearer ${retellApiKey}` }
          })
          retellLlm = await llmRes.json() as Record<string, any>
        }
      } catch (err) {
        retellAgent = { error: String(err) }
      }
    }

    // Check N8N workflow
    let n8nWorkflow: Record<string, any> | null = null
    if (deployment.n8nWorkflowId) {
      try {
        const { n8nService: n8n } = await import('../services/n8n.service')
        const verification = await n8n.verifyDeployment(deployment.n8nWorkflowId)
        n8nWorkflow = verification as any
      } catch (err) {
        n8nWorkflow = { error: String(err) }
      }
    }

    res.json({
      clientId,
      deployment: { id: deployment.id, status: deployment.status, n8nWorkflowId: deployment.n8nWorkflowId },
      retellAgentId,
      calendarProvider,
      retellAgent: {
        agent_name: retellAgent?.agent_name,
        voice_id: retellAgent?.voice_id,
        webhook_url: retellAgent?.webhook_url,
        llm_id: retellAgent?.response_engine?.llm_id,
      },
      retellLlm: {
        model: retellLlm?.model,
        toolCount: retellLlm?.general_tools?.length || 0,
        tools: retellLlm?.general_tools?.map((t: any) => ({
          name: t.name,
          type: t.type,
          url: t.url,
        })),
        promptPreview: retellLlm?.general_prompt?.substring(0, 200) + '...',
      },
      n8nWorkflow,
      envCheck: {
        API_BASE_URL: process.env.API_BASE_URL ? 'SET' : 'MISSING',
        API_URL: process.env.API_URL ? 'SET' : 'MISSING',
        N8N_BASE_URL: process.env.N8N_BASE_URL ? 'SET' : 'MISSING',
        RETELL_API_KEY: retellApiKey ? 'SET' : 'MISSING',
      }
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: msg })
  }
})

// ── Apollo B2B Outreach Test Endpoints (admin only) ─────────────────────────

/**
 * POST /admin/test-apollo-search
 * Quick test: search Apollo for prospects without deploying anything.
 * Returns matching prospects so you can verify the API key works and
 * filters return relevant results before deploying the full agent.
 */
router.post('/test-apollo-search', adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { apolloService } = await import('../services/apollo.service')
    const { person_titles, person_locations, employee_ranges, industries, keywords, per_page } = req.body as {
      person_titles?: string[]; person_locations?: string[]; employee_ranges?: string[]
      industries?: string[]; keywords?: string[]; per_page?: number
    }

    const results = await apolloService.searchPeople({
      personTitles: person_titles || ['Owner', 'CEO', 'Managing Director'],
      personLocations: person_locations || ['Sydney, Australia'],
      employeeRanges: employee_ranges || ['1,10', '11,50'],
      industries: industries || [],
      keywords: keywords || []
    }, 1, per_page || 5)

    res.json({
      success: true,
      totalResults: results.totalResults,
      returned: results.people.length,
      prospects: results.people.map(p => ({
        name: p.name,
        title: p.title,
        company: p.organization?.name,
        industry: p.organization?.industry,
        city: p.city,
        linkedinUrl: p.linkedinUrl
      }))
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Apollo search test failed', { err: msg })
    res.status(500).json({ error: msg })
  }
})

/**
 * POST /admin/test-apollo-enrich
 * Quick test: enrich a single prospect to verify we can get email/phone.
 * Body: { name: string, company?: string, linkedinUrl?: string }
 */
router.post('/test-apollo-enrich', adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { apolloService } = await import('../services/apollo.service')
    const { name, company, linkedinUrl } = req.body as { name?: string; company?: string; linkedinUrl?: string }

    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    const [firstName, ...rest] = name.split(' ')
    const lastName = rest.join(' ') || ''

    const enriched = await apolloService.enrichPerson({
      firstName,
      lastName,
      organizationName: company,
      linkedinUrl
    })

    res.json({
      success: true,
      person: enriched ? {
        name: enriched.name,
        title: enriched.title,
        email: enriched.email,
        phone: enriched.phone,
        company: enriched.organization?.name,
        linkedinUrl: enriched.linkedinUrl
      } : null
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Apollo enrich test failed', { err: msg })
    res.status(500).json({ error: msg })
  }
})

/**
 * POST /admin/test-apollo-deploy/:clientId
 * Full test: deploys the B2B_OUTREACH agent with test config.
 * Uses conservative defaults (daily_limit: 5) to avoid burning credits.
 */
router.post('/test-apollo-deploy/:clientId', adminAuth, async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, businessName: true, businessDescription: true, icpDescription: true, country: true }
    })
    if (!client) { res.status(404).json({ error: 'Client not found' }); return }

    const clientRecord = client as Record<string, unknown>
    const defaults = req.body as Record<string, unknown>

    const config = {
      locationId: '',
      businessName: client.businessName,
      country: (clientRecord.country as string) || 'AU',
      person_titles: (defaults.person_titles as string[]) || ['Owner', 'Founder', 'CEO', 'Managing Director'],
      person_locations: (defaults.person_locations as string[]) || ['Sydney, Australia', 'Melbourne, Australia', 'Brisbane, Australia'],
      employee_ranges: (defaults.employee_ranges as string[]) || ['1,10', '11,50', '51,200'],
      industries: (defaults.industries as string[]) || [],
      keywords: (defaults.keywords as string[]) || [],
      outreach_message_template: (defaults.outreach_message_template as string) || '',
      daily_limit: (defaults.daily_limit as number) || 5,
      owner_email: (defaults.owner_email as string) || '',
      booking_link: (defaults.booking_link as string) || ''
    }

    // Delete existing B2B_OUTREACH deployments + workflows
    const existing = await prisma.agentDeployment.findMany({
      where: { clientId, agentType: 'B2B_OUTREACH' as never },
      select: { n8nWorkflowId: true }
    })
    for (const dep of existing) {
      if (dep.n8nWorkflowId) {
        await n8nService.deleteWorkflow(dep.n8nWorkflowId).catch(() => {})
      }
    }
    await prisma.agentDeployment.deleteMany({ where: { clientId, agentType: 'B2B_OUTREACH' as never } })

    // Deploy the agent
    const AgentClass = AGENT_REGISTRY[AgentType.B2B_OUTREACH]
    const agent = new AgentClass()
    const result = await agent.deploy(clientId, config)

    logger.info('Apollo outreach agent test-deployed', { clientId, result, config })
    res.json({
      success: true,
      deploymentId: result.id,
      n8nWorkflowId: result.n8nWorkflowId,
      config,
      message: `B2B outreach agent deployed for ${client.businessName}. Daily limit: ${config.daily_limit} prospects. N8N workflow will run at 8am weekdays.`
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Apollo test deploy failed', { clientId, err: msg })
    res.status(500).json({ error: msg })
  }
})

export default router
