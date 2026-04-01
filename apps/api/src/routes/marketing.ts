import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { emailService } from '../services/email.service'
import { logger } from '../utils/logger'
import { decryptJSON } from '../utils/encrypt'
import twilio from 'twilio'

const router = Router()
const prisma = new PrismaClient()

router.use(authMiddleware)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveRecipients(clientId: string, filter: Record<string, unknown>): Promise<{ id: string; name?: string | null; email?: string | null; phone?: string | null }[]> {
  const where: Record<string, unknown> = { clientId }
  if (!filter.all) {
    const conditions: Record<string, unknown>[] = []
    if (Array.isArray(filter.stages) && filter.stages.length) conditions.push({ pipelineStage: { in: filter.stages as never[] } })
    if (Array.isArray(filter.sources) && filter.sources.length) conditions.push({ source: { in: filter.sources } })
    if (Array.isArray(filter.contactIds) && filter.contactIds.length) conditions.push({ id: { in: filter.contactIds } })
    if (conditions.length) where.OR = conditions
  }
  return prisma.contact.findMany({ where: where as never, select: { id: true, name: true, email: true, phone: true }, take: 2000 })
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

// GET /marketing/campaigns
router.get('/campaigns', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const campaigns = await prisma.campaign.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { recipients: true } } }
    })
    res.json({ campaigns })
  } catch (err) {
    logger.error('Get campaigns error', { err })
    res.status(500).json({ error: 'Failed to fetch campaigns' })
  }
})

// GET /marketing/campaigns/:id
router.get('/campaigns/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, clientId },
      include: {
        recipients: {
          include: { contact: { select: { id: true, name: true, email: true, phone: true } } },
          orderBy: { sentAt: 'desc' },
          take: 200
        },
        _count: { select: { recipients: true } }
      }
    })
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return }
    res.json({ campaign })
  } catch (err) {
    logger.error('Get campaign error', { err })
    res.status(500).json({ error: 'Failed to fetch campaign' })
  }
})

// POST /marketing/campaigns
router.post('/campaigns', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { name, type, subject, body, scheduledAt, recipientFilter } = req.body as {
      name: string; type: string; subject?: string; body: string
      scheduledAt?: string; recipientFilter?: Record<string, unknown>
    }
    if (!name || !type || !body) { res.status(400).json({ error: 'name, type, body required' }); return }
    if (type === 'EMAIL' && !subject) { res.status(400).json({ error: 'subject required for email campaigns' }); return }

    const campaign = await prisma.campaign.create({
      data: {
        id: randomUUID(), clientId, name,
        type: type as never, subject, body,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        recipientFilter: (recipientFilter || { all: false }) as never,
        updatedAt: new Date()
      }
    })
    res.status(201).json({ campaign })
  } catch (err) {
    logger.error('Create campaign error', { err })
    res.status(500).json({ error: 'Failed to create campaign' })
  }
})

// PATCH /marketing/campaigns/:id
router.patch('/campaigns/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await prisma.campaign.findFirst({ where: { id: req.params.id, clientId } })
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return }
    if (existing.status === 'SENT') { res.status(400).json({ error: 'Cannot edit a sent campaign' }); return }

    const { name, subject, body, scheduledAt, recipientFilter } = req.body as Record<string, unknown>
    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name as string }),
        ...(subject !== undefined && { subject: subject as string }),
        ...(body !== undefined && { body: body as string }),
        ...(scheduledAt !== undefined && { scheduledAt: scheduledAt ? new Date(scheduledAt as string) : null }),
        ...(recipientFilter !== undefined && { recipientFilter: recipientFilter as never }),
        updatedAt: new Date()
      }
    })
    res.json({ campaign })
  } catch (err) {
    logger.error('Update campaign error', { err })
    res.status(500).json({ error: 'Failed to update campaign' })
  }
})

// DELETE /marketing/campaigns/:id
router.delete('/campaigns/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await prisma.campaign.findFirst({ where: { id: req.params.id, clientId } })
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return }
    await prisma.campaign.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    logger.error('Delete campaign error', { err })
    res.status(500).json({ error: 'Failed to delete campaign' })
  }
})

