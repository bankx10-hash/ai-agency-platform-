import express from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { randomUUID } from 'crypto'
import twilio from 'twilio'
import { emailService } from '../services/email.service'
import { calendarService } from '../services/calendar.service'
import { encryptJSON, decryptJSON } from '../utils/encrypt'
import { appendPostRows } from '../services/sheets.service'
import { logger } from '../utils/logger'
import axios from 'axios'

const router = express.Router()

// Parse JSON bodies regardless of Content-Type (N8N sends empty content-type)
router.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (req.body !== undefined && req.body !== null && Object.keys(req.body).length > 0) {
    return next() // already parsed by global middleware
  }
  let raw = ''
  req.on('data', (chunk: Buffer) => { raw += chunk.toString() })
  req.on('end', () => {
    if (raw) {
      try { req.body = JSON.parse(raw) } catch { req.body = raw }
    }
    next()
  })
  req.on('error', () => next())
})

function n8nAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = req.headers['x-api-secret']
  if (!process.env.N8N_API_SECRET || secret !== process.env.N8N_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

router.use(n8nAuth)

async function getClientCrmType(clientId: string): Promise<string> {
  try {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { crmType: true } })
    return client?.crmType || 'internal'
  } catch {
    return 'internal'
  }
}

async function getCrmCredentials<T>(clientId: string, service: string): Promise<T | null> {
  try {
    const cred = await prisma.clientCredential.findFirst({ where: { clientId, service } })
    if (!cred) return null
    return decryptJSON<T>(cred.credentials)
  } catch {
    return null
  }
}

// ── HubSpot helpers ──────────────────────────────────────────────────────────

async function refreshHubSpotToken(clientId: string, refreshToken: string): Promise<string> {
  const res = await axios.post(
    'https://api.hubapi.com/oauth/v1/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.HUBSPOT_CLIENT_ID || '',
      client_secret: process.env.HUBSPOT_CLIENT_SECRET || '',
      refresh_token: refreshToken
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  const { access_token, refresh_token } = res.data
  // Save updated tokens back to DB
  const cred = await prisma.clientCredential.findFirst({ where: { clientId, service: 'hubspot' } })
  if (cred) {
    await prisma.clientCredential.update({
      where: { id: cred.id },
      data: { credentials: encryptJSON({ accessToken: access_token, refreshToken: refresh_token }) }
    })
  }
  logger.info('HubSpot token refreshed', { clientId })
  return access_token as string
}

async function getHubSpotToken(clientId: string): Promise<string | null> {
  const creds = await getCrmCredentials<{ accessToken: string; refreshToken: string }>(clientId, 'hubspot')
  if (!creds?.accessToken) return null
  if (!creds.refreshToken) return creds.accessToken
  // Always refresh — HubSpot tokens expire in 30 min, refresh tokens last 6 months
  try {
    return await refreshHubSpotToken(clientId, creds.refreshToken)
  } catch {
    // Refresh failed — try the existing access token as fallback
    return creds.accessToken
  }
}

async function hubspotCreateContact(
  accessToken: string,
  data: { name: string; phone: string; email: string; source: string }
): Promise<string> {
  const [firstname, ...rest] = (data.name || 'Unknown').split(' ')
  const lastname = rest.join(' ') || ''
  try {
    const res = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      {
        properties: {
          firstname,
          lastname,
          ...(data.email && { email: data.email }),
          ...(data.phone && { phone: data.phone }),
          hs_lead_status: 'NEW'
        }
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    )
    return String(res.data.id)
  } catch (err) {
    // 409 = contact already exists — extract the existing ID and return it
    const hsErr = (err as { response?: { status?: number; data?: { message?: string } } })?.response
    if (hsErr?.status === 409 && hsErr?.data?.message) {
      const match = hsErr.data.message.match(/Existing ID:\s*(\d+)/)
      if (match) return match[1]
    }
    throw err
  }
}

async function hubspotAddNote(accessToken: string, contactId: string, body: string): Promise<void> {
  const noteRes = await axios.post(
    'https://api.hubapi.com/crm/v3/objects/notes',
    {
      properties: {
        hs_note_body: body,
        hs_timestamp: String(Date.now())
      }
    },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  )
  const noteId = noteRes.data.id
  await axios.put(
    `https://api.hubapi.com/crm/v3/objects/notes/${noteId}/associations/contacts/${contactId}/202`,
    {},
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
}

async function updateAgentMetrics(
  clientId: string,
  agentType: string,
  update: Record<string, unknown>
): Promise<void> {
  const agent = await prisma.agentDeployment.findFirst({
    where: { clientId, agentType: agentType as never }
  })
  if (!agent) return
  const current = (agent.metrics as Record<string, unknown>) || {}
  await prisma.agentDeployment.update({
    where: { id: agent.id },
    data: { metrics: { ...current, ...update, lastUpdated: new Date().toISOString() } }
  })
}

// Increments named counters, with automatic daily reset for "today" counters.
// dailyKeys: counter names that reset to 0 each calendar day (e.g. leadsToday)
// totalKeys: cumulative counters that never reset (e.g. totalLeads)
async function incrementAgentMetrics(
  clientId: string,
  agentType: string,
  daily: Record<string, number>,
  total: Record<string, number> = {},
  snapshot: Record<string, unknown> = {}
): Promise<void> {
  const agent = await prisma.agentDeployment.findFirst({
    where: { clientId, agentType: agentType as never }
  })
  if (!agent) return
  const today = new Date().toISOString().slice(0, 10)
  const current = (agent.metrics as Record<string, unknown>) || {}
  const isNewDay = (current.lastResetDate as string) !== today

  const updated = { ...current }
  // Reset daily counters on new day — but first snapshot yesterday's values into history
  if (isNewDay && current.lastResetDate) {
    const history = (current.dailyHistory as Array<Record<string, unknown>>) || []
    const yesterdaySnapshot: Record<string, unknown> = { date: current.lastResetDate }
    for (const key of Object.keys(daily)) yesterdaySnapshot[key] = (current[key] as number) || 0
    for (const key of Object.keys(total)) yesterdaySnapshot[key] = (current[key] as number) || 0
    history.unshift(yesterdaySnapshot)
    // Keep last 90 days only
    updated.dailyHistory = history.slice(0, 90)
    for (const key of Object.keys(daily)) updated[key] = 0
    updated.lastResetDate = today
  } else if (!current.lastResetDate) {
    updated.lastResetDate = today
  }
  // Increment daily counters
  for (const [key, delta] of Object.entries(daily)) {
    updated[key] = ((updated[key] as number) || 0) + delta
  }
  // Increment total counters
  for (const [key, delta] of Object.entries(total)) {
    updated[key] = ((current[key] as number) || 0) + delta
  }
  Object.assign(updated, snapshot, { lastUpdated: new Date().toISOString() })
  await prisma.agentDeployment.update({
    where: { id: agent.id },
    data: { metrics: updated as Prisma.InputJsonValue }
  })
}

// GET /:clientId/contacts
router.get('/:clientId/contacts', async (req, res) => {
  const { clientId } = req.params
  const { stage, limit } = req.query
  try {
    const crmType = await getClientCrmType(clientId)
    const take = Math.min(parseInt(String(limit || '50'), 10) || 50, 200)
    const stageFilter = String(stage || 'new')

    const contacts = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id", "clientId", "name", "email", "phone", "source", "stage",
             "score", "tags", "summary", "nextAction", "crmId", "createdAt"
      FROM "Contact"
      WHERE "clientId" = ${clientId}
        AND "stage" = ${stageFilter}
      ORDER BY "createdAt" DESC
      LIMIT ${take}
    `

    logger.info('N8N contacts fetch', { clientId, crmType, stage: stageFilter, count: contacts.length })
    res.json({ contacts, total: contacts.length, crmType })
  } catch (err) {
    logger.error('N8N contacts fetch error', { clientId, err })
    res.status(500).json({ error: 'Failed to fetch contacts' })
  }
})

// GET /:clientId/contacts/:contactId
router.get('/:clientId/contacts/:contactId', async (req, res) => {
  const { clientId, contactId } = req.params
  try {
    const crmType = await getClientCrmType(clientId)
    logger.info('N8N contact fetch', { clientId, contactId, crmType })

    // Always check internal DB first
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id", "name", "email", "phone", "source", "stage", "score", "crmId"
      FROM "Contact"
      WHERE "id" = ${contactId} AND "clientId" = ${clientId}
      LIMIT 1
    `
    if (rows.length > 0) {
      const c = rows[0]
      res.json({ contact: { id: c.id, name: c.name, email: c.email, phone: c.phone, stage: c.stage, score: c.score, crmId: c.crmId }, crmType })
      return
    }

    // Fallback: try HubSpot if contactId looks like a HubSpot numeric ID
    if (crmType === 'hubspot') {
      const token = await getHubSpotToken(clientId)
      if (token) {
        const hsRes = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const p = hsRes.data.properties || {}
        res.json({
          contact: {
            id: contactId,
            name: [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Unknown',
            email: p.email || '',
            phone: p.phone || ''
          },
          crmType
        })
        return
      }
    }

    res.json({ contact: { id: contactId }, crmType })
  } catch (err) {
    logger.error('N8N contact fetch error', { clientId, contactId, err })
    res.status(500).json({ error: 'Failed to fetch contact' })
  }
})

// GET /:clientId/contacts/by-linkedin — look up contact by LinkedIn profile URL
router.get('/:clientId/contacts/by-linkedin', async (req, res) => {
  const { clientId } = req.params
  const { url } = req.query
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url query param required' })
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null; email: string | null }>>`
      SELECT "id", "name", "email" FROM "Contact"
      WHERE "clientId" = ${clientId} AND "linkedinUrl" = ${url}
      LIMIT 1
    `
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' })
    }
    return res.json({ id: rows[0].id, name: rows[0].name, email: rows[0].email })
  } catch (err) {
    logger.error('N8N by-linkedin lookup error', { clientId, url, err })
    return res.status(500).json({ error: 'Lookup failed' })
  }
})

