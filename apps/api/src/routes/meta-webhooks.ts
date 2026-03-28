import express from 'express'
import { PrismaClient } from '@prisma/client'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'
import axios from 'axios'

const router = express.Router()
const prisma = new PrismaClient()

// Parse JSON bodies — this router is mounted before the global json middleware
router.use(express.json({ limit: '1mb' }))

// ─── Webhook Verification (GET) ──────────────────────────────────────────────
// Meta sends a GET request when you first set up the webhook in the Developer Console.
// It passes hub.mode=subscribe, hub.challenge=<token>, hub.verify_token=<your token>.
router.get('/', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'nodus_engage_verify'

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Meta webhook verified')
    res.status(200).send(challenge)
  } else {
    logger.warn('Meta webhook verification failed', { mode, token })
    res.sendStatus(403)
  }
})

// ─── Webhook Event Handler (POST) ────────────────────────────────────────────
// Meta sends all page events here. We look up which client owns the page/IG account,
// normalise the event, and forward it to the client's engagement N8N workflow.
router.post('/', async (req, res) => {
  // Always ack immediately — Meta retries if we don't respond within 20s
  res.sendStatus(200)

  const body = req.body as MetaWebhookBody
  if (!body || body.object !== 'page') return

  for (const entry of (body.entry || [])) {
    const pageId = entry.id

    // Find the client that owns this Facebook page
    const cred = await prisma.clientCredential.findFirst({
      where: { service: 'facebook' }
    })

    // We may have multiple clients — find the one whose pageId matches
    const allFbCreds = await prisma.clientCredential.findMany({
      where: { service: 'facebook' }
    })

    let clientId: string | undefined
    for (const c of allFbCreds) {
      try {
        const data = decryptJSON<{ pageId: string }>(c.credentials)
        if (data.pageId === pageId) {
          clientId = c.clientId
          break
        }
      } catch { /* skip corrupt credentials */ }
    }

    if (!clientId) {
      logger.warn('Meta webhook: no client found for page', { pageId })
      continue
    }

    // Process each messaging or feed event
    for (const event of (entry.messaging || [])) {
      await forwardEngagementEvent(clientId, {
        type: 'dm',
        platform: 'facebook',
        senderId: event.sender?.id,
        recipientId: event.recipient?.id,
        message: event.message?.text || '',
        messageId: event.message?.mid,
        timestamp: event.timestamp
      })
    }

    // Feed events (comments, likes on posts)
    for (const change of (entry.changes || [])) {
      if (change.field === 'feed') {
        const value = change.value as FeedChangeValue
        if (value.item === 'comment' && value.verb === 'add') {
          await forwardEngagementEvent(clientId, {
            type: 'comment',
            platform: 'facebook',
            senderId: value.from?.id,
            senderName: value.from?.name,
            message: value.message || '',
            postId: value.post_id,
            commentId: value.comment_id,
            timestamp: value.created_time
          })
        }
      }

      // Instagram comment/DM events come through the page's changes
      if (change.field === 'messages') {
        const value = change.value as Record<string, unknown>
        await forwardEngagementEvent(clientId, {
          type: 'dm',
          platform: 'instagram',
          senderId: (value.sender as Record<string, string>)?.id,
          message: (value.message as Record<string, string>)?.text || '',
          timestamp: value.timestamp as number
        })
      }
    }
  }
})

// ─── Forward normalised event to client's N8N engagement workflow ─────────────
async function forwardEngagementEvent(clientId: string, event: EngagementEvent): Promise<void> {
  if (!event.message?.trim()) return  // skip empty messages (reactions, etc.)

  const n8nBase = process.env.N8N_BASE_URL || 'http://localhost:5678'
  const webhookPath = `social-engage-${clientId}`

  try {
    await axios.post(
      `${n8nBase}/webhook/${webhookPath}`,
      { clientId, ...event },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': process.env.N8N_API_SECRET || ''
        },
        timeout: 10000
      }
    )
    logger.info('Engagement event forwarded to N8N', { clientId, type: event.type, platform: event.platform })
  } catch (err) {
    logger.error('Failed to forward engagement event to N8N', { clientId, err })
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface MetaWebhookBody {
  object: string
  entry: Array<{
    id: string
    messaging?: Array<{
      sender?: { id: string }
      recipient?: { id: string }
      timestamp?: number
      message?: { text?: string; mid?: string }
    }>
    changes?: Array<{
      field: string
      value: FeedChangeValue | Record<string, unknown>
    }>
  }>
}

interface FeedChangeValue {
  item?: string
  verb?: string
  from?: { id: string; name?: string }
  message?: string
  post_id?: string
  comment_id?: string
  created_time?: number
}

interface EngagementEvent {
  type: 'dm' | 'comment' | 'story_mention'
  platform: 'facebook' | 'instagram'
  senderId?: string
  senderName?: string
  recipientId?: string
  message: string
  messageId?: string
  postId?: string
  commentId?: string
  timestamp?: number
}

export default router
