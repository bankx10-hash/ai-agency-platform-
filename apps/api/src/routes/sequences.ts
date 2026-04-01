import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import nodemailer from 'nodemailer'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logger } from '../utils/logger'

const router = Router()
const prisma = new PrismaClient()

router.use(authMiddleware)

interface SequenceStep {
  order: number
  subject: string
  body: string
  delayDays: number
}

// ── Sequences CRUD ────────────────────────────────────────────────────────────

// GET /sequences
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const sequences = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT s.*,
        (SELECT COUNT(*) FROM "SequenceEnrollment" e WHERE e."sequenceId" = s.id AND e.status = 'ACTIVE')::int as "activeEnrollments"
      FROM "EmailSequence" s
      WHERE s."clientId" = ${clientId}
      ORDER BY s."createdAt" DESC
    `
    res.json({ sequences })
  } catch (err) {
    logger.error('Get sequences error', { err })
    res.status(500).json({ error: 'Failed to fetch sequences' })
  }
})

// GET /sequences/enrollments  — must be before /:id
router.get('/enrollments', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { contactId } = req.query as { contactId?: string }

    let enrollments: Array<Record<string, unknown>>
    if (contactId) {
      enrollments = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT e.id, e."currentStep", e.status, e."nextSendAt", e."enrolledAt",
               s.name as "sequenceName", s.steps
        FROM "SequenceEnrollment" e
        JOIN "EmailSequence" s ON s.id = e."sequenceId"
        WHERE e."clientId" = ${clientId} AND e."contactId" = ${contactId}
        ORDER BY e."enrolledAt" DESC
      `
    } else {
      enrollments = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT e.id, e."contactId", e."currentStep", e.status, e."nextSendAt", e."enrolledAt",
               s.name as "sequenceName", c.name as "contactName", c.email as "contactEmail"
        FROM "SequenceEnrollment" e
        JOIN "EmailSequence" s ON s.id = e."sequenceId"
        JOIN "Contact" c ON c.id = e."contactId"
        WHERE e."clientId" = ${clientId} AND e.status = 'ACTIVE'
        ORDER BY e."nextSendAt" ASC
      `
    }
    res.json({ enrollments })
  } catch (err) {
    logger.error('Get enrollments error', { err })
    res.status(500).json({ error: 'Failed to fetch enrollments' })
  }
})

// DELETE /sequences/enrollments/:enrollmentId  — must be before /:id
router.delete('/enrollments/:enrollmentId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    await prisma.$executeRaw`
      UPDATE "SequenceEnrollment" SET status = 'CANCELLED', "completedAt" = NOW()
      WHERE id = ${req.params.enrollmentId} AND "clientId" = ${clientId}
    `
    res.json({ success: true })
  } catch (err) {
    logger.error('Cancel enrollment error', { err })
    res.status(500).json({ error: 'Failed to cancel enrollment' })
  }
})

// POST /sequences
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { name, description, steps } = req.body as { name: string; description?: string; steps: SequenceStep[] }
    if (!name || !steps?.length) { res.status(400).json({ error: 'name and steps required' }); return }

    const stepsWithOrder: SequenceStep[] = steps.map((s, i) => ({ ...s, order: i + 1 }))
    const id = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "EmailSequence" ("id", "clientId", "name", "description", "steps", "isActive", "createdAt", "updatedAt")
      VALUES (${id}, ${clientId}, ${name}, ${description || null}, ${JSON.stringify(stepsWithOrder)}::jsonb, true, NOW(), NOW())
    `
    res.status(201).json({ id })
  } catch (err) {
    logger.error('Create sequence error', { err })
    res.status(500).json({ error: 'Failed to create sequence' })
  }
})

// PATCH /sequences/:id
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { name, isActive } = req.body as { name?: string; isActive?: boolean }
    if (name !== undefined) {
      await prisma.$executeRaw`UPDATE "EmailSequence" SET "name" = ${name}, "updatedAt" = NOW() WHERE id = ${req.params.id} AND "clientId" = ${clientId}`
    }
    if (isActive !== undefined) {
      await prisma.$executeRaw`UPDATE "EmailSequence" SET "isActive" = ${isActive}, "updatedAt" = NOW() WHERE id = ${req.params.id} AND "clientId" = ${clientId}`
    }
    res.json({ success: true })
  } catch (err) {
    logger.error('Update sequence error', { err })
    res.status(500).json({ error: 'Failed to update sequence' })
  }
})

// DELETE /sequences/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    await prisma.$executeRaw`DELETE FROM "EmailSequence" WHERE id = ${req.params.id} AND "clientId" = ${clientId}`
    res.json({ success: true })
  } catch (err) {
    logger.error('Delete sequence error', { err })
    res.status(500).json({ error: 'Failed to delete sequence' })
  }
})

