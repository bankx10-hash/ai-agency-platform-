import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'
import nodemailer from 'nodemailer'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const router = Router()

router.use(authMiddleware)

// ── Gmail helpers ─────────────────────────────────────────────────────────────

interface GmailCreds { accessToken: string; refreshToken: string; email: string }

async function getGmailClient(clientId: string) {
  const cred = await prisma.clientCredential.findFirst({ where: { clientId, service: 'gmail' } })
  if (!cred) return null
  const creds = decryptJSON<GmailCreds>(cred.credentials)
  if (!creds?.refreshToken) return null

  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'http://localhost:4000/onboarding/oauth/gmail/callback'
  )
  oauth2.setCredentials({ access_token: creds.accessToken, refresh_token: creds.refreshToken })
  const gmail = google.gmail({ version: 'v1', auth: oauth2 })
  return { gmail, creds }
}

function decodeBase64Url(str: string): string {
  try {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  } catch { return '' }
}

type GmailPart = {
  mimeType?: string | null
  body?: { data?: string | null; size?: number | null } | null
  parts?: GmailPart[] | null
  headers?: { name?: string | null; value?: string | null }[] | null
}

function extractBody(payload: GmailPart): { text: string; html: string } {
  let text = ''
  let html = ''
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    text = decodeBase64Url(payload.body.data)
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    html = decodeBase64Url(payload.body.data)
  } else if (payload.parts) {
    for (const part of payload.parts) {
      const sub = extractBody(part)
      if (sub.text) text = sub.text
      if (sub.html) html = sub.html
    }
  }
  return { text, html }
}

function getHeader(headers: { name?: string | null; value?: string | null }[] | null | undefined, name: string): string {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function parseMessage(msg: { id?: string | null; threadId?: string | null; labelIds?: string[] | null; snippet?: string | null; internalDate?: string | null; payload?: GmailPart | null }) {
  const headers = msg.payload?.headers || []
  const { text, html } = extractBody(msg.payload || {})
  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet,
    isUnread: msg.labelIds?.includes('UNREAD') ?? false,
    date: msg.internalDate ? new Date(parseInt(msg.internalDate)).toISOString() : null,
    from: getHeader(headers, 'from'),
    to: getHeader(headers, 'to'),
    subject: getHeader(headers, 'subject'),
    messageId: getHeader(headers, 'message-id'),
    inReplyTo: getHeader(headers, 'in-reply-to'),
    references: getHeader(headers, 'references'),
    body: html || text,
    bodyText: text,
  }
}

// Extract email address from "Name <email>" format
function extractEmail(fromStr: string): string {
  const match = fromStr.match(/<(.+?)>/)
  return match ? match[1] : fromStr.trim()
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// GET /inbox/threads?label=INBOX&q=&pageToken=
router.get('/threads', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const g = await getGmailClient(clientId)
    if (!g) { res.status(400).json({ error: 'Gmail not connected' }); return }

    const { q, pageToken, label = 'INBOX' } = req.query as Record<string, string>

    const listRes = await g.gmail.users.threads.list({
      userId: 'me',
      labelIds: [label],
      maxResults: 30,
      q: q || undefined,
      pageToken: pageToken || undefined,
    })

    const threadItems = listRes.data.threads || []

    // Fetch first message of each thread for preview
    const threads = await Promise.all(
      threadItems.map(async t => {
        try {
          const threadRes = await g.gmail.users.threads.get({
            userId: 'me', id: t.id!, format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
          })
          const msgs = threadRes.data.messages || []
          const first = msgs[0]
          const last = msgs[msgs.length - 1]
          const firstHeaders = first?.payload?.headers || []
          const lastHeaders = last?.payload?.headers || []
          const isUnread = msgs.some(m => m.labelIds?.includes('UNREAD'))

          // Try to match sender to a CRM contact
          const fromEmail = extractEmail(getHeader(lastHeaders, 'from') || getHeader(firstHeaders, 'from'))
          let contact = null
          if (fromEmail && !fromEmail.includes(g.creds.email)) {
            contact = await prisma.contact.findFirst({
              where: { clientId, email: fromEmail },
              select: { id: true, name: true, email: true }
            })
          }

          return {
            id: t.id,
            snippet: threadRes.data.snippet,
            messageCount: msgs.length,
            isUnread,
            from: getHeader(lastHeaders, 'from') || getHeader(firstHeaders, 'from'),
            subject: getHeader(firstHeaders, 'subject'),
            date: last?.internalDate ? new Date(parseInt(last.internalDate)).toISOString() : null,
            contact,
          }
        } catch {
          return { id: t.id, snippet: '', messageCount: 1, isUnread: false, from: '', subject: '', date: null, contact: null }
        }
      })
    )

    res.json({ threads, nextPageToken: listRes.data.nextPageToken || null, connectedEmail: g.creds.email })
  } catch (err) {
    logger.error('Inbox list error', { err })
    res.status(500).json({ error: 'Failed to fetch inbox' })
  }
})

