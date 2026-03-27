import express from 'express'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import twilio from 'twilio'
import { emailService } from '../services/email.service'
import { encryptJSON, decryptJSON } from '../utils/encrypt'
import { appendPostRows } from '../services/sheets.service'
import { logger } from '../utils/logger'
import axios from 'axios'

const router = express.Router()
const prisma = new PrismaClient()

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

// POST /:clientId/contacts
router.post('/:clientId/contacts', async (req, res) => {
  const { clientId } = req.params
  const { name, email, phone, source, tags = [], intent } = req.body
  try {
    const crmType = await getClientCrmType(clientId)
    logger.info('N8N contact save', { clientId, crmType, name })

    // Upsert to internal DB — deduplicates by email within the same client
    const newId = randomUUID()
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [])
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Contact" ("id", "clientId", "name", "email", "phone", "source", "tags", "stage", "updatedAt")
      VALUES (${newId}, ${clientId}, ${name || null}, ${email || null}, ${phone || null},
              ${source || null}, ${tagsJson}::jsonb, 'new', NOW())
      ON CONFLICT ("clientId", "email") WHERE "email" IS NOT NULL
      DO UPDATE SET
        "name"      = COALESCE(EXCLUDED."name", "Contact"."name"),
        "phone"     = COALESCE(EXCLUDED."phone", "Contact"."phone"),
        "updatedAt" = NOW()
      RETURNING "id"
    `
    const id = rows[0]?.id || newId
    logger.info('Contact upserted to DB', { clientId, id })

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

    await updateAgentMetrics(clientId, 'LEAD_GENERATION', {
      lastScoredContact: { contactId, score, stage, tags, summary, nextAction },
      lastScoredAt: new Date().toISOString()
    })
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

    await updateAgentMetrics(clientId, 'VOICE_INBOUND', {
      lastNote: { contactId, addedAt: new Date().toISOString() }
    })
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
    const slots: string[] = []
    const now = new Date()
    for (let d = 1; d <= 7; d++) {
      const date = new Date(now)
      date.setDate(date.getDate() + d)
      if (date.getDay() === 0 || date.getDay() === 6) continue
      for (let h = 9; h <= 16; h++) {
        const slot = new Date(date)
        slot.setHours(h, 0, 0, 0)
        slots.push(slot.toISOString())
      }
    }
    logger.info('N8N calendar slots returned', { clientId, count: slots.length })
    res.json({ slots })
  } catch (err) {
    logger.error('N8N calendar slots error', { clientId, err })
    res.status(500).json({ error: 'Failed to get calendar slots' })
  }
})

// POST /:clientId/appointments
router.post('/:clientId/appointments', async (req, res) => {
  const { clientId } = req.params
  const { contactId, calendarId, startTime, title } = req.body
  try {
    logger.info('N8N appointment booked', { clientId, contactId, startTime })
    await updateAgentMetrics(clientId, 'APPOINTMENT_SETTER', {
      lastAppointment: { contactId, calendarId, startTime, title, bookedAt: new Date().toISOString() }
    })
    res.json({ success: true, appointmentId: `appt-${Date.now()}`, startTime, contactId })
  } catch (err) {
    logger.error('N8N appointment error', { clientId, err })
    res.status(500).json({ error: 'Failed to book appointment' })
  }
})

// POST /:clientId/call-outcomes
router.post('/:clientId/call-outcomes', async (req, res) => {
  const { clientId } = req.params
  const { contactId, outcome, nextAction } = req.body
  try {
    logger.info('N8N call outcome saved', { clientId, contactId, outcome })
    await updateAgentMetrics(clientId, 'VOICE_OUTBOUND', {
      lastCallOutcome: { contactId, outcome, nextAction, recordedAt: new Date().toISOString() }
    })
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
    await updateAgentMetrics(clientId, 'VOICE_CLOSER', {
      lastDealOutcome: { contactId, opportunityId, outcome, reason, recordedAt: new Date().toISOString() }
    })
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

    const systemPrompt = contentCalendar
      ? `You are a social media content strategist. Use this 4-week content calendar as context for what topics and pillars to draw from:\n\n${contentCalendar}`
      : `You are an expert social media content strategist for ${businessName}.`

    const userPrompt = topic
      ? `Create social media posts about: "${topic}" for platforms: ${platformList.join(', ')}.`
      : `Create today's social media posts for ${businessName}. Platforms: ${platformList.join(', ')}.`

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `${userPrompt}\n\nReturn a single JSON object with keys for each platform (${platformList.join(', ')}). Each value must be an object with:\n- content: the full post text\n- hashtags: array of hashtag strings\n- image_prompt: detailed prompt for AI image generation\n\nOnly include the platforms listed. Return valid JSON only, no markdown.`
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
      const response = await axios.post(
        'https://fal.run/fal-ai/flux/dev',
        {
          prompt: prompt.substring(0, 1000),
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
    logger.error('Social image generation failed — aborting workflow', { clientId, err })
    res.status(500).json({ error: 'Image generation failed' })
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
        // Step 2: publish
        const publishRes = await fetch(
          `https://graph.facebook.com/v19.0/${credentials.igUserId}/media_publish`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: createData.id, access_token: credentials.accessToken })
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
          'X-Restli-Protocol-Version': '2.0.0'
        }

        // Step 1: register image upload
        const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
          method: 'POST',
          headers: liHeaders,
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
              owner: author,
              serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }]
            }
          })
        })
        const registerData = await registerRes.json() as Record<string, unknown>
        if (!registerRes.ok) return { success: false, error: `LinkedIn register upload failed: ${JSON.stringify(registerData)}` }

        const uploadMechanism = ((registerData.value as Record<string, unknown>)?.uploadMechanism as Record<string, unknown>) || {}
        const uploadUrl = (uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'] as Record<string, unknown>)?.uploadUrl as string
        const assetUrn = (registerData.value as Record<string, unknown>)?.asset as string
        if (!uploadUrl || !assetUrn) return { success: false, error: 'LinkedIn did not return upload URL' }

        // Step 2: download image and upload binary to LinkedIn
        const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' })
        await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: imgResponse.data
        })

        // Step 3: create post with asset
        const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
          method: 'POST',
          headers: liHeaders,
          body: JSON.stringify({
            author,
            lifecycleState: 'PUBLISHED',
            specificContent: {
              'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text },
                shareMediaCategory: 'IMAGE',
                media: [{ status: 'READY', media: assetUrn }]
              }
            },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
          })
        })
        const postData = await postRes.json() as Record<string, unknown>
        if (!postRes.ok) return { success: false, error: JSON.stringify(postData) }
        return { success: true }
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

    await updateAgentMetrics(clientId, 'SOCIAL_MEDIA', {
      lastPost: { platforms: Object.keys(content), results, generatedAt, postedAt: new Date().toISOString() }
    })

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