// POST /:clientId/contacts
router.post('/:clientId/contacts', async (req, res) => {
  const { clientId } = req.params
  const { name, email, phone, source, tags = [], intent, linkedinUrl } = req.body
  try {
    const crmType = await getClientCrmType(clientId)
    logger.info('N8N contact save', { clientId, crmType, name })

    // Upsert to internal DB — deduplicates by email within the same client
    const newId = randomUUID()
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [])
    const rows = await prisma.$queryRaw<Array<{ id: string; is_new: boolean }>>`
      INSERT INTO "Contact" ("id", "clientId", "name", "email", "phone", "source", "tags", "stage", "pipelineStage", "updatedAt")
      VALUES (${newId}, ${clientId}, ${name || null}, ${email || null}, ${phone || null},
              ${source || null}, ${tagsJson}::jsonb, 'new', 'NEW_LEAD', NOW())
      ON CONFLICT ("clientId", "email") WHERE "email" IS NOT NULL
      DO UPDATE SET
        "name"      = COALESCE(EXCLUDED."name", "Contact"."name"),
        "phone"     = COALESCE(EXCLUDED."phone", "Contact"."phone"),
        "updatedAt" = NOW()
      RETURNING "id", (xmax = 0) AS is_new
    `
    const id = rows[0]?.id || newId
    const isNew = rows[0]?.is_new !== false
    logger.info('Contact upserted to DB', { clientId, id, isNew })

    // Save/update linkedinUrl if provided
    if (linkedinUrl) {
      await prisma.$executeRaw`
        UPDATE "Contact" SET "linkedinUrl" = ${linkedinUrl} WHERE "id" = ${id}
      `.catch(() => {})
    }

    // Log CRM activity for new contacts
    if (isNew) {
      await prisma.contactActivity.create({
        data: {
          id: randomUUID(), contactId: id, clientId,
          type: 'NOTE' as never,
          title: `New lead captured${source ? ` from ${source}` : ''}`,
          metadata: { source, intent } as never,
          agentType: 'LEAD_GENERATION'
        }
      }).catch(() => {})

      // Notify client of new lead
      const notifTitle = `New lead: ${name || email || 'Unknown'}`
      const notifBody = source ? `Captured from ${source}` : 'Lead captured by AI agent'
      await prisma.$executeRaw`
        INSERT INTO "Notification" ("id", "clientId", "type", "title", "body", "link", "createdAt")
        VALUES (${randomUUID()}, ${clientId}, 'NEW_LEAD', ${notifTitle}, ${notifBody}, ${`/dashboard/crm/contacts/${id}`}, NOW())
      `.catch(() => {})
    }

    // Sync to HubSpot if connected
    let crmId: string | undefined
    if (crmType === 'hubspot') {
      const token = await getHubSpotToken(clientId)
      if (token) {
        try {
          crmId = await hubspotCreateContact(token, { name: name || '', email: email || '', phone: phone || '', source: source || '' })
          await prisma.$executeRaw`UPDATE "Contact" SET "crmId" = ${crmId} WHERE "id" = ${id}`
          logger.info('HubSpot contact created', { clientId, crmId })
        } catch (hsErr) {
          logger.warn('HubSpot sync failed, contact still saved locally', { clientId, hsErr })
        }
      }
    }

    await updateAgentMetrics(clientId, 'VOICE_INBOUND', {
      lastContactSaved: { name, source, id, crmId },
      lastContactAt: new Date().toISOString()
    })
    res.json({ success: true, id, crmId, crmType })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logger.error('N8N contact save error', { clientId, err: detail })
    res.status(500).json({ error: 'Failed to save contact', detail })
  }
})

