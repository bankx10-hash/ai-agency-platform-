import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { randomUUID } from 'crypto'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logger } from '../utils/logger'

const router = Router()

router.use(authMiddleware)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logActivity(
  contactId: string,
  clientId: string,
  type: string,
  title: string,
  body?: string,
  metadata?: Record<string, unknown>,
  agentType?: string
): Promise<void> {
  const id = randomUUID()
  await prisma.contactActivity.create({
    data: { id, contactId, clientId, type: type as never, title, body, metadata: metadata as never, agentType }
  })
}

async function calculateAndSaveScore(contactId: string, clientId: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, name, email, phone, "pipelineStage", "dealValue", score FROM "Contact" WHERE id = ${contactId} LIMIT 1
  `
  if (!rows.length) return
  const contact = rows[0]

  const [activityCountResult, lastActivityRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM "ContactActivity"
      WHERE "contactId" = ${contactId} AND type != 'SCORE_CHANGE'
    `,
    prisma.$queryRaw<Array<{ createdAt: Date }>>`
      SELECT "createdAt" FROM "ContactActivity"
      WHERE "contactId" = ${contactId} AND type != 'SCORE_CHANGE'
      ORDER BY "createdAt" DESC LIMIT 1
    `
  ])

  const activityCount = Number(activityCountResult[0]?.count ?? 0)
  const lastActivity = lastActivityRows[0] ?? null
  const stage = contact.pipelineStage as string
  let score: number

  if (stage === 'CLOSED_WON') {
    score = 100
  } else if (stage === 'CLOSED_LOST') {
    score = 5
  } else {
    const stageBase: Record<string, number> = {
      NEW_LEAD: 10, CONTACTED: 20, QUALIFIED: 35, PROPOSAL: 45
    }
    score = stageBase[stage] ?? 10
    score += Math.min(activityCount * 5, 30)
    if (lastActivity) {
      const daysSince = (Date.now() - new Date(lastActivity.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      if (daysSince < 7) score += 10
      else if (daysSince < 30) score += 5
    }
    if (contact.name) score += 3
    if (contact.email) score += 3
    if (contact.phone) score += 2
    if (contact.dealValue) score += 2
    score = Math.min(score, 99)
  }

  const prevScore = contact.score as number | null
  if (prevScore === score) return

  await prisma.$executeRaw`UPDATE "Contact" SET score = ${score}, "updatedAt" = NOW() WHERE id = ${contactId}`
  const actId = randomUUID()
  await prisma.contactActivity.create({
    data: {
      id: actId, contactId, clientId,
      type: 'SCORE_CHANGE' as never,
      title: `Score updated to ${score}`,
      metadata: { from: prevScore, to: score } as never
    }
  })
}

// Verify contact belongs to this client — returns null if not found/forbidden
async function getContact(contactId: string, clientId: string) {
  return prisma.contact.findFirst({ where: { id: contactId, clientId } })
}

// ── Contacts ──────────────────────────────────────────────────────────────────

// GET /crm/contacts
router.get('/contacts', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { stage, source, minScore, maxScore, search, limit = '50', cursor } = req.query as Record<string, string>

    // Build AND conditions — each filter is a separate condition
    const andConditions: Record<string, unknown>[] = [{ clientId }]

    if (stage) andConditions.push({ pipelineStage: stage })
    if (source) andConditions.push({ source })
    if (minScore || maxScore) {
      andConditions.push({
        score: {
          ...(minScore ? { gte: parseInt(minScore) } : {}),
          ...(maxScore ? { lte: parseInt(maxScore) } : {})
        }
      })
    }
    if (search) {
      andConditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } }
        ]
      })
    }

    const where = { AND: andConditions }

    const take = Math.min(parseInt(limit) || 50, 200)
    const contacts = await prisma.contact.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        _count: { select: { activities: true, tasks: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, title: true } }
      }
    })

    const nextCursor = contacts.length === take ? contacts[contacts.length - 1].id : null
    res.json({ contacts, nextCursor })
  } catch (err) {
    logger.error('CRM get contacts error', { err })
    res.status(500).json({ error: 'Failed to fetch contacts' })
  }
})