// GET /inbox/threads/:threadId
router.get('/threads/:threadId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const g = await getGmailClient(clientId)
    if (!g) { res.status(400).json({ error: 'Gmail not connected' }); return }

    const threadRes = await g.gmail.users.threads.get({
      userId: 'me', id: req.params.threadId, format: 'full'
    })

    const messages = (threadRes.data.messages || []).map(parseMessage)

    // Mark as read
    await g.gmail.users.threads.modify({
      userId: 'me', id: req.params.threadId,
      requestBody: { removeLabelIds: ['UNREAD'] }
    }).catch(() => {})

    // Try to find a CRM contact for this thread
    const emailAddresses = new Set<string>()
    for (const msg of messages) {
      if (msg.from) emailAddresses.add(extractEmail(msg.from))
      if (msg.to) msg.to.split(',').forEach(t => emailAddresses.add(extractEmail(t.trim())))
    }
    emailAddresses.delete(g.creds.email)

    let contact = null
    for (const email of emailAddresses) {
      if (!email) continue
      contact = await prisma.contact.findFirst({
        where: { clientId, email },
        select: { id: true, name: true, email: true, pipelineStage: true, score: true }
      })
      if (contact) break
    }

    res.json({ thread: { id: threadRes.data.id, messages }, contact, connectedEmail: g.creds.email })
  } catch (err) {
    logger.error('Inbox thread error', { err })
    res.status(500).json({ error: 'Failed to fetch thread' })
  }
})