// PATCH /:clientId/contacts/score
router.patch('/:clientId/contacts/score', async (req, res) => {
  const { clientId } = req.params
  const { contactId, score, tags, summary, nextAction } = req.body
  try {
    const crmType = await getClientCrmType(clientId)
    logger.info('N8N lead score update', { clientId, contactId, score })

    const stage = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold'
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [])

    // Update in internal DB
    await prisma.$executeRaw`
      UPDATE "Contact"
      SET "score" = ${score}, "stage" = ${stage}, "tags" = ${tagsJson}::jsonb,
          "summary" = ${summary || null}, "nextAction" = ${nextAction || null}, "updatedAt" = NOW()
      WHERE "id" = ${contactId} AND "clientId" = ${clientId}
    `

    // Push score to HubSpot if connected
    if (crmType === 'hubspot') {
      const token = await getHubSpotToken(clientId)
      if (token) {
        const rows = await prisma.$queryRaw<Array<{ crmId: string | null }>>`
          SELECT "crmId" FROM "Contact" WHERE "id" = ${contactId} AND "clientId" = ${clientId}
        `
        const crmId = rows[0]?.crmId
        if (crmId) {
          const hsStatus = score >= 70 ? 'IN_PROGRESS' : score >= 40 ? 'OPEN' : 'UNQUALIFIED'
          await axios.patch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${crmId}`,
            { properties: { hs_lead_status: hsStatus } },
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
          ).catch(e => logger.warn('HubSpot score update failed', { clientId, e: String(e) }))
        }
      }
    }

    await incrementAgentMetrics(
      clientId, 'LEAD_GENERATION',
      { leadsToday: 1 },
      { totalLeads: 1 },
      { lastScoredContact: { contactId, score, stage, tags, summary, nextAction }, lastScoredAt: new Date().toISOString() }
    )
    // CRM activity: log score update
    if (contactId) {
      await prisma.contactActivity.create({
        data: { id: randomUUID(), contactId, clientId, type: 'SCORE_CHANGE' as never, title: `Lead score updated to ${score}`, body: summary || undefined, metadata: { score, stage, nextAction } as never, agentType: 'LEAD_GENERATION' }
      }).catch(() => {})
    }
    res.json({ success: true, contactId, score, stage })
  } catch (err) {
    logger.error('N8N score update error', { clientId, err })
    res.status(500).json({ error: 'Failed to update score' })
  }
})

// POST /:clientId/contacts/:contactId/notes
router.post('/:clientId/contacts/:contactId/notes', async (req, res) => {
  const { clientId, contactId } = req.params
  const { body } = req.body
  try {
    const crmType = await getClientCrmType(clientId)
    logger.info('N8N contact note', { clientId, contactId, crmType })

    // Save note to internal DB
    const noteId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "ContactNote" ("id", "contactId", "body", "createdAt")
      VALUES (${noteId}, ${contactId}, ${body || ''}, NOW())
    `

    // Sync to HubSpot using the stored crmId (not the internal UUID)
    if (crmType === 'hubspot') {
      const token = await getHubSpotToken(clientId)
      if (token) {
        const rows = await prisma.$queryRaw<Array<{ crmId: string | null }>>`
          SELECT "crmId" FROM "Contact" WHERE "id" = ${contactId} AND "clientId" = ${clientId}
        `
        const crmId = rows[0]?.crmId
        if (crmId) {
          await hubspotAddNote(token, crmId, body)
          logger.info('HubSpot note added', { clientId, crmId })
        }
      }
    }

    await incrementAgentMetrics(
      clientId, 'VOICE_INBOUND',
      {},
      { callsAnswered: 1 },
      { lastNote: { contactId, addedAt: new Date().toISOString() } }
    )
    res.json({ success: true })
  } catch (err) {
    logger.error('N8N note error', { clientId, err })
    res.status(500).json({ error: 'Failed to add note' })
  }
})

// POST /:clientId/messages (SMS via Twilio)
router.post('/:clientId/messages', async (req, res) => {
  const { clientId } = req.params
  const { contactId, type, message, to } = req.body
  try {
    if (!to || !message) {
      return res.status(400).json({ error: 'Missing required fields: to, message' })
    }

    // Look up the client's provisioned Twilio phone number
    const cred = await prisma.clientCredential.findUnique({
      where: { id: `twilio-phone-${clientId}` }
    })
    if (!cred) {
      logger.warn('No Twilio phone number found for client — SMS not sent', { clientId })
      return res.status(422).json({ error: 'No phone number provisioned for this client' })
    }
    const { phoneNumber: fromNumber } = decryptJSON(cred.credentials) as { phoneNumber: string }

    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    const sms = await twilioClient.messages.create({
      from: fromNumber,
      to,
      body: message
    })
    logger.info('SMS sent via Twilio', { clientId, contactId, to, sid: sms.sid })

    await updateAgentMetrics(clientId, 'APPOINTMENT_SETTER', {
      lastMessageSent: { contactId, type, to, sentAt: new Date().toISOString() }
    })
    res.json({ success: true, sid: sms.sid })
  } catch (err) {
    logger.error('N8N SMS error', { clientId, err })
    res.status(500).json({ error: 'Failed to send SMS' })
  }
})

// POST /:clientId/messages/email
router.post('/:clientId/messages/email', async (req, res) => {
  const { clientId } = req.params
  const { to, subject, body: emailBody, contactId } = req.body
  try {
    if (to && subject && emailBody) {
      await emailService.sendSystemEmail(to, subject, emailBody)
      logger.info('N8N email sent', { clientId, to, subject })
    }
    await updateAgentMetrics(clientId, 'APPOINTMENT_SETTER', {
      lastEmailSent: { contactId, to, subject, sentAt: new Date().toISOString() }
    })
    // CRM activity: log email
    if (contactId) {
      await prisma.contactActivity.create({
        data: { id: randomUUID(), contactId, clientId, type: 'EMAIL' as never, title: subject || 'Email sent', body: `To: ${to}`, metadata: { to, subject } as never, agentType: 'APPOINTMENT_SETTER' }
      }).catch(() => {})
    }
    res.json({ success: true })
  } catch (err) {
    logger.error('N8N email error', { clientId, err })
    res.status(500).json({ error: 'Failed to send email' })
  }
})

// GET /:clientId/calendar-slots
router.get('/:clientId/calendar-slots', async (req, res) => {
  const { clientId } = req.params
  try {
    const { provider, slots } = await calendarService.getAvailableSlots(clientId)
    logger.info('N8N calendar slots returned', { clientId, provider, count: slots.length })
    res.json({ slots: slots.map(s => s.start), provider, fullSlots: slots })
  } catch (err) {
    logger.error('N8N calendar slots error', { clientId, err })
    res.status(500).json({ error: 'Failed to get calendar slots' })
  }
})

// POST /:clientId/appointments
router.post('/:clientId/appointments', async (req, res) => {
  const { clientId } = req.params
  const { contactId, calendarId, startTime, title, contactName, contactEmail } = req.body
  try {
    logger.info('N8N appointment booking', { clientId, contactId, startTime, contactName, contactEmail })

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { businessName: true } })
    const businessName = client?.businessName || 'our business'

    // Book on real calendar (Google Calendar / Calendly / Cal.com)
    let bookingResult: { success: boolean; booked: boolean; confirmationMessage: string; eventLink?: string } | undefined
    if (startTime && contactName && contactEmail) {
      bookingResult = await calendarService.bookAppointment(
        clientId,
        startTime,
        { name: contactName, email: contactEmail },
        businessName
      )
      logger.info('Calendar booking result', { clientId, booked: bookingResult.booked, message: bookingResult.confirmationMessage })
    }

    // Update agent metrics
    const agent = await prisma.agentDeployment.findFirst({ where: { clientId, agentType: 'APPOINTMENT_SETTER' as never } })
    const current = (agent?.metrics as Record<string, unknown>) || {}
    const existing = (current.appointments as unknown[]) || []
    const newAppt = { id: `appt-${Date.now()}`, contactId, contactName, contactEmail, calendarId, startTime, title, bookedAt: new Date().toISOString(), calendarBooked: bookingResult?.booked || false }
    const appointments = [newAppt, ...existing].slice(0, 500)
    await incrementAgentMetrics(
      clientId, 'APPOINTMENT_SETTER',
      { appointmentsToday: 1 },
      { appointmentsBooked: 1, totalLeads: 1 },
      { appointments, lastAppointment: newAppt }
    )

    // CRM activity: log appointment
    if (contactId) {
      await prisma.contactActivity.create({
        data: { id: randomUUID(), contactId, clientId, type: 'APPOINTMENT' as never, title: `Appointment booked: ${title || 'Meeting'}`, body: startTime, metadata: { calendarId, startTime, title, calendarBooked: bookingResult?.booked } as never, agentType: 'APPOINTMENT_SETTER' }
      }).catch(() => {})
      await prisma.contact.updateMany({ where: { id: contactId, clientId }, data: { lastContactedAt: new Date(), pipelineStage: 'QUALIFIED' as never } }).catch(() => {})
    }

    res.json({ success: true, appointmentId: newAppt.id, startTime, contactId, calendarBooked: bookingResult?.booked || false, eventLink: bookingResult?.eventLink })
  } catch (err) {
    logger.error('N8N appointment error', { clientId, err })
    res.status(500).json({ error: 'Failed to book appointment' })
  }
})

