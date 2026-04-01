import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import twilio from 'twilio'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'

const router = Router()
const prisma = new PrismaClient()

router.use(authMiddleware)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

// Get the client's provisioned Twilio number from credentials
async function getClientPhoneNumber(clientId: string): Promise<string | null> {
  const cred = await prisma.clientCredential.findFirst({
    where: { clientId, service: 'twilio-phone' }
  })
  if (!cred) return null
  try {
    const data = decryptJSON<{ phoneNumber: string }>(cred.credentials)
    return data.phoneNumber || null
  } catch { return null }
}

// Find contact by phone number
async function findContactByPhone(clientId: string, phone: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Contact" WHERE "clientId" = ${clientId} AND phone = ${phone} LIMIT 1
  `
  return rows[0]?.id || null
}

// ── Authenticated routes ──────────────────────────────────────────────────────

// GET /sms/conversations — list unique conversations with last message
router.get('/conversations', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const myNumber = await getClientPhoneNumber(clientId)

    const convos = await prisma.$queryRaw<Array<{
      phone: string; lastMessage: string; lastAt: Date; unread: bigint
      contactId: string | null; contactName: string | null
    }>>`
      WITH ranked AS (
        SELECT *,
          CASE WHEN direction = 'INBOUND' THEN "from" ELSE "to" END as phone,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN direction = 'INBOUND' THEN "from" ELSE "to" END
            ORDER BY "createdAt" DESC
          ) as rn
        FROM "SmsMessage"
        WHERE "clientId" = ${clientId}
      )
      SELECT r.phone, r.body as "lastMessage", r."createdAt" as "lastAt",
             r."contactId",
             c.name as "contactName"
      FROM ranked r
      LEFT JOIN "Contact" c ON c.id = r."contactId"
      WHERE r.rn = 1
      ORDER BY r."createdAt" DESC
    `

    res.json({ conversations: convos.map(c => ({ ...c, unread: Number(c.unread) })), myNumber })
  } catch (err) {
    logger.error('SMS get conversations error', { err })
    res.status(500).json({ error: 'Failed to fetch conversations' })
  }
})

// GET /sms/conversations/:phone — messages in a thread
router.get('/conversations/:phone', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const phone = decodeURIComponent(req.params.phone)

    const messages = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, "from", "to", body, direction, "twilioSid", "createdAt", "contactId"
      FROM "SmsMessage"
      WHERE "clientId" = ${clientId}
        AND ("from" = ${phone} OR "to" = ${phone})
      ORDER BY "createdAt" ASC
    `

    const contactId = await findContactByPhone(clientId, phone)
    let contact = null
    if (contactId) {
      const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null; email: string | null }>>`
        SELECT id, name, email FROM "Contact" WHERE id = ${contactId}
      `
      contact = rows[0] || null
    }

    res.json({ messages, contact })
  } catch (err) {
    logger.error('SMS get thread error', { err })
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// POST /sms/send
router.post('/send', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const { to, body } = req.body as { to: string; body: string }
    if (!to || !body) { res.status(400).json({ error: 'to and body required' }); return }

    const fromNumber = await getClientPhoneNumber(clientId)
    if (!fromNumber) { res.status(400).json({ error: 'No Twilio number configured for this account' }); return }

    const msg = await twilioClient.messages.create({ from: fromNumber, to, body })

    const contactId = await findContactByPhone(clientId, to)
    const id = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "SmsMessage" ("id", "clientId", "contactId", "from", "to", "body", "direction", "twilioSid", "createdAt")
      VALUES (${id}, ${clientId}, ${contactId}, ${fromNumber}, ${to}, ${body}, 'OUTBOUND', ${msg.sid}, NOW())
    `

    if (contactId) {
      const actId = randomUUID()
      await prisma.$executeRaw`
        INSERT INTO "ContactActivity" ("id", "contactId", "clientId", "type", "title", "body", "createdAt")
        VALUES (${actId}, ${contactId}, ${clientId}, 'SMS', ${'SMS sent'}, ${body.substring(0, 200)}, NOW())
      `
      await prisma.$executeRaw`UPDATE "Contact" SET "lastContactedAt" = NOW(), "updatedAt" = NOW() WHERE id = ${contactId}`
    }

    res.json({ success: true, sid: msg.sid })
  } catch (err) {
    logger.error('SMS send error', { err })
    res.status(500).json({ error: 'Failed to send SMS' })
  }
})

export default router

// ── Public webhook (no auth — registered separately in index.ts) ─────────────

export async function handleSmsWebhook(req: Request, res: Response): Promise<void> {
  try {
    const { From, To, Body, MessageSid } = req.body as {
      From: string; To: string; Body: string; MessageSid: string
    }

    if (!From || !To || !Body) { res.status(400).send('Bad Request'); return }

    // Find which client owns this Twilio number
    const creds = await prisma.clientCredential.findMany({
      where: { service: { startsWith: 'twilio-phone-' } },
      select: { clientId: true, credentials: true }
    })

    let clientId: string | null = null
    for (const cred of creds) {
      try {
        const data = decryptJSON<{ phoneNumber: string }>(cred.credentials)
        if (data.phoneNumber === To) { clientId = cred.clientId; break }
      } catch { continue }
    }

    // Fall back to TWILIO_PHONE_NUMBER env var (shared number)
    if (!clientId && process.env.TWILIO_PHONE_NUMBER === To) {
      // Find most recently active client as fallback — not ideal but handles shared number
      const clients = await prisma.client.findFirst({
        where: { status: 'ACTIVE' as never },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
      })
      clientId = clients?.id || null
    }

    if (!clientId) {
      logger.warn('SMS webhook: no client found for number', { To })
      res.status(200).send('<Response/>')
      return
    }

    const contactId = await findContactByPhone(clientId, From)

    const id = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "SmsMessage" ("id", "clientId", "contactId", "from", "to", "body", "direction", "twilioSid", "createdAt")
      VALUES (${id}, ${clientId}, ${contactId}, ${From}, ${To}, ${Body}, 'INBOUND', ${MessageSid}, NOW())
    `

    if (contactId) {
      const actId = randomUUID()
      await prisma.$executeRaw`
        INSERT INTO "ContactActivity" ("id", "contactId", "clientId", "type", "title", "body", "createdAt")
        VALUES (${actId}, ${contactId}, ${clientId}, 'SMS', ${'SMS received'}, ${Body.substring(0, 200)}, NOW())
      `
    }

    // Notification
    const notifId = randomUUID()
    const contactName = contactId
      ? (await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT name FROM "Contact" WHERE id = ${contactId}`)[0]?.name
      : null
    await prisma.$executeRaw`
      INSERT INTO "Notification" ("id", "clientId", "type", "title", "body", "link", "createdAt")
      VALUES (${notifId}, ${clientId}, 'NEW_LEAD', ${`SMS from ${contactName || From}`}, ${Body.substring(0, 100)}, ${'/dashboard/sms'}, NOW())
    `.catch(() => {})

    // Respond to Twilio with empty TwiML
    res.setHeader('Content-Type', 'text/xml')
    res.status(200).send('<Response/>')
  } catch (err) {
    logger.error('SMS webhook error', { err })
    res.setHeader('Content-Type', 'text/xml')
    res.status(200).send('<Response/>')
  }
}
