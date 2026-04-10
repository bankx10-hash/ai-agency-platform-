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
import {
  getClientCrmType,
  getHubSpotToken,
  hubspotAddNote,
  syncExistingContactToCrm,
  syncContactScoreToCrm,
  addCallNoteToCrm
} from '../services/contact.service'
import { recordUsage } from '../services/usage.service'

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
  const {
    name, email, phone, source, tags = [], intent, linkedinUrl,
    // Inbound-call enrichment fields (sent by voice-inbound workflow)
    callId, transcript, callSummary, durationSeconds, fromNumber, appointmentBooked
  } = req.body
  try {
    const crmType = await getClientCrmType(clientId)
    logger.info('N8N contact save', { clientId, crmType, name, hasCallData: !!callId })

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

    // Track Apollo prospect usage for B2B outreach contacts
    if (isNew && source && (source.includes('apollo') || source.includes('b2b'))) {
      recordUsage(clientId, 'APOLLO_PROSPECTS', 1, `apollo-${id}`, 'apollo_prospect').catch(() => {})
    }

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

    // Mirror to whichever external CRM the client has connected (HubSpot,
    // Salesforce, Zoho, Pipedrive, GoHighLevel) — best-effort, never blocks.
    const crmId = await syncExistingContactToCrm(clientId, id)

    // If this contact came from an inbound call, link the CallLog row to the
    // contact and create a CALL activity on the contact's timeline so the
    // user can see full call details (transcript, duration, summary) in CRM.
    if (callId || transcript || callSummary) {
      try {
        // Link the CallLog to this contact (CallLog row is created earlier by
        // /calls/webhook in routes/calls.ts — match by retellCallId)
        if (callId) {
          await prisma.$executeRaw`
            UPDATE "CallLog"
            SET "contactId" = ${id},
                "callerName" = COALESCE(${name || null}, "callerName"),
                "callerEmail" = COALESCE(${email || null}, "callerEmail"),
                "intent" = COALESCE(${intent || null}, "intent"),
                "appointmentBooked" = COALESCE(${appointmentBooked ?? null}, "appointmentBooked")
            WHERE "retellCallId" = ${callId} AND "clientId" = ${clientId}
          `
        }

        // Create a CALL ContactActivity on the platform CRM timeline so the
        // call appears in /dashboard/crm/contacts/:id with full details.
        const activityTitle = `Inbound call${name ? ` from ${name}` : ''}${durationSeconds ? ` (${Math.round(durationSeconds / 60)}m ${durationSeconds % 60}s)` : ''}`
        await prisma.contactActivity.create({
          data: {
            id: randomUUID(),
            contactId: id,
            clientId,
            type: 'CALL' as never,
            title: activityTitle,
            body: callSummary || transcript?.slice(0, 2000) || null,
            metadata: {
              callId,
              direction: 'INBOUND',
              fromNumber,
              durationSeconds,
              intent,
              appointmentBooked,
              transcriptPreview: transcript?.slice(0, 500),
              hasFullTranscript: !!transcript
            } as never,
            agentType: 'VOICE_INBOUND'
          }
        }).catch((err) => logger.warn('Failed to create CALL activity', { clientId, err: String(err) }))

        // Also push a call summary note to whichever external CRM is connected
        // (HubSpot, Salesforce, Zoho, Pipedrive, GoHighLevel) so the call
        // shows up there too — best-effort, never blocks.
        if (crmId) {
          const noteBody = [
            `📞 ${activityTitle}`,
            callSummary ? `\nSummary: ${callSummary}` : '',
            intent ? `Intent: ${intent}` : '',
            fromNumber ? `From: ${fromNumber}` : '',
            durationSeconds ? `Duration: ${Math.round(durationSeconds / 60)}m ${durationSeconds % 60}s` : '',
            appointmentBooked ? '✅ Appointment booked during call' : '',
            transcript ? `\n--- Transcript ---\n${transcript.slice(0, 5000)}` : ''
          ].filter(Boolean).join('\n')
          await addCallNoteToCrm(clientId, id, noteBody)
        }

        logger.info('Call linked to contact in platform CRM and synced to external CRM', { clientId, contactId: id, callId, crmType })
      } catch (callLinkErr) {
        logger.error('Failed to link call to contact', { clientId, contactId: id, err: String(callLinkErr) })
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

    // Push score to whichever external CRM is connected (HubSpot, Salesforce,
    // Zoho, Pipedrive, GoHighLevel) — best-effort, never blocks.
    await syncContactScoreToCrm(clientId, contactId, score)

    await incrementAgentMetrics(
      clientId, 'LEAD_GENERATION',
      { leadsToday: 1 },
      { totalLeads: 1 },
      { lastScoredContact: { contactId, score, stage, tags, summary, nextAction }, lastScoredAt: new Date().toISOString() }
    )
    recordUsage(clientId, 'AI_ACTIONS', 1, `lead-score-${contactId}`, 'lead_score').catch(() => {})
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
    recordUsage(clientId, 'AI_ACTIONS', 1, `inbound-note-${contactId}-${Date.now()}`, 'inbound_note').catch(() => {})
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
    recordUsage(clientId, 'SMS', 1, sms.sid, 'sms').catch(() => {})

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
      recordUsage(clientId, 'EMAILS', 1, `email-${contactId || to}-${Date.now()}`, 'email').catch(() => {})
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
  let { contactId, calendarId, startTime, title, contactName, contactEmail } = req.body
  try {
    // If no contactId provided, look up by email or name
    if (!contactId && (contactEmail || contactName)) {
      const existing = await prisma.contact.findFirst({
        where: {
          clientId,
          ...(contactEmail ? { email: contactEmail } : { name: contactName })
        },
        select: { id: true }
      })
      if (existing) contactId = existing.id
    }
    logger.info('N8N appointment booking', { clientId, contactId, startTime, contactName, contactEmail })

    // Dedup: skip if we already logged an appointment for this contact in the last 5 minutes
    if (contactId) {
      const recent = await prisma.contactActivity.findFirst({
        where: {
          contactId,
          clientId,
          type: 'APPOINTMENT' as never,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }
        },
        select: { id: true }
      })
      if (recent) {
        logger.info('Skipping duplicate appointment log', { clientId, contactId })
        res.json({ success: true, duplicate: true })
        return
      }
    }

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { businessName: true } })
    const businessName = client?.businessName || 'our business'

    // Look up contact details (we need name + email + phone for the calendar event)
    let lookupContactName = contactName
    let lookupContactEmail = contactEmail
    let lookupContactPhone: string | undefined
    if (contactId) {
      const contactRow = await prisma.contact.findFirst({
        where: { id: contactId, clientId },
        select: { name: true, email: true, phone: true }
      })
      if (contactRow) {
        lookupContactName = lookupContactName || contactRow.name || undefined
        lookupContactEmail = lookupContactEmail || contactRow.email || undefined
        lookupContactPhone = contactRow.phone || undefined
      }
    }

    // Create the REAL calendar event in the client's connected calendar
    // (Google Calendar / Calendly / Cal.com) so the lead receives an invite
    // and the client sees it in their calendar. If no calendar is connected,
    // we still proceed — the appointment record + closer trigger don't depend
    // on a real calendar event.
    type BookingResult = { success: boolean; booked: boolean; confirmationMessage: string; eventLink?: string }
    let bookingResult: BookingResult | undefined
    if (startTime && lookupContactEmail && lookupContactName) {
      try {
        const { calendarService } = await import('../services/calendar.service')
        bookingResult = await calendarService.bookAppointment(
          clientId,
          startTime,
          { name: lookupContactName, email: lookupContactEmail, phone: lookupContactPhone },
          businessName
        )
        logger.info('Calendar booking attempted', { clientId, contactId, booked: bookingResult.booked, eventLink: bookingResult.eventLink })
      } catch (calErr) {
        logger.warn('Calendar booking failed (non-fatal — closer will still fire)', { clientId, contactId, err: String(calErr) })
      }
    } else {
      logger.info('Calendar booking skipped (missing startTime/email/name)', { clientId, hasStartTime: !!startTime, hasEmail: !!lookupContactEmail, hasName: !!lookupContactName })
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
    recordUsage(clientId, 'AI_ACTIONS', 1, `appt-${contactId}-${Date.now()}`, 'appointment').catch(() => {})

    // CRM activity: log appointment
    if (contactId) {
      await prisma.contactActivity.create({
        data: { id: randomUUID(), contactId, clientId, type: 'APPOINTMENT' as never, title: `Appointment booked: ${title || 'Meeting'}`, body: startTime, metadata: { calendarId, startTime, title, calendarBooked: bookingResult?.booked } as never, agentType: 'APPOINTMENT_SETTER' }
      }).catch(() => {})
      // Determine pipeline stage based on client plan type
      const clientForPlan = await prisma.client.findUnique({ where: { id: clientId }, select: { plan: true } })
      const isReceptionist = (clientForPlan?.plan as string | undefined) === 'AI_RECEPTIONIST'
      const pipelineStage = isReceptionist ? 'APPOINTMENT_BOOKED' : 'QUALIFIED'
      await prisma.contact.updateMany({ where: { id: contactId, clientId }, data: { lastContactedAt: new Date(), pipelineStage: pipelineStage as never } }).catch(() => {})

      if (isReceptionist) {
        // Receptionist plan: trigger follow-up agent (calls 2 days after appointment)
        const followupDeployment = await prisma.agentDeployment.findFirst({
          where: { clientId, agentType: 'RECEPTIONIST_FOLLOWUP' as never, status: 'ACTIVE' as never },
          select: { n8nWorkflowId: true }
        })
        if (followupDeployment?.n8nWorkflowId) {
          const webhookUrl = `${process.env.N8N_BASE_URL}/webhook/followup-${clientId}`
          axios.post(webhookUrl, {
            contactId,
            callType: 'post_appointment',
            appointmentDate: startTime,
            notes: `Appointment booked: ${title || 'Meeting'}`
          }).catch(err => logger.warn('Failed to trigger follow-up webhook', { clientId, contactId, err: String(err) }))
          logger.info('Receptionist follow-up scheduled', { clientId, contactId, appointmentDate: startTime })
        }
      } else {
        // Sales plan: hand off to voice closer — trigger its N8N webhook if deployed
        const closerDeployment = await prisma.agentDeployment.findFirst({
          where: { clientId, agentType: 'VOICE_CLOSER' as never, status: 'ACTIVE' as never },
          select: { n8nWorkflowId: true }
        })
        if (closerDeployment?.n8nWorkflowId) {
          const contact = await prisma.contact.findFirst({ where: { id: contactId, clientId }, select: { source: true } })
          const webhookUrl = `${process.env.N8N_BASE_URL}/webhook/closer-ready-${clientId}`
          axios.post(webhookUrl, {
            contactId,
            leadSource: contact?.source || 'appointment_booked',
            appointmentTime: startTime,
            notes: `Appointment booked: ${title || 'Meeting'}`
          }).catch(err => logger.warn('Failed to trigger voice closer webhook', { clientId, contactId, err: String(err) }))
          logger.info('Voice closer handoff triggered', { clientId, contactId })
        }
      }
    }

    res.json({ success: true, appointmentId: newAppt.id, startTime, contactId, calendarBooked: bookingResult?.booked || false, eventLink: bookingResult?.eventLink })
  } catch (err) {
    logger.error('N8N appointment error', { clientId, err })
    res.status(500).json({ error: 'Failed to book appointment' })
  }
})

