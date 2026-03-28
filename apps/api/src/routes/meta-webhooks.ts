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

  logger.info('Meta webhook POST received', { object: req.body?.object, entryCount: req.body?.entry?.length })

  const body = req.body as MetaWebhookBody
  if (!body || (body.object !== 'page' && body.object !== 'instagram')) {
    logger.warn('Meta webhook ignored — unexpected object type', { object: body?.object })
    return
  }

  const isInstagram = body.object === 'instagram'

  for (const entry of (body.entry || [])) {
    const accountId = entry.id

    let clientId: string | undefined

    if (isInstagram) {
      // Instagram: entry.id is the Instagram Business Account ID (igUserId)
      const allIgCreds = await prisma.clientCredential.findMany({ where: { service: 'instagram' } })
      for (const c of allIgCreds) {
        try {
          const data = decryptJSON<{ igUserId: string }>(c.credentials)
          if (data.igUserId === accountId) {
            clientId = c.clientId
            break
          }
        } catch { /* skip corrupt credentials */ }
      }
    } else {
      // Facebook: entry.id is the Facebook Page ID
      const allFbCreds = await prisma.clientCredential.findMany({ where: { service: 'facebook' } })
      for (const c of allFbCreds) {
        try {
          const data = decryptJSON<{ pageId: string }>(c.credentials)
          if (data.pageId === accountId) {
            clientId = c.clientId
            break
          }
        } catch { /* skip corrupt credentials */ }
      }
    }

    if (!clientId) {
      logger.warn('Meta webhook: no client found for account', { accountId, isInstagram })
      continue
    }

    // DMs — same messaging[] structure for both Facebook (Messenger) and Instagram
    for (const event of (entry.messaging || [])) {
      await forwardEngagementEvent(clientId, {
        type: 'dm',
        platform: isInstagram ? 'instagram' : 'facebook',
        senderId: event.sender?.id,
        recipientId: event.recipient?.id,
        message: event.message?.text || '',
        messageId: event.message?.mid,
        timestamp: event.timestamp
      })
    }

    // Facebook feed comments + Instagram DMs delivered via page changes
    if (!isInstagram) {
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

        // Instagram DMs arrive as object=page with changes[].field=messages
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

    // Instagram comments
    if (isInstagram) {
      for (const change of (entry.changes || [])) {
        if (change.field === 'comments') {
          const value = change.value as IgCommentValue
          await forwardEngagementEvent(clientId, {
            type: 'comment',
            platform: 'instagram',
            senderId: value.from?.id,
            senderName: value.from?.username,
            message: value.text || '',
            postId: value.media?.id,
            commentId: value.id,
          })
        }
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

interface IgCommentValue {
  from?: { id: string; username?: string }
  media?: { id: string; media_product_type?: string }
  id?: string
  text?: string
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
