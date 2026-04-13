import axios from 'axios'
import { prisma } from '../lib/prisma'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'

export type MessageChannel = 'whatsapp' | 'instagram' | 'facebook'

interface SendMessageParams {
  clientId: string
  channel: MessageChannel
  recipientId: string
  text: string
  quickReplies?: string[]
}

interface SendResult {
  success: boolean
  messageId?: string
  error?: string
}

interface FacebookCredentials {
  pageId: string
  accessToken: string
}

interface InstagramCredentials {
  igUserId: string
  accessToken: string
  pageAccessToken?: string
}

interface WhatsAppCredentials {
  phoneNumberId: string
  wabaId: string
  accessToken: string
}

const META_GRAPH_URL = 'https://graph.facebook.com/v19.0'

class MessagingService {
  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const { clientId, channel, recipientId, text, quickReplies } = params

    try {
      switch (channel) {
        case 'facebook':
          return await this.sendFacebookDM(clientId, recipientId, text, quickReplies)
        case 'instagram':
          return await this.sendInstagramDM(clientId, recipientId, text, quickReplies)
        case 'whatsapp':
          return await this.sendWhatsAppMessage(clientId, recipientId, text, quickReplies)
        default:
          return { success: false, error: `Unsupported channel: ${channel}` }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const axiosError = err as { response?: { status?: number; data?: unknown } }
      logger.error('MessagingService.sendMessage failed', {
        clientId, channel, recipientId,
        error: message,
        status: axiosError.response?.status,
        metaError: axiosError.response?.data
      })
      return { success: false, error: message }
    }
  }

  private async getCredentials<T>(clientId: string, service: string): Promise<T | null> {
    const cred = await prisma.clientCredential.findFirst({
      where: { clientId, service }
    })
    if (!cred) return null
    return decryptJSON<T>(cred.credentials)
  }

  private async sendFacebookDM(
    clientId: string,
    recipientId: string,
    text: string,
    quickReplies?: string[]
  ): Promise<SendResult> {
    const creds = await this.getCredentials<FacebookCredentials>(clientId, 'facebook')
    if (!creds) return { success: false, error: 'No Facebook credentials found' }

    const messagePayload: Record<string, unknown> = { text }
    if (quickReplies?.length) {
      messagePayload.quick_replies = quickReplies.map(label => ({
        content_type: 'text',
        title: label,
        payload: label
      }))
    }

    const res = await axios.post(
      `${META_GRAPH_URL}/me/messages`,
      { recipient: { id: recipientId }, message: messagePayload },
      { headers: { Authorization: `Bearer ${creds.accessToken.trim()}` } }
    )

    return { success: true, messageId: res.data?.message_id }
  }

  private async sendInstagramDM(
    clientId: string,
    recipientId: string,
    text: string,
    quickReplies?: string[]
  ): Promise<SendResult> {
    // Instagram DMs use POST /{ig-user-id}/messages (NOT /me/messages)
    const igCreds = await this.getCredentials<InstagramCredentials>(clientId, 'instagram')
    const fbCreds = await this.getCredentials<FacebookCredentials>(clientId, 'facebook')
    const accessToken = igCreds?.pageAccessToken || igCreds?.accessToken || fbCreds?.accessToken
    if (!accessToken) return { success: false, error: 'No Instagram credentials found' }

    const igUserId = igCreds?.igUserId
    if (!igUserId) return { success: false, error: 'No Instagram user ID found — reconnect Instagram in Settings' }

    const messagePayload: Record<string, unknown> = { text }
    if (quickReplies?.length) {
      messagePayload.quick_replies = quickReplies.map(label => ({
        content_type: 'text',
        title: label,
        payload: label
      }))
    }

    const res = await axios.post(
      `${META_GRAPH_URL}/${igUserId}/messages`,
      { recipient: { id: recipientId }, message: messagePayload },
      { headers: { Authorization: `Bearer ${accessToken.trim()}` } }
    )

    return { success: true, messageId: res.data?.message_id }
  }

  private async sendWhatsAppMessage(
    clientId: string,
    recipientId: string,
    text: string,
    quickReplies?: string[]
  ): Promise<SendResult> {
    const creds = await this.getCredentials<WhatsAppCredentials>(clientId, 'whatsapp')
    if (!creds) return { success: false, error: 'No WhatsApp credentials found' }

    let payload: Record<string, unknown>

    if (quickReplies?.length && quickReplies.length <= 3) {
      // WhatsApp interactive buttons (max 3)
      payload = {
        messaging_product: 'whatsapp',
        to: recipientId,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text },
          action: {
            buttons: quickReplies.map((label, i) => ({
              type: 'reply',
              reply: { id: `btn_${i}`, title: label.slice(0, 20) }
            }))
          }
        }
      }
    } else if (quickReplies?.length && quickReplies.length > 3) {
      // WhatsApp list message for more than 3 options
      payload = {
        messaging_product: 'whatsapp',
        to: recipientId,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text },
          action: {
            button: 'Choose an option',
            sections: [{
              title: 'Options',
              rows: quickReplies.map((label, i) => ({
                id: `opt_${i}`,
                title: label.slice(0, 24)
              }))
            }]
          }
        }
      }
    } else {
      payload = {
        messaging_product: 'whatsapp',
        to: recipientId,
        type: 'text',
        text: { body: text }
      }
    }

    const res = await axios.post(
      `${META_GRAPH_URL}/${creds.phoneNumberId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' } }
    )

    return { success: true, messageId: res.data?.messages?.[0]?.id }
  }
}

export const messagingService = new MessagingService()
