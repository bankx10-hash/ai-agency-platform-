// Retell AI voice service — v1 endpoint names, v2 response_engine format
import axios from 'axios'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'
import { encryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'

const prisma = new PrismaClient()

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

export interface RetellTool {
  type: 'custom'
  name: string
  description: string
  url: string
  speak_during_execution: boolean
  speak_after_execution: boolean
  execution_message_description: string
  timeout_ms?: number
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
}

export interface CreateInboundAgentParams {
  prompt: string
  voice: string
  firstSentence: string
  clientId: string
  businessName: string
  transferNumber?: string
  callWebhook?: string
  country?: string
  tools?: RetellTool[]
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
  callWebhook?: string
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
  private async createRetellLlm(
    systemPrompt: string,
    firstSentence: string,
    tools?: RetellTool[]
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      model: 'claude-4.5-sonnet',
      general_prompt: systemPrompt,
      begin_message: firstSentence
    }
    if (tools && tools.length > 0) {
      payload.general_tools = tools
    }
    const llmRes = await retellApi.post('/create-retell-llm', payload)
    return llmRes.data.llm_id as string
  }

  async createInboundAgent(params: CreateInboundAgentParams): Promise<VoiceAgentResult> {
    const { prompt, voice, firstSentence, clientId, businessName, transferNumber, callWebhook, country, tools, address } = params
    const clientCountry = (country || 'AU').toUpperCase()

    // Step 1: create the LLM with the system prompt (and optional tools)
    const llmId = await this.createRetellLlm(prompt, firstSentence, tools)
    logger.info('Retell LLM created', { llmId, clientId })

    // Step 2: create the agent linked to the LLM
    const agentRes = await retellApi.post('/create-agent', {
      response_engine: { type: 'retell-llm', llm_id: llmId },
      voice_id: sanitizeVoiceId(voice),
      agent_name: `${businessName} Inbound - ${clientId}`,
      boosted_keywords: [businessName],
      ...(callWebhook && { webhook_url: callWebhook }),
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

        // AU number purchase requires both bundleSid (regulatory) and addressSid (physical).
        // The addressSid must already be inside the approved bundle — we look it up rather
        // than creating a fresh one that would be rejected as "not contained in bundle".
        const bundleSid = process.env.TWILIO_BUNDLE_SID
        let addressSid: string | undefined

        if (bundleSid) {
          // The addressSid must be the address already enrolled in the approved bundle.
          // Set TWILIO_BUNDLE_ADDRESS_SID in Railway to the AD... SID from:
          // Twilio Console → Phone Numbers → Regulatory Compliance → your bundle → Addresses
          addressSid = process.env.TWILIO_BUNDLE_ADDRESS_SID
          if (addressSid) {
            logger.info('Using bundle address for AU number purchase', { addressSid, bundleSid, clientId })
          } else {
            logger.warn('TWILIO_BUNDLE_ADDRESS_SID not set — number purchase will fail', { clientId })
          }
        } else {
          // No bundle — create a per-client address (legacy / non-regulated flow)
          logger.info('AU address params (no bundle)', { address, clientId })
          if (address?.street && address?.city) {
            try {
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
            } catch (addrError) {
              logger.warn('Address creation failed, searching for existing address', { clientId, addrError })
              const existing = await twilioClient.addresses.list({ customerName: businessName, limit: 1 })
              if (existing.length) {
                addressSid = existing[0].sid
                logger.info('Using existing Twilio address', { addressSid, clientId })
              }
            }
          } else {
            logger.warn('Address missing or incomplete — skipping address creation', { address, clientId })
          }
        }

        if (!addressSid) throw new Error('No Twilio address available for AU number purchase')

        // Prefer AU mobile numbers — they support both voice and SMS (needed for appointment SMS)
        // Fall back to local voice-only numbers if no mobile available
        logger.info('Searching for available AU mobile numbers with voice + SMS', { clientId })
        const mobileNumbers = await twilioClient.availablePhoneNumbers('AU').mobile.list({ limit: 1, voiceEnabled: true, smsEnabled: true })
        const localNumbers = mobileNumbers.length
          ? []
          : await twilioClient.availablePhoneNumbers('AU').local.list({ limit: 1, voiceEnabled: true })
        const available: { phoneNumber: string }[] = mobileNumbers.length ? mobileNumbers : localNumbers
        if (mobileNumbers.length) {
          logger.info('Found AU mobile number with SMS capability', { clientId, number: mobileNumbers[0].phoneNumber })
        } else {
          logger.warn('No AU mobile numbers with SMS found — falling back to local voice-only', { clientId })
          logger.info('AU local number search result', { clientId, found: localNumbers.length, number: localNumbers[0]?.phoneNumber })
        }
        if (!available.length) throw new Error('No Australian Twilio numbers available')

        const trunkSid = process.env.TWILIO_SIP_TRUNK_SID
        logger.info('SIP trunk SID check', { clientId, trunkSid: trunkSid ? `${trunkSid.substring(0, 6)}...` : 'MISSING' })
        if (!trunkSid) throw new Error('TWILIO_SIP_TRUNK_SID env var not set')

        const smsWebhookUrl = `${process.env.API_URL || 'https://api.nodusaisystems.com'}/sms/webhook`
        logger.info('Purchasing AU number', { clientId, phoneNumber: available[0].phoneNumber })
        const purchased = await twilioClient.incomingPhoneNumbers.create({
          phoneNumber: available[0].phoneNumber,
          friendlyName: `${businessName} - ${clientId}`,
          trunkSid,
          smsUrl: smsWebhookUrl,
          smsMethod: 'POST',
          addressSid,
          ...(bundleSid && { bundleSid })
        })
        phoneNumber = purchased.phoneNumber
        logger.info('AU Twilio number purchased and configured with SIP trunk', { phoneNumber, trunkSid, clientId })

        // Import into Retell and link to agent.
        // termination_uri = Twilio SIP trunk domain name
        logger.info('Fetching SIP trunk domain', { clientId, trunkSid })
        const trunk = await twilioClient.trunking.v1.trunks(trunkSid).fetch()
        const terminationUri = trunk.domainName
        logger.info('SIP trunk domain', { clientId, terminationUri: terminationUri || 'EMPTY' })
        if (!terminationUri) throw new Error('Twilio SIP trunk has no domain name configured')

        logger.info('Using SIP trunk termination URI', { terminationUri, clientId })

        await retellApi.post('/import-phone-number', {
          phone_number: phoneNumber,
          termination_uri: terminationUri,
          inbound_agents: [{ agent_id: agentId, weight: 1 }],
          nickname: `${businessName} - ${clientId}`
        })
        logger.info('AU number imported to Retell and linked to agent', { phoneNumber, clientId })

        // Save phone number so outbound SMS can use it as the `from` number
        await prisma.clientCredential.upsert({
          where: { id: `twilio-phone-${clientId}` },
          update: { credentials: encryptJSON({ phoneNumber }) },
          create: { id: `twilio-phone-${clientId}`, clientId, service: 'twilio-phone', credentials: encryptJSON({ phoneNumber }) }
        })
      } else {
        // US/CA: Retell auto-provisions via Twilio
        const phoneRes = await retellApi.post('/create-phone-number', {
          area_code: 512,
          inbound_agents: [{ agent_id: agentId, weight: 1 }],
          nickname: `${businessName} - ${clientId}`,
          twilio_account_sid: TWILIO_ACCOUNT_SID,
          twilio_auth_token: TWILIO_AUTH_TOKEN
        })
        phoneNumber = phoneRes.data.phone_number
        logger.info('Phone number provisioned via Retell', { phoneNumber, clientId })

        // Save phone number so outbound SMS can use it as the `from` number
        await prisma.clientCredential.upsert({
          where: { id: `twilio-phone-${clientId}` },
          update: { credentials: encryptJSON({ phoneNumber }) },
          create: { id: `twilio-phone-${clientId}`, clientId, service: 'twilio-phone', credentials: encryptJSON({ phoneNumber }) }
        })
      }
    } catch (error) {
      logger.warn('Failed to provision phone number', { clientId, country: clientCountry, error })
    }

    return { agentId, phoneNumber }
  }

  async createOutboundAgent(params: CreateOutboundAgentParams): Promise<VoiceAgentResult> {
    const { prompt, voice, firstSentence, clientId, businessName, callWebhook } = params

    // Step 1: create the LLM
    const llmId = await this.createRetellLlm(prompt, firstSentence)
    logger.info('Retell LLM created for outbound agent', { llmId, clientId })

    // Step 2: create the agent
    const agentRes = await retellApi.post('/create-agent', {
      response_engine: { type: 'retell-llm', llm_id: llmId },
      voice_id: sanitizeVoiceId(voice),
      agent_name: `${businessName} Outbound - ${clientId}`,
      boosted_keywords: [businessName],
      ...(callWebhook && { webhook_url: callWebhook })
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