// POST /:clientId/linkedin-lead — LinkedIn outreach reply captured as a lead
router.post('/:clientId/linkedin-lead', async (req, res) => {
  const { clientId } = req.params
  const { name, email, phone, linkedinUrl, message } = req.body as {
    name?: string; email?: string; phone?: string; linkedinUrl?: string; message?: string
  }
  try {
    if (!name && !email && !linkedinUrl) {
      return res.status(400).json({ error: 'At least name, email, or linkedinUrl required' })
    }
    const { forwardToLeadGen } = await import('./meta-webhooks')
    await forwardToLeadGen(clientId, {
      name: name || '',
      email: email || '',
      phone: phone || '',
      source: 'linkedin-reply'
    })
    logger.info('LinkedIn reply forwarded to lead-gen', { clientId, name, linkedinUrl })
    res.json({ success: true })
  } catch (err) {
    logger.error('LinkedIn lead capture error', { clientId, err })
    res.status(500).json({ error: 'Failed to capture LinkedIn lead' })
  }
})

// POST /:clientId/call-outcomes
router.post('/:clientId/call-outcomes', async (req, res) => {
  const { clientId } = req.params
  const { contactId, outcome, nextAction } = req.body
  try {
    logger.info('N8N call outcome saved', { clientId, contactId, outcome })
    await incrementAgentMetrics(
      clientId, 'VOICE_OUTBOUND',
      {},
      { callsMade: 1 },
      { lastCallOutcome: { contactId, outcome, nextAction, recordedAt: new Date().toISOString() } }
    )
    // CRM activity: log call
    if (contactId) {
      await prisma.contactActivity.create({
        data: { id: randomUUID(), contactId, clientId, type: 'CALL' as never, title: `Call outcome: ${outcome}`, body: nextAction || undefined, metadata: { outcome, nextAction } as never, agentType: 'VOICE_OUTBOUND' }
      }).catch(() => {})
      await prisma.contact.updateMany({ where: { id: contactId, clientId }, data: { lastContactedAt: new Date() } }).catch(() => {})
    }
    res.json({ success: true })
  } catch (err) {
    logger.error('N8N call outcome error', { clientId, err })
    res.status(500).json({ error: 'Failed to save call outcome' })
  }
})