// POST /inbox/threads/:threadId/reply
router.post('/threads/:threadId/reply', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const g = await getGmailClient(clientId)
    if (!g) { res.status(400).json({ error: 'Gmail not connected' }); return }

    const { body, to, subject, messageId, references } = req.body as {
      body: string; to: string; subject: string; messageId?: string; references?: string
    }
    if (!body || !to) { res.status(400).json({ error: 'body and to required' }); return }

    // Build MIME message
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
    const headers: string[] = [
      `From: ${g.creds.email}`,
      `To: ${to}`,
      `Subject: ${replySubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
    ]
    if (messageId) headers.push(`In-Reply-To: ${messageId}`)
    if (references || messageId) headers.push(`References: ${references || messageId}`)

    const rawEmail = [...headers, '', body].join('\r\n')
    const encoded = Buffer.from(rawEmail).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    await g.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded, threadId: req.params.threadId }
    })

    res.json({ success: true })
  } catch (err) {
    logger.error('Inbox reply error', { err })
    res.status(500).json({ error: 'Failed to send reply' })
  }
})

// POST /inbox/threads/:threadId/suggest-reply
router.post('/threads/:threadId/suggest-reply', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const g = await getGmailClient(clientId)
    if (!g) { res.status(400).json({ error: 'Gmail not connected' }); return }

    // Fetch thread
    const threadRes = await g.gmail.users.threads.get({
      userId: 'me', id: req.params.threadId, format: 'full'
    })
    const messages = (threadRes.data.messages || []).map(parseMessage)
    if (messages.length === 0) { res.status(400).json({ error: 'Empty thread' }); return }

    // Get client business context
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { businessName: true, businessDescription: true }
    })

    // Build conversation context from last 6 messages (oldest first)
    const contextMsgs = messages.slice(-6)
    const conversationText = contextMsgs.map(m => {
      const sender = m.from || 'Unknown'
      const isMe = extractEmail(m.from || '').toLowerCase() === g.creds.email.toLowerCase()
      const label = isMe ? `You (${g.creds.email})` : sender
      const body = m.bodyText?.slice(0, 600) || m.body?.replace(/<[^>]+>/g, ' ').slice(0, 600) || '(no content)'
      return `--- ${label} wrote ---\n${body}`
    }).join('\n\n')

    const lastMsg = messages[messages.length - 1]
    const lastSender = lastMsg.from || ''

    const systemPrompt = `You are a professional email assistant for ${client?.businessName || 'a business'}${client?.businessDescription ? `. ${client.businessDescription}` : ''}.
Write clear, professional, and friendly email replies. Match the tone of the conversation. Be concise — avoid unnecessary filler. Do not add a subject line or any meta text. Output only the email body text, ready to send.`

    const userPrompt = `Here is the email thread:\n\n${conversationText}\n\nWrite a professional reply to ${lastSender}. Reply as ${client?.businessName || 'the business'} (${g.creds.email}).`

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const suggestion = (response.content[0] as { type: string; text: string }).text?.trim() || ''
    res.json({ suggestion })
  } catch (err) {
    logger.error('Suggest reply error', { err })
    res.status(500).json({ error: 'Failed to generate suggestion' })
  }
})

// POST /inbox/compose
router.post('/compose', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const g = await getGmailClient(clientId)
    if (!g) { res.status(400).json({ error: 'Gmail not connected' }); return }

    const { to, subject, body } = req.body as { to: string; subject: string; body: string }
    if (!to || !subject || !body) { res.status(400).json({ error: 'to, subject, body required' }); return }

    const rawEmail = [
      `From: ${g.creds.email}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      '',
      body
    ].join('\r\n')

    const encoded = Buffer.from(rawEmail).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const sent = await g.gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } })

    res.json({ success: true, messageId: sent.data.id })
  } catch (err) {
    logger.error('Inbox compose error', { err })
    res.status(500).json({ error: 'Failed to send email' })
  }
})

// GET /inbox/contact/:contactId — emails involving this contact
router.get('/contact/:contactId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const g = await getGmailClient(clientId)
    if (!g) { res.json({ threads: [], connected: false }); return }

    const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, clientId } })
    if (!contact?.email) { res.json({ threads: [], connected: true }); return }

    const listRes = await g.gmail.users.threads.list({
      userId: 'me', q: contact.email, maxResults: 20
    })

    const threadItems = listRes.data.threads || []
    const threads = await Promise.all(
      threadItems.map(async t => {
        try {
          const threadRes = await g.gmail.users.threads.get({
            userId: 'me', id: t.id!, format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
          })
          const msgs = threadRes.data.messages || []
          const first = msgs[0]
          const last = msgs[msgs.length - 1]
          const firstHeaders = first?.payload?.headers || []
          const lastHeaders = last?.payload?.headers || []
          return {
            id: t.id,
            snippet: threadRes.data.snippet,
            messageCount: msgs.length,
            isUnread: msgs.some(m => m.labelIds?.includes('UNREAD')),
            from: getHeader(lastHeaders, 'from') || getHeader(firstHeaders, 'from'),
            subject: getHeader(firstHeaders, 'subject'),
            date: last?.internalDate ? new Date(parseInt(last.internalDate)).toISOString() : null,
          }
        } catch { return null }
      })
    )

    res.json({ threads: threads.filter(Boolean), connected: true })
  } catch (err) {
    logger.error('Inbox contact threads error', { err })
    res.status(500).json({ error: 'Failed to fetch contact emails' })
  }
})

// GET /inbox/status
router.get('/status', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const cred = await prisma.clientCredential.findFirst({ where: { clientId, service: 'gmail' } })
    if (!cred) { res.json({ connected: false }); return }
    const creds = decryptJSON<GmailCreds>(cred.credentials)
    res.json({ connected: !!creds?.refreshToken, email: creds?.email || null })
  } catch {
    res.json({ connected: false })
  }
})

export default router
