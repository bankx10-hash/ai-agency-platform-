import axios from 'axios'
import { logger } from '../utils/logger'

const RETELL_API_KEY = process.env.RETELL_API_KEY || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''

const retellApi = axios.create({
  baseURL: 'https://api.retellai.com',
  headers: {
    Authorization: `Bearer ${RETELL_API_KEY}`,
    'Content-Type': 'application/json'
  }
})

export interface CreateInboundAgentParams {
  prompt: string
  voice: string
  firstSentence: string
  clientId: string
  businessName: string
  transferNumber?: string
  calendarWebhook?: string
}

export interface CreateOutboundAgentParams {
  prompt: string
  voice: string
  firstSentence: string
  clientId: string
  businessName: string
}

export interface VoiceAgentResult {
  agentId: string
  phoneNumber?: string
}

export class VoiceService {
  async createInboundAgent(params: CreateInboundAgentParams): Promise<VoiceAgentResult> {
    const { prompt, voice, firstSentence, clientId, businessName, transferNumber, calendarWebhook } = params

    const agentRes = await retellApi.post('/create-agent', {
      response_engine: { type: 'retell-llm', system_prompt: prompt },
      voice_id: voice || 'eleven_turbo_v2',
      agent_name: `${businessName} Inbound - ${clientId}`,
      begin_message: firstSentence,
      boosted_keywords: [businessName],
      ...(transferNumber && {
        post_call_analysis_data: [{ type: 'string', name: 'transfer_number', description: transferNumber }]
      }),
      ...(calendarWebhook && { webhook_url: calendarWebhook })
    })

    const agentId: string = agentRes.data.agent_id
    logger.info('Retell inbound agent created', { agentId, clientId })

    let phoneNumber: string | undefined
    try {
      const phoneRes = await retellApi.post('/create-phone-number', {
        area_code: 512,
        inbound_agent_id: agentId,
        nickname: `${businessName} - ${clientId}`,
        twilio_account_sid: TWILIO_ACCOUNT_SID,
        twilio_auth_token: TWILIO_AUTH_TOKEN
      })
      phoneNumber = phoneRes.data.phone_number
      logger.info('Twilio phone number provisioned via Retell', { phoneNumber, clientId })
    } catch (error) {
      logger.warn('Failed to provision phone number', { clientId, error })
    }

    return { agentId, phoneNumber }
  }

  async createOutboundAgent(params: CreateOutboundAgentParams): Promise<VoiceAgentResult> {
    const { prompt, voice, firstSentence, clientId, businessName } = params

    const agentRes = await retellApi.post('/create-agent', {
      response_engine: { type: 'retell-llm', system_prompt: prompt },
      voice_id: voice || 'eleven_turbo_v2',
      agent_name: `${businessName} Outbound - ${clientId}`,
      begin_message: firstSentence,
      boosted_keywords: [businessName]
    })

    const agentId: string = agentRes.data.agent_id
    logger.info('Retell outbound agent created', { agentId, clientId })

    return { agentId }
  }

  async launchCall(agentId: string, toNumber: string, fromNumber: string, requestData?: Record<string, unknown>): Promise<string> {
    const res = await retellApi.post('/create-call', {
      agent_id: agentId,
      to_number: toNumber,
      from_number: fromNumber,
      ...(requestData && { metadata: requestData })
    })
    return res.data.call_id
  }

  async getCallTranscript(callId: string): Promise<string> {
    const res = await retellApi.get(`/get-call/${callId}`)
    const transcript = res.data.transcript || ''
    return transcript
  }

  async deleteAgent(agentId: string): Promise<void> {
    await retellApi.delete(`/delete-agent/${agentId}`)
    logger.info('Retell agent deleted', { agentId })
  }
}

export const voiceService = new VoiceService()