// POST /:clientId/deal-outcomes
router.post('/:clientId/deal-outcomes', async (req, res) => {
  const { clientId } = req.params
  const { contactId, opportunityId, outcome, reason } = req.body
  try {
    logger.info('N8N deal outcome saved', { clientId, outcome, opportunityId })
    await incrementAgentMetrics(
      clientId, 'VOICE_CLOSER',
      {},
      { dealsClosed: outcome === 'closed' ? 1 : 0, callsMade: 1 },
      { lastDealOutcome: { contactId, opportunityId, outcome, reason, recordedAt: new Date().toISOString() } }
    )
    // CRM activity + pipeline stage update
    if (contactId) {
      const newStage = outcome === 'closed' ? 'CLOSED_WON' : outcome === 'lost' ? 'CLOSED_LOST' : undefined
      await prisma.contactActivity.create({
        data: { id: randomUUID(), contactId, clientId, type: 'CALL' as never, title: `Deal ${outcome}: ${reason || ''}`, metadata: { outcome, reason, opportunityId } as never, agentType: 'VOICE_CLOSER' }
      }).catch(() => {})
      if (newStage) {
        await prisma.contact.updateMany({ where: { id: contactId, clientId }, data: { pipelineStage: newStage as never, lastContactedAt: new Date() } }).catch(() => {})
      }
    }
    res.json({ success: true })
  } catch (err) {
    logger.error('N8N deal outcome error', { clientId, err })
    res.status(500).json({ error: 'Failed to save deal outcome' })
  }
})

// POST /:clientId/alerts
router.post('/:clientId/alerts', async (req, res) => {
  const { clientId } = req.params
  const { subject, body: alertBody } = req.body
  try {
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (client && subject) {
      await emailService.sendSystemEmail(
        client.email,
        subject,
        alertBody || subject
      )
      logger.info('N8N alert sent', { clientId, subject })
    }
    res.json({ success: true })
  } catch (err) {
    logger.error('N8N alert error', { clientId, err })
    res.status(500).json({ error: 'Failed to send alert' })
  }
})

// POST /:clientId/social/generate-content
// Calls Claude to generate today's social media posts using the stored content calendar.
// Returns { facebook: {content, hashtags, image_prompt}, instagram: {...}, linkedin: {...} }
router.post('/:clientId/social/generate-content', async (req, res) => {
  const { clientId } = req.params
  const { platforms = 'facebook,instagram,linkedin', topic } = req.body as { platforms?: string; topic?: string }

  try {
    // Load stored agent config (content calendar is in agentPrompt / config)
    const agent = await prisma.agentDeployment.findFirst({
      where: { clientId, agentType: 'SOCIAL_MEDIA' as never }
    })
    if (!agent) return res.status(404).json({ error: 'Social media agent not deployed' })

    const config = agent.config as Record<string, unknown>
    const contentCalendar = (config.generatedContentCalendar as string) || ''
    const businessName = (config.businessName as string) || 'the business'
    const platformList = platforms.split(',').map(p => p.trim()).filter(Boolean)

    const businessDescription = (config.business_description as string) || ''
    const tone = (config.tone as string) || 'authentic, direct, and value-driven'
    const contentPillars = (config.content_pillars as string[]) || ['education', 'social proof', 'behind the scenes', 'entertainment', 'offer']

    const PLATFORM_RULES: Record<string, string> = {
      instagram: `INSTAGRAM: Line 1 = gut-punch fear hook (shocking stat, brutal truth, or bold claim) — only line visible before "more", must create unbearable curiosity. 3-5 short punchy paragraphs. Structure: hook→painful problem→brutal truth→proof→URGENT CTA with scarcity ("We only take 3 clients/month — DM 'AI' NOW"). 20-25 hashtags at end. Emojis as visual bullets only.`,
      facebook: `FACEBOOK: Line 1 = fear/panic trigger for business owners ("Your competitors are automating while you're still doing this manually."). 100-200 words. "This is for you if..." identity framing. Make them feel the cost of every week they wait. End with fear-based self-reflection question + urgent scarcity CTA. One CTA max.`,
      linkedin: `LINKEDIN: Line 1 = shocking stat or brutal contrarian take that makes business owners question everything. Structure: shocking hook→painful reality→what winners do→what losers do→urgent takeaway. 1-2 sentence paragraphs. 150-300 words. Create FOMO with specific ROI/revenue numbers. End with painful self-reflection question + direct CTA with scarcity. 3-5 hashtags at end. Never use "Excited to share".`
    }

    const platformRules = platformList
      .map(p => PLATFORM_RULES[p] || '')
      .filter(Boolean)
      .join('\n\n')

    const systemPrompt = `You are an elite social media content strategist and direct-response copywriter for ${businessName}.
Your ONLY job is to create content that stops the scroll, triggers fear of missing out, and makes the target audience feel they MUST reach out TODAY or risk falling irreparably behind their competitors. Tailor the language to the specific industry — speak directly to dentists, tradies, doctors, agents, agency owners, or whoever the business serves. Never assume the audience is only office professionals.

BUSINESS: ${businessDescription}
BRAND TONE: ${tone}
CONTENT PILLARS TO ROTATE: ${contentPillars.join(', ')}

PLATFORM RULES:
${platformRules}

MANDATORY PRINCIPLES — every single post must have ALL of these:
1. FEAR OF INACTION: Make the reader viscerally feel what they're losing every day they don't have this service. Lost leads, lost revenue, competitors winning their customers.
2. COMPETITOR THREAT: Position their competitors as already moving. "While you're reading this, your competitor is automating their follow-ups." Create paranoia.
3. SPECIFICITY OVER VAGUENESS: Use real-sounding numbers. "47 leads followed up in 3 minutes" beats "fast follow-up". "$12K in recovered revenue" beats "more sales".
4. SCARCITY & URGENCY: Every post must include a reason to act NOW. Limited client spots, closing window of competitive advantage, price going up, early mover advantage disappearing.
5. SCROLL-STOPPING HOOK: The first line is 80% of the work. If it doesn't trigger fear, curiosity, or shock — rewrite it.
6. DIRECT CTA WITH CONSEQUENCE: Never just "DM us". Instead: "DM 'AI' now — we take 3 new clients per month and spots are filling." Make inaction feel costly.
7. Write like a human who genuinely cares that this person is losing — not a brand. Use "I" or "we", be direct, be urgent.${contentCalendar ? `\n\nCONTENT CALENDAR CONTEXT (draw topics and pillars from this):\n${contentCalendar.substring(0, 3000)}` : ''}`

    const userMessage = topic
      ? `Create social media posts about: "${topic}"`
      : `Create today's social media posts for ${businessName}`

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `${userMessage}.\n\nPlatforms: ${platformList.join(', ')}.\n\nReturn a single JSON object with keys for each platform. Each value must be an object with:\n- content: the full post text ready to copy-paste\n- hashtags: array of hashtag strings (with # prefix)\n- image_prompt: A prompt for AI image generation that pairs with this post.\n\nIMAGE PROMPT RULES (STRICT — follow every single one):\n1. ABSOLUTELY NO TEXT, WORDS, LETTERS, NUMBERS, OR WRITING of any kind in the image. Never include text overlays, captions, titles, quotes, watermarks, logos with text, or any written characters. This is the #1 rule.\n2. MATCH THE INDUSTRY: The image MUST reflect the client's actual business. Read the business description and show the RIGHT profession: dentist → dental clinic with a dentist and patient; tradie/plumber/electrician → worker on a job site with tools; real estate agent → agent at a property showing; doctor → medical professional in a practice; agency → team in a creative workspace; mechanic → workshop setting; lawyer → office consultation; restaurant → chef in kitchen or front-of-house. NEVER default to generic office workers unless the business is actually an office-based business.\n3. THE PERSON IS THE HERO: Every image must feature real people in their actual work environment as the clear focal point. Confident, skilled, and in control.\n4. Style: hyper-realistic cinematic scene captured through a high-end DSLR. Premium editorial aesthetic.\n5. Lighting: dark, moody lighting with soft shadows and cool undertones. Dramatic contrast. Carefully placed light sources creating depth.\n6. Composition: depth-of-field bokeh, crisp lens reflections, dramatic contrast. Shallow DOF to isolate subjects.\n7. Color palette: cool undertones — deep blues, charcoal grays, subtle steel tones. Desaturated with occasional warm accent from practical light sources.\n8. Settings: the REAL work environment for that industry — dental chairs, construction sites, shop floors, kitchens, clinics, showrooms, workshops, salons, gyms, farms, warehouses. NOT always glass offices.\n9. NEVER: text overlays, infographics, charts, diagrams, illustrations, cartoons, AI-looking renders, stock photo watermarks, collages, split screens, empty rooms without people, bright/airy aesthetics.\n\nOnly include the platforms listed. Return valid JSON only, no markdown code blocks.`
      }]
    })

    const raw = (message.content[0] as { text: string }).text
    let content: Record<string, unknown>
    try {
      content = JSON.parse(raw.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim())
    } catch {
      return res.status(500).json({ error: 'Claude returned invalid JSON', raw })
    }

    logger.info('Social media content generated via API', { clientId, platforms: platformList })
    res.json({ content, generatedAt: new Date().toISOString() })
  } catch (err) {
    logger.error('Social content generation failed', { clientId, err })
    res.status(500).json({ error: 'Content generation failed' })
  }
})