// POST /sequences/:id/enroll
router.post('/:id/enroll', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { contactId } = req.body as { contactId: string }
    if (!contactId) { res.status(400).json({ error: 'contactId required' }); return }

    const seqs = await prisma.$queryRaw<Array<{ id: string; steps: unknown; isActive: boolean }>>`
      SELECT id, steps, "isActive" FROM "EmailSequence"
      WHERE id = ${req.params.id} AND "clientId" = ${clientId}
    `
    if (!seqs.length) { res.status(404).json({ error: 'Sequence not found' }); return }
    const seq = seqs[0]
    if (!seq.isActive) { res.status(400).json({ error: 'Sequence is paused' }); return }

    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "SequenceEnrollment"
      WHERE "contactId" = ${contactId} AND "sequenceId" = ${req.params.id} AND status = 'ACTIVE'
    `
    if (existing.length) { res.status(400).json({ error: 'Contact is already enrolled in this sequence' }); return }

    const steps = (seq.steps as SequenceStep[]).sort((a, b) => a.order - b.order)
    const firstStep = steps[0]
    const nextSendAt = new Date()
    if (firstStep.delayDays > 0) nextSendAt.setDate(nextSendAt.getDate() + firstStep.delayDays)

    const id = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "SequenceEnrollment" ("id", "clientId", "contactId", "sequenceId", "currentStep", "status", "nextSendAt", "enrolledAt")
      VALUES (${id}, ${clientId}, ${contactId}, ${req.params.id}, 1, 'ACTIVE', ${nextSendAt}, NOW())
    `
    res.status(201).json({ id, nextSendAt })
  } catch (err) {
    logger.error('Enroll contact error', { err })
    res.status(500).json({ error: 'Failed to enroll contact' })
  }
})

// ── Cron processor (called from index.ts every 15 min) ───────────────────────

export async function processSequences(): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return

  const due = await prisma.$queryRaw<Array<{
    id: string; clientId: string; contactId: string; currentStep: number; steps: unknown
    contactName: string | null; contactEmail: string | null; businessName: string
  }>>`
    SELECT e.id, e."clientId", e."contactId", e."currentStep", s.steps,
           c.name as "contactName", c.email as "contactEmail", cl."businessName"
    FROM "SequenceEnrollment" e
    JOIN "EmailSequence" s ON s.id = e."sequenceId"
    JOIN "Contact" c ON c.id = e."contactId"
    JOIN "Client" cl ON cl.id = e."clientId"
    WHERE e.status = 'ACTIVE' AND e."nextSendAt" <= NOW()
    LIMIT 50
  `

  for (const enrollment of due) {
    try {
      await processEnrollment(enrollment)
    } catch (err) {
      logger.error('Sequence step failed', { enrollmentId: enrollment.id, err })
    }
  }
}

async function processEnrollment(e: {
  id: string; clientId: string; contactId: string; currentStep: number; steps: unknown
  contactName: string | null; contactEmail: string | null; businessName: string
}): Promise<void> {
  if (!e.contactEmail) {
    await prisma.$executeRaw`UPDATE "SequenceEnrollment" SET status = 'CANCELLED', "completedAt" = NOW() WHERE id = ${e.id}`
    return
  }

  const steps = (e.steps as SequenceStep[]).sort((a, b) => a.order - b.order)
  const step = steps.find(s => s.order === e.currentStep)
  if (!step) {
    await prisma.$executeRaw`UPDATE "SequenceEnrollment" SET status = 'COMPLETED', "completedAt" = NOW() WHERE id = ${e.id}`
    return
  }

  const name = e.contactName || 'there'
  const subject = step.subject.replace(/\{name\}/gi, name).replace(/\{businessName\}/gi, e.businessName)
  const body = step.body
    .replace(/\{name\}/gi, name)
    .replace(/\{email\}/gi, e.contactEmail)
    .replace(/\{businessName\}/gi, e.businessName)

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  })

  await transporter.sendMail({
    from: `"${e.businessName}" <${process.env.SMTP_USER}>`,
    to: e.contactEmail,
    subject,
    text: body,
    html: body.replace(/\n/g, '<br>')
  })

  // Log activity + update lastContactedAt
  const actId = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "ContactActivity" ("id", "contactId", "clientId", "type", "title", "body", "createdAt")
    VALUES (${actId}, ${e.contactId}, ${e.clientId}, 'EMAIL', ${`Sequence email sent: ${subject}`}, ${body.substring(0, 200)}, NOW())
  `
  await prisma.$executeRaw`UPDATE "Contact" SET "lastContactedAt" = NOW(), "updatedAt" = NOW() WHERE id = ${e.contactId}`

  // Advance or complete
  const nextStep = steps.find(s => s.order === e.currentStep + 1)
  if (nextStep) {
    const nextSendAt = new Date()
    nextSendAt.setDate(nextSendAt.getDate() + nextStep.delayDays)
    await prisma.$executeRaw`
      UPDATE "SequenceEnrollment" SET "currentStep" = ${e.currentStep + 1}, "nextSendAt" = ${nextSendAt}
      WHERE id = ${e.id}
    `
  } else {
    await prisma.$executeRaw`UPDATE "SequenceEnrollment" SET status = 'COMPLETED', "completedAt" = NOW() WHERE id = ${e.id}`
  }

  logger.info('Sequence step sent', { enrollmentId: e.id, step: e.currentStep, to: e.contactEmail })
}

export default router