// POST /:clientId/linkedin-lead — LinkedIn outreach reply captured as a lead
// POST /:clientId/outbound-queue — tag a contact for the Voice Outbound
// agent to call. Used by Lead Generation for warm leads (score 40-70)
// that aren't hot enough for the SMS path but are worth a live call.
// Also immediately triggers the Voice Outbound workflow webhook for that
// specific contact so we don't have to wait for the daily cron.
router.post('/:clientId/outbound-queue', async (req, res) => {
  const { clientId } = req.params
  const { contactId, contactName, contactEmail, contactPhone, score, summary } = req.body as {
    contactId?: string
    contactName?: string
    contactEmail?: string
    contactPhone?: string
    score?: number
    summary?: string
  }
  try {
    if (!contactId) {
      res.status(400).json({ error: 'contactId required' })
      return
    }

    // Tag the contact in our internal CRM so the daily cron also picks it
    // up as a fallback if the immediate trigger fails.
    await prisma.$executeRaw`
      UPDATE "Contact"
      SET "stage" = 'outbound-queue', "updatedAt" = NOW()
      WHERE "id" = ${contactId} AND "clientId" = ${clientId}
    `.catch(err => logger.warn('Failed to tag contact for outbound queue', { clientId, contactId, err: String(err) }))

    // Log CRM activity
    await prisma.contactActivity.create({
      data: {
        id: randomUUID(),
        contactId,
        clientId,
        type: 'NOTE' as never,
        title: 'Queued for Voice Outbound',
        body: `Warm lead (score ${score ?? 'n/a'}) — queued for a live outbound qualifying call.`,
        metadata: { score, summary } as never,
        agentType: 'VOICE_OUTBOUND'
      }
    }).catch(() => {})

    // Immediately trigger the Voice Outbound workflow for this specific
    // contact — don't wait for the daily cron. The workflow has a
    // `outbound-queue-{clientId}` webhook trigger that accepts a single
    // lead and places a Retell call to it.
    const outboundDeployment = await prisma.agentDeployment.findFirst({
      where: { clientId, agentType: 'VOICE_OUTBOUND' as never, status: 'ACTIVE' as never },
      select: { n8nWorkflowId: true }
    })
    if (outboundDeployment?.n8nWorkflowId) {
      const webhookUrl = `${process.env.N8N_BASE_URL}/webhook/outbound-queue-${clientId}`
      axios.post(webhookUrl, {
        contactId,
        contactName,
        contactEmail,
        contactPhone,
        score,
        summary,
        leadSource: 'lead-gen-warm-score'
      }).catch(err => logger.warn('Failed to trigger outbound-queue webhook', { clientId, contactId, err: String(err) }))
      logger.info('Voice Outbound queue handoff triggered', { clientId, contactId, score })
    } else {
      logger.info('No active Voice Outbound agent — contact tagged only, will be picked up by daily cron if deployed later', { clientId, contactId })
    }

    res.json({ success: true, contactId, queued: true })
  } catch (err) {
    logger.error('Outbound queue error', { clientId, err: String(err) })
    res.status(500).json({ error: 'Failed to queue contact for outbound' })
  }
})

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
    recordUsage(clientId, 'AI_ACTIONS', 1, `outbound-${contactId}-${Date.now()}`, 'outbound_call').catch(() => {})
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
    recordUsage(clientId, 'AI_ACTIONS', 1, `deal-${opportunityId || contactId}-${Date.now()}`, 'deal_outcome').catch(() => {})
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

    recordUsage(clientId, 'AI_ACTIONS', 1, `social-claude-${Date.now()}`, 'claude_social').catch(() => {})

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
    if (successfulPosts > 0) {
      recordUsage(clientId, 'SOCIAL_POSTS', successfulPosts, `social-${Date.now()}`, 'social_post').catch(() => {})
    }
    recordUsage(clientId, 'AI_ACTIONS', 1, `social-gen-${Date.now()}`, 'social_generate').catch(() => {})

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

    recordUsage(clientId, 'AI_ACTIONS', 1, `engage-claude-${Date.now()}`, 'claude_engagement').catch(() => {})
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
    // Instagram DMs use the Facebook Page access token (needs pages_messaging permission)
    // Try instagram creds first, fall back to facebook creds, then env override
    let accessToken: string | undefined

    if (process.env.META_PAGE_ACCESS_TOKEN) {
      accessToken = process.env.META_PAGE_ACCESS_TOKEN
    } else {
      // Try the platform-specific credential first
      const primaryService = platform === 'instagram' ? 'instagram' : 'facebook'
      const primaryCred = await prisma.clientCredential.findFirst({ where: { clientId, service: primaryService } })
      if (primaryCred) {
        const data = decryptJSON<Record<string, string>>(primaryCred.credentials)
        accessToken = data.pageAccessToken || data.accessToken
      }

      // For Instagram DMs, fall back to the Facebook page token (it's the same page)
      if (!accessToken && platform === 'instagram') {
        const fbCred = await prisma.clientCredential.findFirst({ where: { clientId, service: 'facebook' } })
        if (fbCred) {
          const data = decryptJSON<Record<string, string>>(fbCred.credentials)
          accessToken = data.accessToken
        }
      }
    }

    if (!accessToken) {
      return res.status(404).json({ error: `No ${platform} credentials found for client` })
    }

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
      recordUsage(clientId, 'AI_ACTIONS', 1, `engagement-${Date.now()}`, 'social_reply').catch(() => {})
    }
    res.json(result)
  } catch (err) {
    const axiosErr = err as { response?: { status?: number; data?: unknown } }
    logger.error('Send reply failed', {
      clientId, platform, type,
      status: axiosErr.response?.status,
      metaError: axiosErr.response?.data,
      error: err instanceof Error ? err.message : err
    })
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