// POST /marketing/campaigns/:id/send
router.post('/campaigns/:id/send', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, clientId } })
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return }
    if (campaign.status === 'SENT' || campaign.status === 'SENDING') {
      res.status(400).json({ error: 'Campaign already sent or sending' }); return
    }

    const filter = (campaign.recipientFilter as Record<string, unknown>) || { all: false }
    const contacts = await resolveRecipients(clientId, filter)

    if (!contacts.length) { res.status(400).json({ error: 'No recipients match the filter' }); return }

    // Mark as sending immediately so UI updates
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' as never, updatedAt: new Date() } })

    // Create recipient rows
    const recipientRows = contacts.map(c => ({
      id: randomUUID(), campaignId: campaign.id, contactId: c.id, status: 'PENDING' as never
    }))
    await prisma.campaignRecipient.createMany({ data: recipientRows, skipDuplicates: true })

    // Send asynchronously — respond immediately
    res.json({ success: true, recipientCount: contacts.length })

    // ── Async send ────────────────────────────────────────────────────────────
    setImmediate(async () => {
      let sent = 0, failed = 0

      if (campaign.type === 'EMAIL') {
        // Get Gmail credentials
        const gmailCred = await prisma.clientCredential.findFirst({ where: { clientId, service: 'gmail' } }).catch(() => null)
        if (!gmailCred) {
          await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED' as never, updatedAt: new Date() } })
          logger.warn('Campaign cancelled — no Gmail credentials', { clientId, campaignId: campaign.id })
          return
        }
        const creds = decryptJSON<{ accessToken: string; refreshToken: string; email: string }>(gmailCred.credentials)
        if (!creds) return

        for (const contact of contacts) {
          if (!contact.email || contact.email.includes('@social.nodus')) continue
          try {
            await emailService.sendEmail(contact.email, campaign.subject || campaign.name, campaign.body, creds)
            await prisma.campaignRecipient.updateMany({
              where: { campaignId: campaign.id, contactId: contact.id },
              data: { status: 'SENT' as never, sentAt: new Date() }
            })
            sent++
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            await prisma.campaignRecipient.updateMany({
              where: { campaignId: campaign.id, contactId: contact.id },
              data: { status: 'FAILED' as never, error: errMsg.slice(0, 200) }
            })
            failed++
          }
          // Rate limit: 1 email per 200ms to avoid Gmail throttling
          await new Promise(r => setTimeout(r, 200))
        }
      } else if (campaign.type === 'SMS') {
        const twilioSid = process.env.TWILIO_ACCOUNT_SID
        const twilioToken = process.env.TWILIO_AUTH_TOKEN
        const fromNumber = process.env.TWILIO_PHONE_NUMBER
        if (!twilioSid || !twilioToken || !fromNumber) {
          await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED' as never, updatedAt: new Date() } })
          logger.warn('Campaign cancelled — Twilio not configured', { clientId, campaignId: campaign.id })
          return
        }
        const twilioClient = twilio(twilioSid, twilioToken)
        for (const contact of contacts) {
          if (!contact.phone) continue
          try {
            await twilioClient.messages.create({ body: campaign.body, from: fromNumber, to: contact.phone })
            await prisma.campaignRecipient.updateMany({
              where: { campaignId: campaign.id, contactId: contact.id },
              data: { status: 'SENT' as never, sentAt: new Date() }
            })
            sent++
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            await prisma.campaignRecipient.updateMany({
              where: { campaignId: campaign.id, contactId: contact.id },
              data: { status: 'FAILED' as never, error: errMsg.slice(0, 200) }
            })
            failed++
          }
          await new Promise(r => setTimeout(r, 100))
        }
      }

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'SENT' as never,
          sentAt: new Date(),
          stats: { sent, failed, total: contacts.length } as never,
          updatedAt: new Date()
        }
      })
      logger.info('Campaign sent', { clientId, campaignId: campaign.id, sent, failed })
    })
  } catch (err) {
    logger.error('Send campaign error', { err })
    res.status(500).json({ error: 'Failed to send campaign' })
  }
})

// GET /marketing/campaigns/:id/preview-recipients
router.get('/campaigns/:id/preview-recipients', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, clientId } })
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return }
    const filter = (campaign.recipientFilter as Record<string, unknown>) || { all: false }
    const contacts = await resolveRecipients(clientId, filter)
    res.json({ count: contacts.length, contacts: contacts.slice(0, 20) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to preview recipients' })
  }
})

// ── Funnels ───────────────────────────────────────────────────────────────────

// GET /marketing/funnels
router.get('/funnels', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const funnels = await prisma.funnel.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { steps: true, submissions: true } },
        steps: { orderBy: { order: 'asc' }, select: { id: true, name: true, type: true, order: true } }
      }
    })
    res.json({ funnels })
  } catch (err) {
    logger.error('Get funnels error', { err })
    res.status(500).json({ error: 'Failed to fetch funnels' })
  }
})

// GET /marketing/funnels/:id
router.get('/funnels/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const funnel = await prisma.funnel.findFirst({
      where: { id: req.params.id, clientId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        _count: { select: { submissions: true } }
      }
    })
    if (!funnel) { res.status(404).json({ error: 'Funnel not found' }); return }

    // Per-step submission counts
    const stepCounts = await prisma.funnelSubmission.groupBy({
      by: ['stepId'],
      where: { funnelId: req.params.id },
      _count: { stepId: true }
    })
    const countByStep = Object.fromEntries(stepCounts.map(s => [s.stepId, s._count.stepId]))

    res.json({ funnel, stepCounts: countByStep })
  } catch (err) {
    logger.error('Get funnel error', { err })
    res.status(500).json({ error: 'Failed to fetch funnel' })
  }
})