// POST /:clientId/social/generate-images
// Generates one image per platform using the image_prompt Claude included in the content.
// Returns 500 if any image fails — N8N will stop the workflow rather than posting without an image.
router.post('/:clientId/social/generate-images', async (req, res) => {
  const { clientId } = req.params
  const { content } = req.body as { content: Record<string, { content: string; image_prompt?: string }> }

  try {
    const images: Record<string, string> = {}

    for (const [platform, platformContent] of Object.entries(content)) {
      const prompt = platformContent.image_prompt
      if (!prompt) {
        logger.error('No image_prompt for platform — aborting', { clientId, platform })
        return res.status(500).json({ error: `No image_prompt for platform: ${platform}` })
      }

      // Fal AI — flux/dev model, aspect ratio based on platform
      const aspectRatio = platform === 'instagram' ? '1:1' : '16:9'
      // Append style reinforcement — dark cinematic editorial, people-focused, no text
      const styleGuide = ', hyper-realistic cinematic DSLR photography, professionals in smart business attire as main subject, dark moody lighting with soft shadows and cool undertones, dramatic contrast, depth-of-field bokeh, crisp lens reflections, slightly darker tone, premium editorial aesthetic, modern sleek workplace, shot on 85mm f/1.4 lens, NO TEXT, NO WORDS, NO LETTERS, NO WRITING, NO LOGOS, NO WATERMARKS, NO OVERLAYS, no illustrations, no cartoons, no bright airy aesthetics'
      const styledPrompt = (prompt.substring(0, 800) + styleGuide).substring(0, 1000)
      const response = await axios.post(
        'https://fal.run/fal-ai/flux/dev',
        {
          prompt: styledPrompt,
          image_size: aspectRatio === '1:1' ? 'square_hd' : 'landscape_16_9',
          num_images: 1,
          enable_safety_checker: true
        },
        {
          headers: {
            Authorization: `Key ${process.env.FAL_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      )
      images[platform] = response.data.images[0].url
      logger.info('Image generated for social post via Fal AI', { clientId, platform })
    }

    res.json({ images })
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? `${err.response?.status} ${JSON.stringify(err.response?.data)}`
      : String(err)
    logger.error('Social image generation failed — aborting workflow', { clientId, err: detail })
    res.status(500).json({ error: 'Image generation failed', detail })
  }
})

// POST /:clientId/social/post-all
router.post('/:clientId/social/post-all', async (req, res) => {
  const { clientId } = req.params
  const { content, images, metadata, generatedAt } = req.body as {
    content: Record<string, string>
    images?: Record<string, string>
    metadata?: Record<string, { hashtags?: string[]; image_prompt?: string }>
    generatedAt: string
  }

  async function postToPlatform(
    platform: string,
    text: string,
    credentials: Record<string, string>,
    imageUrl: string
  ): Promise<{ success: boolean; postId?: string; error?: string }> {
    try {
      if (platform === 'facebook') {
        const response = await fetch(
          `https://graph.facebook.com/v19.0/${credentials.pageId}/photos`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: imageUrl, caption: text, access_token: credentials.accessToken })
          }
        )
        const data = await response.json() as Record<string, unknown>
        if (!response.ok) return { success: false, error: JSON.stringify(data) }
        return { success: true, postId: data.id as string }
      }

      if (platform === 'instagram') {
        // Step 1: create media container
        const createRes = await fetch(
          `https://graph.facebook.com/v19.0/${credentials.igUserId}/media`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caption: text, media_type: 'IMAGE', image_url: imageUrl, access_token: credentials.accessToken })
          }
        )
        const createData = await createRes.json() as Record<string, unknown>
        if (!createRes.ok || !createData.id) return { success: false, error: JSON.stringify(createData) }

        // Step 2: poll until media container is FINISHED (avoids "not ready" error)
        const containerId = createData.id as string
        let ready = false
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise(r => setTimeout(r, 3000))
          const statusRes = await fetch(
            `https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${credentials.accessToken}`
          )
          const statusData = await statusRes.json() as Record<string, unknown>
          if (statusData.status_code === 'FINISHED') { ready = true; break }
          if (statusData.status_code === 'ERROR') return { success: false, error: `Instagram media processing failed: ${JSON.stringify(statusData)}` }
        }
        if (!ready) return { success: false, error: 'Instagram media container timed out (30s)' }

        // Step 3: publish
        const publishRes = await fetch(
          `https://graph.facebook.com/v19.0/${credentials.igUserId}/media_publish`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: containerId, access_token: credentials.accessToken })
          }
        )
        const publishData = await publishRes.json() as Record<string, unknown>
        if (!publishRes.ok) return { success: false, error: JSON.stringify(publishData) }
        return { success: true, postId: publishData.id as string }
      }

      if (platform === 'linkedin') {
        const author = credentials.organizationId
          ? `urn:li:organization:${credentials.organizationId}`
          : `urn:li:person:${credentials.personId}`
        const liHeaders = {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202504'
        }

        // Step 1: initialize image upload (newer REST API — works with w_member_social)
        const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
          method: 'POST',
          headers: liHeaders,
          body: JSON.stringify({ initializeUploadRequest: { owner: author } })
        })
        const initData = await initRes.json() as Record<string, unknown>
        if (!initRes.ok) return { success: false, error: `LinkedIn image init failed: ${JSON.stringify(initData)}` }

        const initValue = initData.value as Record<string, unknown>
        const uploadUrl = initValue?.uploadUrl as string
        const imageUrn = initValue?.image as string
        if (!uploadUrl || !imageUrn) return { success: false, error: 'LinkedIn did not return upload URL' }

        // Step 2: download image and upload binary to LinkedIn
        const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' })
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: imgResponse.data
        })
        if (!uploadRes.ok) return { success: false, error: `LinkedIn image upload failed: ${uploadRes.status}` }

        // Step 3: create post with image (newer /rest/posts API)
        const postRes = await fetch('https://api.linkedin.com/rest/posts', {
          method: 'POST',
          headers: liHeaders,
          body: JSON.stringify({
            author,
            commentary: text,
            visibility: 'PUBLIC',
            distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
            content: { media: { altText: 'Post image', id: imageUrn } },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false
          })
        })
        // 201 success has empty body — read ID from header, only parse body on error
        if (!postRes.ok) {
          const errText = await postRes.text()
          return { success: false, error: errText }
        }
        const postId = postRes.headers.get('x-linkedin-id') || postRes.headers.get('x-restli-id') || ''
        return { success: true, postId }
      }

      return { success: false, error: `Unsupported platform: ${platform}` }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  try {
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ error: 'content object required' })
    }

    const results: Record<string, { success: boolean; postId?: string; error?: string }> = {}

    for (const [platform, text] of Object.entries(content)) {
      const cred = await prisma.clientCredential.findFirst({
        where: { clientId, service: platform }
      })

      if (!cred) {
        results[platform] = { success: false, error: 'No credentials found' }
        logger.warn('No social credentials for platform', { clientId, platform })
        continue
      }

      const credentials = decryptJSON<Record<string, string>>(cred.credentials)
      const imageUrl = images?.[platform]
      if (!imageUrl) {
        results[platform] = { success: false, error: 'No image generated for this platform' }
        logger.error('Missing image for platform — skipping post', { clientId, platform })
        continue
      }
      results[platform] = await postToPlatform(platform, text, credentials, imageUrl)
      logger.info('Social post result', { clientId, platform, success: results[platform].success })
    }

    const successfulPosts = Object.values(results).filter((r: unknown) => (r as { success: boolean }).success).length
    await incrementAgentMetrics(
      clientId, 'SOCIAL_MEDIA',
      {},
      { postsPublished: successfulPosts },
      { lastPost: { platforms: Object.keys(content), results, generatedAt, postedAt: new Date().toISOString() } }
    )

    // Log all posts to Google Sheet (non-blocking)
    const timestamp = new Date().toISOString()
    const sheetRows = Object.entries(results).map(([platform, result]) => ({
      timestamp,
      platform,
      postText: content[platform] || '',
      hashtags: (metadata?.[platform]?.hashtags || []).join(' '),
      imageUrl: images?.[platform] || '',
      imagePrompt: metadata?.[platform]?.image_prompt || '',
      status: (result.success ? 'Complete' : 'Failed') as 'Complete' | 'Failed',
      postId: result.postId,
      error: result.error
    }))
    appendPostRows(clientId, sheetRows).catch(err =>
      logger.warn('Sheet logging failed (non-fatal)', { clientId, err })
    )

    res.json({ success: true, results })
  } catch (err) {
    logger.error('N8N social post-all error', { clientId, err })
    res.status(500).json({ error: 'Failed to post to platforms' })
  }
})

