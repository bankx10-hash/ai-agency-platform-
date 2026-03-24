// Retell AI voice service — v1 endpoint names, v2 response_engine format
import axios from 'axios'
import twilio from 'twilio'
import { logger } from '../utils/logger'

const RETELL_API_KEY = process.env.RETELL_API_KEY || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''

function getTwilioClient() {
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
}

const DEFAULT_VOICE_ID = '11labs-Adrian'
// Known-valid Retell voice IDs — any value not in this set is replaced with the default
const VALID_VOICE_IDS = new Set([
  '11labs-Adrian',
  '11labs-MyrtleInevitable',
  '11labs-Myrtleinev',
  'openai-alloy',
  'openai-echo',
  'openai-fable',
  'openai-onyx',
  'openai-nova',
  'openai-shimmer',
  'deepgram-aura-asteria-en',
  'deepgram-aura-luna-en',
  'deepgram-aura-stella-en',
  'deepgram-aura-athena-en',
  'deepgram-aura-hera-en',
  'deepgram-aura-orion-en',
  'deepgram-aura-arcas-en',
  'deepgram-aura-perseus-en',
  'deepgram-aura-angus-en',
  'deepgram-aura-orpheus-en',
  'deepgram-aura-helios-en',
  'deepgram-aura-zeus-en',
])

function sanitizeVoiceId(voiceId: string | undefined): string {
  if (!voiceId || !VALID_VOICE_IDS.has(voiceId)) return DEFAULT_VOICE_ID
  return voiceId
}

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
  country?: string
  address?: {
    street: string
    city: string
    state?: string
    postcode?: string
  }
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
  /**
   * Creates a Retell LLM (v2) and returns its llm_id.
   * Retell v2 requires LLM creation as a separate step before agent creation.
   */
  private async createRetellLlm(systemPrompt: string, firstSentence: string): Promise<string> {
    const llmRes = await retellApi.post('/create-retell-llm', {
      model: 'claude-4.5-sonnet',
      general_prompt: systemPrompt,
      begin_message: firstSentence
    })
    return llmRes.data.llm_id as string
  }

  async createInboundAgent(params: CreateInboundAgentParams): Promise<VoiceAgentResult> {
    const { prompt, voice, firstSentence, clientId, businessName, transferNumber, calendarWebhook, country, address } = params
    const clientCountry = (country || 'AU').toUpperCase()

    // Step 1: create the LLM with the system prompt
    const llmId = await this.createRetellLlm(prompt, firstSentence)
    logger.info('Retell LLM created', { llmId, clientId })

    // Step 2: create the agent linked to the LLM
    const agentRes = await retellApi.post('/create-agent', {
      response_engine: { type: 'retell-llm', llm_id: llmId },
      voice_id: sanitizeVoiceId(voice),
      agent_name: `${businessName} Inbound - ${clientId}`,
      boosted_keywords: [businessName],
      ...(calendarWebhook && { webhook_url: calendarWebhook }),
      ...(transferNumber && {
        post_call_analysis_data: [{ type: 'string', name: 'transfer_number', description: transferNumber }]
      })
    })

    const agentId: string = agentRes.data.agent_id
    logger.info('Retell inbound agent created', { agentId, clientId })

    let phoneNumber: string | undefined
    const provisionNumbers = process.env.VOICE_PROVISION_NUMBERS !== 'false'

    if (!provisionNumbers) {
      logger.info('Phone number provisioning disabled (VOICE_PROVISION_NUMBERS=false)', { clientId })
    } else try {
      if (clientCountry === 'AU') {
        // Retell only supports US/CA auto-provisioning.
        // For AU: buy from Twilio directly, then import into Retell.
        const twilioClient = getTwilioClient()

        // Create a Twilio address for this client (required for AU number purchase)
        let addressSid: string | undefined
        if (address?.street && address?.city) {
          const created = await twilioClient.addresses.create({
            customerName: businessName,
            street: address.street,
            city: address.city,
            region: address.state || '',
            postalCode: address.postcode || '',
            isoCountry: 'AU'
          })
          addressSid = created.sid
          logger.info('Twilio address created for AU client', { addressSid, clientId })
        }

        const available = await twilioClient.availablePhoneNumbers('AU').local.list({ limit: 1 })
        if (!available.length) throw new Error('No Australian Twilio numbers available')

        const trunkSid = process.env.TWILIO_SIP_TRUNK_SID
        if (!trunkSid) throw new Error('TWILIO_SIP_TRUNK_SID env var not set')

        const purchased = await twilioClient.incomingPhoneNumbers.create({
          phoneNumber: available[0].phoneNumber,
          friendlyName: `${businessName} - ${clientId}`,
          trunkSid,
          ...(addressSid && { addressSid })
        })
        phoneNumber = purchased.phoneNumber
        logger.info('AU Twilio number purchased and configured with SIP trunk', { phoneNumber, trunkSid, clientId })

        // Import into Retell and link to agent.
        // termination_uri = Twilio SIP trunk domain name
        const trunk = await twilioClient.trunking.v1.trunks(trunkSid).fetch()
        const terminationUri = trunk.domainName
        if (!terminationUri) throw new Error('Twilio SIP trunk has no domain name configured')

        logger.info('Using SIP trunk termination URI', { terminationUri, clientId })

        await retellApi.post('/import-phone-number', {
          phone_number: phoneNumber,
          termination_uri: terminationUri,
          inbound_agent_id: agentId,
          nickname: `${businessName} - ${clientId}`
        })
        logger.info('AU number imported to Retell and linked to agent', { phoneNumber, clientId })
      } else {
        // US/CA: Retell auto-provisions via Twilio
        const phoneRes = await retellApi.post('/create-phone-number', {
          area_code: 512,
          inbound_agent_id: agentId,
          nickname: `${businessName} - ${clientId}`,
          twilio_account_sid: TWILIO_ACCOUNT_SID,
          twilio_auth_token: TWILIO_AUTH_TOKEN
        })
        phoneNumber = phoneRes.data.phone_number
        logger.info('Phone number provisioned via Retell', { phoneNumber, clientId })
      }
    } catch (error) {
      logger.warn('Failed to provision phone number', { clientId, country: clientCountry, error })
    }

    return { agentId, phoneNumber }
  }

  async createOutboundAgent(params: CreateOutboundAgentParams): Promise<VoiceAgentResult> {
    const { prompt, voice, firstSentence, clientId, businessName } = params

    // Step 1: create the LLM
    const llmId = await this.createRetellLlm(prompt, firstSentence)
    logger.info('Retell LLM created for outbound agent', { llmId, clientId })

    // Step 2: create the agent
    const agentRes = await retellApi.post('/create-agent', {
      response_engine: { type: 'retell-llm', llm_id: llmId },
      voice_id: sanitizeVoiceId(voice),
      agent_name: `${businessName} Outbound - ${clientId}`,
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