// POST /marketing/funnels
router.post('/funnels', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { name, description, steps } = req.body as {
      name: string; description?: string
      steps?: { name: string; type: string; headline?: string; subheadline?: string; body?: string; ctaText?: string }[]
    }
    if (!name) { res.status(400).json({ error: 'name required' }); return }

    const funnelId = randomUUID()
    const funnel = await prisma.funnel.create({
      data: {
        id: funnelId, clientId, name, description,
        updatedAt: new Date(),
        steps: steps?.length ? {
          create: steps.map((s, i) => ({
            id: randomUUID(), name: s.name, type: s.type as never,
            order: i + 1, headline: s.headline, subheadline: s.subheadline,
            body: s.body, ctaText: s.ctaText
          }))
        } : undefined
      },
      include: { steps: { orderBy: { order: 'asc' } } }
    })
    res.status(201).json({ funnel })
  } catch (err) {
    logger.error('Create funnel error', { err })
    res.status(500).json({ error: 'Failed to create funnel' })
  }
})

// PATCH /marketing/funnels/:id
router.patch('/funnels/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await prisma.funnel.findFirst({ where: { id: req.params.id, clientId } })
    if (!existing) { res.status(404).json({ error: 'Funnel not found' }); return }

    const { name, description, status, steps } = req.body as Record<string, unknown>

    // Replace steps if provided
    if (Array.isArray(steps)) {
      await prisma.funnelStep.deleteMany({ where: { funnelId: req.params.id } })
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i] as Record<string, string>
        await prisma.funnelStep.create({
          data: {
            id: randomUUID(), funnelId: req.params.id,
            name: s.name, type: s.type as never, order: i + 1,
            headline: s.headline, subheadline: s.subheadline,
            body: s.body, ctaText: s.ctaText
          }
        })
      }
    }

    const funnel = await prisma.funnel.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name as string }),
        ...(description !== undefined && { description: description as string }),
        ...(status !== undefined && { status: status as never }),
        updatedAt: new Date()
      },
      include: { steps: { orderBy: { order: 'asc' } } }
    })
    res.json({ funnel })
  } catch (err) {
    logger.error('Update funnel error', { err })
    res.status(500).json({ error: 'Failed to update funnel' })
  }
})

// DELETE /marketing/funnels/:id
router.delete('/funnels/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await prisma.funnel.findFirst({ where: { id: req.params.id, clientId } })
    if (!existing) { res.status(404).json({ error: 'Funnel not found' }); return }
    await prisma.funnel.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    logger.error('Delete funnel error', { err })
    res.status(500).json({ error: 'Failed to delete funnel' })
  }
})

// POST /marketing/funnels/:id/submit — public opt-in form submission
router.post('/funnels/:id/submit', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Note: no auth required for public submissions — clientId from funnel
    const funnel = await prisma.funnel.findFirst({ where: { id: req.params.id, status: 'ACTIVE' as never } })
    if (!funnel) { res.status(404).json({ error: 'Funnel not found or inactive' }); return }

    const { stepId, name, email, phone, data } = req.body as Record<string, string>
    const clientId = funnel.clientId

    // Upsert contact to CRM
    let contactId: string | undefined
    if (email || phone) {
      const newId = randomUUID()
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Contact" ("id","clientId","name","email","phone","source","pipelineStage","updatedAt")
        VALUES (${newId}, ${clientId}, ${name || null}, ${email || null}, ${phone || null}, 'funnel', 'NEW_LEAD', NOW())
        ON CONFLICT ("clientId","email") WHERE "email" IS NOT NULL
        DO UPDATE SET
          "name" = COALESCE(EXCLUDED."name","Contact"."name"),
          "phone" = COALESCE(EXCLUDED."phone","Contact"."phone"),
          "updatedAt" = NOW()
        RETURNING "id"
      `
      contactId = rows[0]?.id
    }

    await prisma.funnelSubmission.create({
      data: {
        id: randomUUID(), funnelId: funnel.id,
        stepId: stepId || undefined, contactId,
        data: { name, email, phone, ...(typeof data === 'object' && data !== null ? data : {}) } as never,
        ip: req.ip
      }
    })

    res.json({ success: true, contactId })
  } catch (err) {
    logger.error('Funnel submit error', { err })
    res.status(500).json({ error: 'Failed to submit' })
  }
})

// GET /marketing/funnels/:id/submissions
router.get('/funnels/:id/submissions', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const funnel = await prisma.funnel.findFirst({ where: { id: req.params.id, clientId } })
    if (!funnel) { res.status(404).json({ error: 'Funnel not found' }); return }

    const submissions = await prisma.funnelSubmission.findMany({
      where: { funnelId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { step: { select: { name: true, type: true } } }
    })
    res.json({ submissions })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch submissions' })
  }
})

export default router
