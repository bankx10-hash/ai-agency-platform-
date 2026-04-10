import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { randomUUID } from 'crypto'
import twilio from 'twilio'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'
import { recordUsage } from '../services/usage.service'

const router = Router()

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
    recordUsage(clientId, 'SMS', 1, msg.sid, 'sms').catch(() => {})

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

    // Find which client owns this Twilio number. Voice numbers can be stored
    // under several service names depending on which provisioning path was
    // used (twilio-phone, twilio-phone-*, retell-inbound, voice-inbound-*).
    // Check ALL of them.
    const creds = await prisma.clientCredential.findMany({
      where: {
        OR: [
          { service: 'twilio-phone' },
          { service: { startsWith: 'twilio-phone-' } },
          { service: 'retell-inbound' },
          { service: { startsWith: 'voice-inbound-' } },
          { service: { startsWith: 'retell-' } }
        ]
      },
      select: { clientId: true, credentials: true, service: true }
    })

    let clientId: string | null = null
    for (const cred of creds) {
      try {
        const data = decryptJSON<{ phoneNumber?: string; phone_number?: string }>(cred.credentials)
        const stored = data.phoneNumber || data.phone_number || ''
        if (stored && stored === To) {
          clientId = cred.clientId
          logger.info('SMS webhook matched client by phone', { To, clientId, service: cred.service })
          break
        }
      } catch { continue }
    }

    // Last-resort: scan all AgentDeployment configs for a phone_number match
    if (!clientId) {
      const deployments = await prisma.agentDeployment.findMany({
        where: { agentType: { in: ['VOICE_INBOUND' as never, 'VOICE_OUTBOUND' as never, 'VOICE_CLOSER' as never] } },
        select: { clientId: true, config: true, agentType: true }
      })
      for (const dep of deployments) {
        const cfg = dep.config as Record<string, unknown> | null
        const num = cfg?.phone_number as string | undefined
        if (num && num === To) {
          clientId = dep.clientId
          logger.info('SMS webhook matched client by deployment config phone', { To, clientId, agentType: dep.agentType })
          break
        }
      }
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

    // Forward to appointment-setter reply webhook so the workflow can
    // classify the reply and book an appointment if the lead is interested.
    // Fire-and-forget — don't block the Twilio response on this.
    // Also try to look up contactId by phone if we don't have one yet,
    // normalising for common format mismatches (leading +, spaces).
    let replyContactId = contactId
    if (!replyContactId) {
      const normalisedFrom = From.replace(/[^\d+]/g, '')
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Contact"
        WHERE "clientId" = ${clientId}
          AND (
            phone = ${From}
            OR phone = ${normalisedFrom}
            OR REPLACE(REPLACE(phone, ' ', ''), '+', '') = ${normalisedFrom.replace('+', '')}
          )
        LIMIT 1
      `.catch(() => [])
      replyContactId = rows[0]?.id || null
    }
    const n8nBase = process.env.N8N_BASE_URL || 'http://localhost:5678'
    fetch(`${n8nBase}/webhook/appt-reply-${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: replyContactId || '', from: From, message: Body })
    }).catch(err => logger.warn('Failed to forward SMS to appt-reply webhook', { clientId, err: String(err) }))

    // Respond to Twilio with empty TwiML
    res.setHeader('Content-Type', 'text/xml')
    res.status(200).send('<Response/>')
  } catch (err) {
    logger.error('SMS webhook error', { err })
    res.setHeader('Content-Type', 'text/xml')
    res.status(200).send('<Response/>')
  }
}