// POST /:clientId/social/analyse-engagement
// Called by N8N engagement workflow. Claude classifies the intent and drafts a reply.
router.post('/:clientId/social/analyse-engagement', async (req, res) => {
  const { clientId } = req.params
  const { type, platform, senderId, senderName, message, postId, commentId } = req.body as {
    type: string
    platform: string
    senderId: string
    senderName?: string
    message: string
    postId?: string
    commentId?: string
  }

  try {
    const agentDep = await prisma.agentDeployment.findFirst({
      where: { clientId, agentType: 'SOCIAL_ENGAGEMENT' as never }
    })
    const config = (agentDep?.config || {}) as Record<string, unknown>
    const businessName = (config.businessName as string) || 'our business'
    const businessDescription = (config.business_description as string) || ''
    const bookingLink = (config.booking_link as string) || ''
    const objectionHandlers = (config.objection_handlers as Record<string, string>) || {}

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const systemPrompt = `You are a smart social media engagement assistant for ${businessName}.
${businessDescription ? `Business: ${businessDescription}` : ''}
Your job is to classify incoming messages/comments and draft natural, helpful replies that build relationships.

Booking link (only share if explicitly helpful): ${bookingLink || 'not set'}

Objection handlers:
${Object.entries(objectionHandlers).map(([k, v]) => `- "${k}": ${v}`).join('\n') || 'Use natural empathetic responses'}

Classification rules:
- "interested": asking about services, prices, how it works, or expressing interest
- "question": general question about the business or content
- "complaint": negative experience or frustration
- "booking_ready": explicitly wanting to book, meet, or get started NOW
- "spam": irrelevant, promotional, or clearly automated
- "positive": compliment, like, or positive engagement with no clear intent

Reply rules:
- Keep replies SHORT (1-3 sentences) — social media, not email
- Sound like a real person, not a robot
- If "interested" or "booking_ready" and booking link is set, weave it in naturally
- Never paste the booking link as raw text — use natural language like "you can grab a time here: [link]"
- Match the energy of the platform (casual on Instagram/Facebook)
- For comments: reply publicly, be friendly and brief
- For DMs: slightly more personal and detailed is fine`

    const userMessage = `${senderName ? `From: ${senderName}` : `Sender ID: ${senderId}`}
Platform: ${platform} (${type})
Message: "${message}"

Classify this message and draft an appropriate reply.
Return JSON only:
{
  "intent": "interested|question|complaint|booking_ready|spam|positive",
  "urgency": "low|medium|high",
  "shouldBook": true|false,
  "reply": "<the reply text to send>",
  "reason": "<one sentence explaining your classification>"
}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })

    const raw = (response.content[0] as { text: string }).text
    let analysis: Record<string, unknown>
    try {
      analysis = JSON.parse(raw.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim())
    } catch {
      return res.status(500).json({ error: 'Claude returned invalid JSON', raw })
    }

    logger.info('Engagement analysed', { clientId, platform, type, intent: analysis.intent })

    // Bridge: if DM shows buying intent, forward to lead gen pipeline
    const intent = analysis.intent as string
    if ((intent === 'interested' || intent === 'booking_ready') && type === 'dm') {
      const { forwardToLeadGen } = await import('./meta-webhooks')
      await forwardToLeadGen(clientId, {
        name: senderName || `${platform}-${senderId}`,
        email: '',
        phone: '',
        source: `${platform}-dm`
      }).catch(err => logger.warn('DM-to-lead bridge failed (non-fatal)', { clientId, err }))
      logger.info('DM lead forwarded to lead-gen pipeline', { clientId, platform, senderId, intent })
    }

    res.json({ ...analysis, clientId, platform, type, senderId, postId, commentId })
  } catch (err) {
    logger.error('Engagement analysis failed', { clientId, err })
    res.status(500).json({ error: 'Analysis failed' })
  }
})

// POST /:clientId/social/send-reply
// Called by N8N after analysis. Routes the reply to the correct Meta Graph API endpoint.
router.post('/:clientId/social/send-reply', async (req, res) => {
  const { clientId } = req.params
  const { type, platform, senderId, reply, postId, commentId } = req.body as {
    type: string
    platform: string
    senderId: string
    reply: string
    postId?: string
    commentId?: string
  }

  if (!reply?.trim()) {
    return res.status(400).json({ error: 'reply text is required' })
  }

  try {
    // Get the page access token for this client
    const service = platform === 'instagram' ? 'instagram' : 'facebook'
    const cred = await prisma.clientCredential.findFirst({ where: { clientId, service } })
    if (!cred) {
      return res.status(404).json({ error: `No ${service} credentials found for client` })
    }
    const credentials = decryptJSON<Record<string, string>>(cred.credentials)
    // Instagram messaging requires the Messenger-generated page access token (has messaging capability)
    const accessToken = platform === 'instagram' && process.env.META_PAGE_ACCESS_TOKEN
      ? process.env.META_PAGE_ACCESS_TOKEN
      : credentials.accessToken

    let result: { success: boolean; id?: string; error?: string }

    if (type === 'dm') {
      // Both Facebook Messenger and Instagram use /me/messages with access_token in body
      const dmRes = await axios.post(
        'https://graph.facebook.com/v19.0/me/messages',
        {
          recipient: { id: senderId },
          message: { text: reply },
          access_token: accessToken.trim()
        },
        { validateStatus: () => true }
      )
      result = dmRes.status < 300
        ? { success: true, id: dmRes.data?.message_id }
        : { success: false, error: JSON.stringify(dmRes.data) }

    } else if (type === 'comment') {
      // Reply to a comment on a Facebook post
      const targetId = commentId || postId
      if (!targetId) {
        return res.status(400).json({ error: 'commentId or postId required for comment replies' })
      }

      const response = await fetch(
        `https://graph.facebook.com/v19.0/${targetId}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: reply, access_token: accessToken })
        }
      )
      const data = await response.json() as Record<string, unknown>
      result = response.ok
        ? { success: true, id: data.id as string }
        : { success: false, error: JSON.stringify(data) }

    } else {
      return res.status(400).json({ error: `Unsupported reply type: ${type}` })
    }

    logger.info('Social reply sent', { clientId, platform, type, success: result.success, error: result.error })
    if (result.success) {
      await incrementAgentMetrics(clientId, 'SOCIAL_ENGAGEMENT', {}, { repliesSent: 1, totalLeads: 1 }).catch(() => {})
    }
    res.json(result)
  } catch (err) {
    logger.error('Send reply failed', { clientId, err })
    res.status(500).json({ error: 'Failed to send reply' })
  }
})

// POST /:clientId/activity
router.post('/:clientId/activity', async (req, res) => {
  const { clientId } = req.params
  const activityData = req.body
  try {
    logger.info('N8N activity logged', { clientId, type: activityData.type })
    await updateAgentMetrics(clientId, 'SOCIAL_MEDIA', {
      lastActivity: { ...activityData, loggedAt: new Date().toISOString() }
    })
    res.json({ success: true })
  } catch (err) {
    logger.error('N8N activity error', { clientId, err })
    res.status(500).json({ error: 'Failed to log activity' })
  }
})

export default router