// POST /crm/contacts/recalculate-scores  (bulk rescore all contacts)
router.post('/contacts/recalculate-scores', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const contacts = await prisma.contact.findMany({ where: { clientId }, select: { id: true } })
    let updated = 0
    for (const c of contacts) {
      await calculateAndSaveScore(c.id, clientId).catch(() => {})
      updated++
    }
    res.json({ updated })
  } catch (err) {
    logger.error('CRM recalculate scores error', { err })
    res.status(500).json({ error: 'Failed to recalculate scores' })
  }
})

// GET /crm/contacts/:id
router.get('/contacts/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const id = req.params.id

    const contacts = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "Contact" WHERE "id" = ${id} AND "clientId" = ${clientId} LIMIT 1
    `
    if (!contacts.length) { res.status(404).json({ error: 'Contact not found' }); return }
    const contact = contacts[0]

    const [activities, notes, tasks, deals] = await Promise.all([
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "ContactActivity" WHERE "contactId" = ${id}
        ORDER BY "createdAt" DESC LIMIT 20
      `,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "ContactNote" WHERE "contactId" = ${id}
        ORDER BY "createdAt" DESC
      `,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "ContactTask" WHERE "contactId" = ${id} AND "status" = 'PENDING'
        ORDER BY "dueAt" ASC NULLS LAST
      `,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "Deal" WHERE "contactId" = ${id}
        ORDER BY "createdAt" DESC
      `.catch(() => [] as Array<Record<string, unknown>>)
    ])

    res.json({ contact: { ...contact, activities, notes, tasks, deals } })
  } catch (err) {
    logger.error('CRM get contact error', { err })
    res.status(500).json({ error: 'Failed to fetch contact' })
  }
})

// POST /crm/contacts
router.post('/contacts', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { name, email, phone, source, pipelineStage, dealValue, tags } = req.body as {
      name?: string; email?: string; phone?: string; source?: string
      pipelineStage?: string; dealValue?: number; tags?: string[]
    }

    const contact = await prisma.contact.create({
      data: {
        id: randomUUID(),
        clientId,
        name,
        email,
        phone,
        source: source || 'manual',
        pipelineStage: (pipelineStage || 'NEW_LEAD') as never,
        dealValue: dealValue as never,
        tags: tags || [],
        updatedAt: new Date()
      }
    })

    await logActivity(contact.id, clientId, 'STAGE_CHANGE', 'Contact created', `Added to ${pipelineStage || 'New Lead'}`)
    calculateAndSaveScore(contact.id, clientId).catch(() => {})
    logger.info('CRM contact created', { clientId, contactId: contact.id })
    res.status(201).json({ contact })
  } catch (err) {
    logger.error('CRM create contact error', { err })
    res.status(500).json({ error: 'Failed to create contact' })
  }
})

// PATCH /crm/contacts/:id
router.patch('/contacts/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }

    const { name, email, phone, source, score, tags, summary, nextAction, pipelineStage, dealValue, dealCurrency, lastContactedAt } = req.body as Record<string, unknown>

    const updated = await prisma.contact.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name as string }),
        ...(email !== undefined && { email: email as string }),
        ...(phone !== undefined && { phone: phone as string }),
        ...(source !== undefined && { source: source as string }),
        ...(score !== undefined && { score: score as number }),
        ...(tags !== undefined && { tags: tags as never }),
        ...(summary !== undefined && { summary: summary as string }),
        ...(nextAction !== undefined && { nextAction: nextAction as string }),
        ...(pipelineStage !== undefined && { pipelineStage: pipelineStage as never }),
        ...(dealValue !== undefined && { dealValue: dealValue as never }),
        ...(dealCurrency !== undefined && { dealCurrency: dealCurrency as string }),
        ...(lastContactedAt !== undefined && { lastContactedAt: new Date(lastContactedAt as string) }),
        updatedAt: new Date()
      }
    })

    // Log meaningful changes as activities
    if (pipelineStage && pipelineStage !== existing.pipelineStage) {
      await logActivity(existing.id, clientId, 'STAGE_CHANGE',
        `Moved to ${(pipelineStage as string).replace(/_/g, ' ')}`,
        `From ${existing.pipelineStage.replace(/_/g, ' ')}`,
        { from: existing.pipelineStage, to: pipelineStage }
      )
      // Notify for significant stage changes
      const notifyStages = ['QUALIFIED', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST']
      if (notifyStages.includes(pipelineStage as string)) {
        const stageLabel = (pipelineStage as string).replace(/_/g, ' ')
        const notifId = randomUUID()
        await prisma.$executeRaw`
          INSERT INTO "Notification" ("id", "clientId", "type", "title", "body", "link", "createdAt")
          VALUES (${notifId}, ${clientId}, 'STAGE_CHANGE', ${`${existing.name || 'Contact'} → ${stageLabel}`}, ${'Pipeline stage updated'}, ${`/dashboard/crm/contacts/${existing.id}`}, NOW())
        `.catch(() => {})
      }
      calculateAndSaveScore(existing.id, clientId).catch(() => {})
    }

    res.json({ contact: updated })
  } catch (err) {
    logger.error('CRM update contact error', { err })
    res.status(500).json({ error: 'Failed to update contact' })
  }
})

// DELETE /crm/contacts/:id
router.delete('/contacts/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }
    await prisma.contact.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    logger.error('CRM delete contact error', { err })
    res.status(500).json({ error: 'Failed to delete contact' })
  }
})

// ── Activity Timeline ─────────────────────────────────────────────────────────

// GET /crm/contacts/:id/activities
router.get('/contacts/:id/activities', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }

    const { limit = '20', cursor, type } = req.query as Record<string, string>
    const take = Math.min(parseInt(limit) || 20, 100)

    const activities = await prisma.contactActivity.findMany({
      where: {
        contactId: req.params.id,
        ...(type ? { type: type as never } : {})
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    })

    const nextCursor = activities.length === take ? activities[activities.length - 1].id : null
    res.json({ activities, nextCursor })
  } catch (err) {
    logger.error('CRM get activities error', { err })
    res.status(500).json({ error: 'Failed to fetch activities' })
  }
})

// POST /crm/contacts/:id/activities  (manual human-authored activity)
router.post('/contacts/:id/activities', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }

    const { type, title, body, metadata } = req.body as { type: string; title: string; body?: string; metadata?: Record<string, unknown> }
    if (!type || !title) { res.status(400).json({ error: 'type and title required' }); return }

    await logActivity(req.params.id, clientId, type, title, body, metadata)
    await prisma.contact.update({ where: { id: req.params.id }, data: { lastContactedAt: new Date(), updatedAt: new Date() } })
    if (type !== 'SCORE_CHANGE') calculateAndSaveScore(req.params.id, clientId).catch(() => {})
    res.status(201).json({ success: true })
  } catch (err) {
    logger.error('CRM create activity error', { err })
    res.status(500).json({ error: 'Failed to create activity' })
  }
})

// ── Notes ─────────────────────────────────────────────────────────────────────

// GET /crm/contacts/:id/notes
router.get('/contacts/:id/notes', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }

    const notes = await prisma.contactNote.findMany({
      where: { contactId: req.params.id },
      orderBy: { createdAt: 'desc' }
    })
    res.json({ notes })
  } catch (err) {
    logger.error('CRM get notes error', { err })
    res.status(500).json({ error: 'Failed to fetch notes' })
  }
})

// POST /crm/contacts/:id/notes
router.post('/contacts/:id/notes', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }

    const { body, authorType = 'human' } = req.body as { body: string; authorType?: string }
    if (!body) { res.status(400).json({ error: 'body required' }); return }

    const note = await prisma.contactNote.create({
      data: { id: randomUUID(), contactId: req.params.id, body, authorType }
    })
    await logActivity(req.params.id, clientId, 'NOTE', 'Note added', body.substring(0, 100), { authorType })
    res.status(201).json({ note })
  } catch (err) {
    logger.error('CRM create note error', { err })
    res.status(500).json({ error: 'Failed to create note' })
  }
})

// DELETE /crm/contacts/:id/notes/:noteId
router.delete('/contacts/:id/notes/:noteId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }
    await prisma.contactNote.delete({ where: { id: req.params.noteId } })
    res.json({ success: true })
  } catch (err) {
    logger.error('CRM delete note error', { err })
    res.status(500).json({ error: 'Failed to delete note' })
  }
})

// ── Tasks ─────────────────────────────────────────────────────────────────────

// GET /crm/tasks
router.get('/tasks', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { status, contactId } = req.query as Record<string, string>

    const tasks = await prisma.contactTask.findMany({
      where: {
        clientId,
        ...(status && status !== 'ALL' ? { status: status as never } : {}),
        ...(contactId ? { contactId } : {})
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      include: { contact: { select: { id: true, name: true, email: true } } }
    })
    res.json({ tasks })
  } catch (err) {
    logger.error('CRM get tasks error', { err })
    res.status(500).json({ error: 'Failed to fetch tasks' })
  }
})

// POST /crm/contacts/:id/tasks
router.post('/contacts/:id/tasks', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }

    const { title, body, dueAt } = req.body as { title: string; body?: string; dueAt?: string }
    if (!title) { res.status(400).json({ error: 'title required' }); return }

    const task = await prisma.contactTask.create({
      data: {
        id: randomUUID(),
        contactId: req.params.id,
        clientId,
        title,
        body,
        dueAt: dueAt ? new Date(dueAt) : undefined,
        updatedAt: new Date()
      }
    })
    res.status(201).json({ task })
  } catch (err) {
    logger.error('CRM create task error', { err })
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// PATCH /crm/tasks/:taskId
router.patch('/tasks/:taskId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await prisma.contactTask.findFirst({ where: { id: req.params.taskId, clientId } })
    if (!existing) { res.status(404).json({ error: 'Task not found' }); return }

    const { title, body, dueAt, status } = req.body as Record<string, string>
    const completedAt = status === 'DONE' && existing.status !== 'DONE' ? new Date() : existing.completedAt

    const task = await prisma.contactTask.update({
      where: { id: req.params.taskId },
      data: {
        ...(title !== undefined && { title }),
        ...(body !== undefined && { body }),
        ...(dueAt !== undefined && { dueAt: new Date(dueAt) }),
        ...(status !== undefined && { status: status as never }),
        completedAt,
        updatedAt: new Date()
      }
    })

    if (status === 'DONE' && existing.status !== 'DONE') {
      await logActivity(existing.contactId, clientId, 'TASK_COMPLETED', `Task completed: ${existing.title}`)
    }

    res.json({ task })
  } catch (err) {
    logger.error('CRM update task error', { err })
    res.status(500).json({ error: 'Failed to update task' })
  }
})

// DELETE /crm/tasks/:taskId
router.delete('/tasks/:taskId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await prisma.contactTask.findFirst({ where: { id: req.params.taskId, clientId } })
    if (!existing) { res.status(404).json({ error: 'Task not found' }); return }
    await prisma.contactTask.delete({ where: { id: req.params.taskId } })
    res.json({ success: true })
  } catch (err) {
    logger.error('CRM delete task error', { err })
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

// ── Deals ─────────────────────────────────────────────────────────────────────

// GET /crm/deals
router.get('/deals', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { stage } = req.query as Record<string, string>

    const deals = await prisma.deal.findMany({
      where: { clientId, ...(stage ? { stage: stage as never } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { contact: { select: { id: true, name: true, email: true } } }
    })
    res.json({ deals })
  } catch (err) {
    logger.error('CRM get deals error', { err })
    res.status(500).json({ error: 'Failed to fetch deals' })
  }
})

// POST /crm/contacts/:id/deals
router.post('/contacts/:id/deals', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.id, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }

    const { title, value, currency = 'AUD', stage = 'NEW_LEAD', probability } = req.body as {
      title: string; value?: number; currency?: string; stage?: string; probability?: number
    }
    if (!title) { res.status(400).json({ error: 'title required' }); return }

    const deal = await prisma.deal.create({
      data: {
        id: randomUUID(),
        contactId: req.params.id,
        clientId,
        title,
        value: value as never,
        currency,
        stage: stage as never,
        probability,
        updatedAt: new Date()
      }
    })

    // Update contact dealValue with sum of all active deals
    await syncContactDealValue(req.params.id)
    await logActivity(req.params.id, clientId, 'STAGE_CHANGE', `Deal created: ${title}`, undefined, { dealId: deal.id, value, stage })
    res.status(201).json({ deal })
  } catch (err) {
    logger.error('CRM create deal error', { err })
    res.status(500).json({ error: 'Failed to create deal' })
  }
})

// PATCH /crm/deals/:dealId
router.patch('/deals/:dealId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, clientId } })
    if (!existing) { res.status(404).json({ error: 'Deal not found' }); return }

    const { title, value, stage, probability, closedAt, lostReason } = req.body as Record<string, unknown>

    const deal = await prisma.deal.update({
      where: { id: req.params.dealId },
      data: {
        ...(title !== undefined && { title: title as string }),
        ...(value !== undefined && { value: value as never }),
        ...(stage !== undefined && { stage: stage as never }),
        ...(probability !== undefined && { probability: probability as number }),
        ...(closedAt !== undefined && { closedAt: new Date(closedAt as string) }),
        ...(lostReason !== undefined && { lostReason: lostReason as string }),
        updatedAt: new Date()
      }
    })

    if (stage && stage !== existing.stage) {
      await logActivity(existing.contactId, clientId, 'STAGE_CHANGE',
        `Deal moved to ${(stage as string).replace(/_/g, ' ')}`,
        existing.title,
        { dealId: deal.id, from: existing.stage, to: stage }
      )
    }

    await syncContactDealValue(existing.contactId)
    res.json({ deal })
  } catch (err) {
    logger.error('CRM update deal error', { err })
    res.status(500).json({ error: 'Failed to update deal' })
  }
})

// DELETE /crm/deals/:dealId
router.delete('/deals/:dealId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, clientId } })
    if (!existing) { res.status(404).json({ error: 'Deal not found' }); return }
    await prisma.deal.delete({ where: { id: req.params.dealId } })
    await syncContactDealValue(existing.contactId)
    res.json({ success: true })
  } catch (err) {
    logger.error('CRM delete deal error', { err })
    res.status(500).json({ error: 'Failed to delete deal' })
  }
})

async function syncContactDealValue(contactId: string): Promise<void> {
  const result = await prisma.deal.aggregate({
    where: { contactId, NOT: { stage: 'CLOSED_LOST' as never } },
    _sum: { value: true }
  })
  await prisma.contact.update({
    where: { id: contactId },
    data: { dealValue: result._sum.value as never, updatedAt: new Date() }
  })
}

// ── Pipeline (Kanban) ─────────────────────────────────────────────────────────

// GET /crm/pipeline
router.get('/pipeline', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const stages = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST']

    const contacts = await prisma.contact.findMany({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, email: true, phone: true, source: true,
        score: true, pipelineStage: true, dealValue: true, dealCurrency: true,
        createdAt: true, updatedAt: true, tags: true,
        activities: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, title: true } }
      }
    })

    const pipeline = stages.reduce((acc, stage) => {
      const stageContacts = contacts.filter(c => (c.pipelineStage as string) === stage)
      const totalValue = stageContacts.reduce((sum, c) => sum + Number(c.dealValue || 0), 0)
      acc[stage] = { contacts: stageContacts, count: stageContacts.length, totalValue }
      return acc
    }, {} as Record<string, unknown>)

    res.json({ pipeline })
  } catch (err) {
    logger.error('CRM get pipeline error', { err })
    res.status(500).json({ error: 'Failed to fetch pipeline' })
  }
})

// PATCH /crm/pipeline/:contactId/stage  (drag-and-drop)
router.patch('/pipeline/:contactId/stage', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const existing = await getContact(req.params.contactId, clientId)
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return }

    const { stage } = req.body as { stage: string }
    if (!stage) { res.status(400).json({ error: 'stage required' }); return }

    await prisma.contact.update({
      where: { id: req.params.contactId },
      data: { pipelineStage: stage as never, updatedAt: new Date() }
    })

    await logActivity(req.params.contactId, clientId, 'STAGE_CHANGE',
      `Moved to ${stage.replace(/_/g, ' ')}`,
      undefined,
      { from: existing.pipelineStage, to: stage }
    )
    calculateAndSaveScore(req.params.contactId, clientId).catch(() => {})

    res.json({ success: true })
  } catch (err) {
    logger.error('CRM pipeline stage update error', { err })
    res.status(500).json({ error: 'Failed to update pipeline stage' })
  }
})

// ── Reports ───────────────────────────────────────────────────────────────────

// GET /crm/reports/summary
router.get('/reports/summary', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!

    const [pipelineRows, sourceRows, activityRows, dealRows, totalContactsRows] = await Promise.all([
      // Contacts grouped by pipeline stage
      prisma.$queryRaw<Array<{ pipelineStage: string; count: bigint }>>`
        SELECT "pipelineStage", COUNT(*) as count FROM "Contact"
        WHERE "clientId" = ${clientId}
        GROUP BY "pipelineStage"
      `,
      // Contacts grouped by source
      prisma.$queryRaw<Array<{ source: string; count: bigint }>>`
        SELECT COALESCE(source, 'unknown') as source, COUNT(*) as count FROM "Contact"
        WHERE "clientId" = ${clientId}
        GROUP BY source
        ORDER BY count DESC
      `,
      // Activities grouped by type
      prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
        SELECT type, COUNT(*) as count FROM "ContactActivity"
        WHERE "clientId" = ${clientId}
        AND type NOT IN ('SCORE_CHANGE')
        GROUP BY type
        ORDER BY count DESC
      `,
      // Deal value stats
      prisma.$queryRaw<Array<{ stage: string; total: string; avg: string; cnt: bigint }>>`
        SELECT stage, COALESCE(SUM(value),0) as total, COALESCE(AVG(value),0) as avg, COUNT(*) as cnt
        FROM "Deal" WHERE "clientId" = ${clientId}
        GROUP BY stage
      `,
      // Total contacts
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM "Contact" WHERE "clientId" = ${clientId}
      `
    ])

    const totalContacts = Number(totalContactsRows[0]?.count ?? 0)

    const STAGE_ORDER = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST']
    const stageMap = Object.fromEntries(pipelineRows.map(r => [r.pipelineStage as string, Number(r.count)]))
    const dealMap = Object.fromEntries(dealRows.map(r => [r.stage as string, { total: parseFloat(r.total), avg: parseFloat(r.avg), cnt: Number(r.cnt) }]))

    const pipeline = STAGE_ORDER.map(stage => ({
      stage,
      count: stageMap[stage] || 0,
      value: dealMap[stage]?.total || 0
    }))

    const closedWon = stageMap['CLOSED_WON'] || 0
    const closedLost = stageMap['CLOSED_LOST'] || 0
    const closedTotal = closedWon + closedLost
    const conversionRate = closedTotal > 0 ? Math.round((closedWon / closedTotal) * 100) : 0

    const activePipelineValue = dealRows
      .filter(r => r.stage !== 'CLOSED_LOST')
      .reduce((sum, r) => sum + parseFloat(r.total), 0)
    const closedWonValue = dealMap['CLOSED_WON']?.total || 0
    const totalDealCount = dealRows.filter(r => r.stage !== 'CLOSED_LOST').reduce((sum, r) => sum + Number(r.cnt), 0)
    const avgDealSize = totalDealCount > 0 ? Math.round(activePipelineValue / totalDealCount) : 0

    res.json({
      pipeline,
      sources: sourceRows.map(r => ({ source: r.source as string, count: Number(r.count) })),
      activities: activityRows.map(r => ({ type: r.type as string, count: Number(r.count) })),
      conversion: { totalContacts, closedWon, closedLost, conversionRate },
      revenue: { closedWon: closedWonValue, pipeline: activePipelineValue, average: avgDealSize }
    })
  } catch (err) {
    logger.error('CRM reports summary error', { err })
    res.status(500).json({ error: 'Failed to fetch reports' })
  }
})

export default router
