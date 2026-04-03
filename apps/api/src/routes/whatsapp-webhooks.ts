import express from 'express'
import { prisma } from '../lib/prisma'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'
import { workflowEngine } from '../services/workflow-engine.service'

const router = express.Router()

router.use(express.json({ limit: '1mb' }))

// ─── Webhook Verification (GET) ──────────────────────────────────────────────
// WhatsApp Cloud API sends a GET for webhook verification — same Meta pattern.
router.get('/', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || 'nodus_engage_verify'

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('WhatsApp webhook verified')
    res.status(200).send(challenge)
  } else {
    logger.warn('WhatsApp webhook verification failed', { mode, token })
    res.sendStatus(403)
  }
})

// ─── Webhook Event Handler (POST) ────────────────────────────────────────────
router.post('/', async (req, res) => {
  // Always ack immediately — Meta retries if we don't respond within 20s
  res.sendStatus(200)

  try {
    const body = req.body
    if (body?.object !== 'whatsapp_business_account') {
      logger.warn('WhatsApp webhook ignored — unexpected object type', { object: body?.object })
      return
    }

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'messages') continue

        const value = change.value
        const phoneNumberId = value?.metadata?.phone_number_id
        if (!phoneNumberId) continue

        // Look up client by phone_number_id in ClientCredential
        const clientId = await findClientByPhoneNumberId(phoneNumberId)
        if (!clientId) {
          logger.warn('WhatsApp webhook: no client found for phone_number_id', { phoneNumberId })
          continue
        }

        // Process incoming messages
        for (const message of (value.messages || [])) {
          if (message.type !== 'text' && message.type !== 'interactive') continue

          let messageText = ''
          if (message.type === 'text') {
            messageText = message.text?.body || ''
          } else if (message.type === 'interactive') {
            // Button reply or list reply
            messageText = message.interactive?.button_reply?.title
              || message.interactive?.list_reply?.title
              || ''
          }

          if (!messageText) continue

          const senderId = message.from // phone number
          const senderName = value.contacts?.[0]?.profile?.name

          await workflowEngine.handleIncomingMessage({
            clientId,
            channel: 'whatsapp',
            senderId,
            senderName,
            messageText
          })
        }
      }
    }
  } catch (err) {
    logger.error('WhatsApp webhook processing error', { error: err })
  }
})

async function findClientByPhoneNumberId(phoneNumberId: string): Promise<string | undefined> {
  const allWaCreds = await prisma.clientCredential.findMany({ where: { service: 'whatsapp' } })
  for (const c of allWaCreds) {
    try {
      const data = decryptJSON<{ phoneNumberId: string }>(c.credentials)
      if (data.phoneNumberId === phoneNumberId) {
        return c.clientId
      }
    } catch { /* skip corrupt credentials */ }
  }
  return undefined
}

export default router
