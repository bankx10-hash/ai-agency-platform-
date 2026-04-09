// Retell AI voice service — v1 endpoint names, v2 response_engine format
import axios from 'axios'
import twilio from 'twilio'
import { prisma } from '../lib/prisma'
import { encryptJSON, decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'

const RETELL_API_KEY = process.env.RETELL_API_KEY || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
// SIP credentials Retell uses to authenticate against the Twilio trunk's
// Termination credential list. Required for outbound calls when the trunk
// rejects unauthenticated INVITEs (which it does by default).
const RETELL_SIP_AUTH_USERNAME = process.env.RETELL_SIP_AUTH_USERNAME || ''
const RETELL_SIP_AUTH_PASSWORD = process.env.RETELL_SIP_AUTH_PASSWORD || ''

function getTwilioClient() {
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
}

const DEFAULT_VOICE_ID = '11labs-Cimo'
// Known-valid Retell voice IDs — any value not in this set is replaced with the default
const VALID_VOICE_IDS = new Set([
  '11labs-Cimo',
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
  existingPhoneNumber?: string
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
  voicemailMessage?: string  // spoken when voicemail detected; empty = silent hangup
  tools?: RetellTool[]       // optional custom tools (e.g. calendar booking)
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
    tools?: RetellTool[],
    includeEndCallTool?: boolean
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      model: 'claude-4.5-sonnet',
      general_prompt: systemPrompt
    }
    // Only set begin_message if a first sentence is explicitly provided.
    // For outbound calls where we want voicemail detection to work cleanly,
    // omit begin_message so the agent waits for the human to speak first —
    // that way if the call hits voicemail, Retell's detection has time to
    // fire and play voicemail_message without the agent racing against it.
    if (firstSentence && firstSentence.trim().length > 0) {
      payload.begin_message = firstSentence
    }

    // Assemble the tool list. For outbound agents we always attach the
    // built-in end_call tool so the agent can actively hang up after
    // leaving a voicemail (instead of relying on silence timeouts which
    // let it keep speaking if the model improvises).
    const allTools: Array<Record<string, unknown>> = []
    if (tools && tools.length > 0) {
      allTools.push(...(tools as unknown as Array<Record<string, unknown>>))
    }
    if (includeEndCallTool) {
      allTools.push({
        type: 'end_call',
        name: 'end_call',
        description: 'Hangs up the call immediately. Call this after leaving a voicemail message or when the conversation has naturally concluded. Do not call this while a live human is still speaking.'
      })
    }
    if (allTools.length > 0) {
      payload.general_tools = allTools
    }

    const llmRes = await retellApi.post('/create-retell-llm', payload)
    return llmRes.data.llm_id as string
  }

  async createInboundAgent(params: CreateInboundAgentParams): Promise<VoiceAgentResult> {
    const { prompt, voice, firstSentence, clientId, businessName, transferNumber, callWebhook, country, tools, address, existingPhoneNumber } = params
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

    // Reuse existing phone number on redeploy — just re-link to new agent in Retell
    if (existingPhoneNumber) {
      phoneNumber = existingPhoneNumber
      logger.info('Reusing existing phone number — updating Retell agent link', { clientId, phoneNumber, agentId })

      try {
        await retellApi.patch(`/update-phone-number/${encodeURIComponent(phoneNumber)}`, {
          inbound_agents: [{ agent_id: agentId, weight: 1 }]
        })
        logger.info('Phone number re-linked to new Retell agent', { clientId, phoneNumber, agentId })
      } catch (relinkErr) {
        logger.error('Failed to re-link phone number to new agent', { clientId, phoneNumber, agentId, error: relinkErr })
      }
    } else if (!provisionNumbers) {
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
          ...(RETELL_SIP_AUTH_USERNAME && { sip_trunk_auth_username: RETELL_SIP_AUTH_USERNAME }),
          ...(RETELL_SIP_AUTH_PASSWORD && { sip_trunk_auth_password: RETELL_SIP_AUTH_PASSWORD }),
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

  /**
   * Look up the client's inbound voice agent number — the number callers
   * can use to reach the client's receptionist. This is the number leads
   * are asked to call back on when a closer/outbound call goes to voicemail.
   * Searches the VOICE_INBOUND deployment config AND ClientCredential rows.
   */
  async getInboundCallbackNumber(clientId: string): Promise<string | undefined> {
    try {
      const inboundDeployment = await prisma.agentDeployment.findFirst({
        where: { clientId, agentType: 'VOICE_INBOUND' as never },
        orderBy: { createdAt: 'desc' }
      })
      const inboundConfig = (inboundDeployment?.config as Record<string, unknown>) || {}
      const candidates = [
        inboundConfig.phone_number,
        inboundConfig.phoneNumber,
        (inboundConfig.address as Record<string, unknown> | undefined)?.phone_number,
      ]
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim().length > 0) return c.trim()
      }
      // Fall back to credential store
      const creds = await prisma.clientCredential.findMany({
        where: {
          clientId,
          OR: [
            { service: 'retell-inbound' },
            { service: 'twilio-phone' },
            { service: { startsWith: 'voice-inbound-' } },
            { service: { startsWith: 'twilio-phone-' } }
          ]
        }
      })
      for (const cred of creds) {
        try {
          const data = decryptJSON<{ phoneNumber?: string; phone_number?: string }>(cred.credentials)
          const num = data.phoneNumber || data.phone_number
          if (num) return num
        } catch { continue }
      }
    } catch (err) {
      logger.warn('Failed to look up inbound callback number', { clientId, err: String(err) })
    }
    return undefined
  }

  /**
   * Build the standard voicemail message used by ALL outbound agents
   * (closer, voice-outbound, receptionist-followup, etc.). Single source
   * of truth — every outbound agent that hits voicemail says the same
   * thing with the client's inbound receptionist number as the callback.
   */
  buildVoicemailMessage(businessName: string, inboundCallbackNumber: string): string {
    return `Hi, this is Sarah from ${businessName}. I was calling for our scheduled chat but looks like I missed you. To reschedule, please give us a call back on ${inboundCallbackNumber} and we will sort out a new time. Thanks!`
  }

  /**
   * Build the voicemail behaviour block that gets injected into an outbound
   * agent's system prompt. When Retell detects voicemail, it plays the
   * recorded voicemail_message. When detection fails and the agent is left
   * talking to a voicemail machine, this block tells it what to say and
   * instructs it to invoke the end_call tool immediately after. Belt-and-
   * braces: both Retell's detection AND the agent's own behaviour deliver
   * the same message with the same callback number.
   */
  buildVoicemailPromptBlock(businessName: string, inboundCallbackNumber: string): string {
    const voicemailLine = this.buildVoicemailMessage(businessName, inboundCallbackNumber)
    return `\n\n# VOICEMAIL HANDLING\nIf the call is answered by anything non-human — an automated greeting, a pre-recorded message, music on hold, a beep, or a pause longer than 4 seconds with no live response — say ONLY this exact sentence:\n\n"${voicemailLine}"\n\nImmediately after speaking that sentence, invoke the end_call function to hang up. One sentence, then end_call. Nothing else.\n`
  }

  async createOutboundAgent(params: CreateOutboundAgentParams): Promise<VoiceAgentResult> {
    const { prompt, voice, firstSentence, clientId, businessName, callWebhook, voicemailMessage, tools } = params

    // Resolve the inbound callback number — required for ALL outbound agents
    // so voicemail messages always direct leads to the client's receptionist.
    const inboundCallbackNumber = await this.getInboundCallbackNumber(clientId)
    if (!inboundCallbackNumber) {
      throw new Error(
        'Outbound agent cannot deploy without a Voice Inbound agent that has a phone number provisioned. ' +
        'The voicemail message must direct unanswered leads to the inbound number to reschedule. ' +
        'Deploy Voice Inbound first.'
      )
    }

    // Standard voicemail message — same across all outbound agents / packages
    const standardVoicemailMessage = voicemailMessage || this.buildVoicemailMessage(businessName, inboundCallbackNumber)

    // Inject the voicemail behavior block into the system prompt so the
    // agent also knows what to say if Retell's detection misses voicemail.
    const promptWithVoicemail = prompt + this.buildVoicemailPromptBlock(businessName, inboundCallbackNumber)

    logger.info('Creating outbound agent with standard voicemail', {
      clientId,
      inboundCallbackNumber,
      voicemailMessagePreview: standardVoicemailMessage.substring(0, 80)
    })

    // Step 1: create the LLM — include the built-in end_call tool so the
    // agent can hang up itself after finishing a voicemail message, plus
    // any custom tools the caller passed (e.g. calendar booking for
    // outbound agents that need to book appointments mid-call).
    const llmId = await this.createRetellLlm(promptWithVoicemail, firstSentence, tools, true)
    logger.info('Retell LLM created for outbound agent', { llmId, clientId })

    // Step 2: create the agent (with voicemail detection for outbound agents)
    const agentRes = await retellApi.post('/create-agent', {
      response_engine: { type: 'retell-llm', llm_id: llmId },
      voice_id: sanitizeVoiceId(voice),
      agent_name: `${businessName} Outbound - ${clientId}`,
      boosted_keywords: [businessName],
      // Voicemail detection — leave a message if we reach voicemail
      enable_voicemail_detection: true,
      voicemail_detection_timeout_ms: 30000,
      voicemail_message: standardVoicemailMessage,
      // 10 seconds is Retell's minimum. After the agent says its voicemail
      // line, this timer starts counting down silence — voicemail doesn't
      // respond, so the call ends 10s later.
      end_call_after_silence_ms: 10000,
      ...(callWebhook && { webhook_url: callWebhook })
    })

    const agentId: string = agentRes.data.agent_id
    logger.info('Retell outbound agent created', { agentId, clientId })

    return { agentId }
  }

  /**
   * Provision a dedicated outbound phone number for a client (used by closer + receptionist followup).
   * Retell numbers are inbound XOR outbound, so outbound agents need their own number.
   * Saves to ClientCredential under the supplied service key. Idempotent — returns existing if found.
   */
  async provisionOutboundPhoneNumber(params: {
    clientId: string
    businessName: string
    country?: string
    address?: { street: string; city: string; state?: string; postcode?: string }
    credentialService: string  // e.g. 'closer-outbound-phone' or 'receptionist-outbound-phone'
    retellAgentId?: string     // optional — link the imported number to this outbound agent
  }): Promise<string | undefined> {
    const { clientId, businessName, country = 'AU', address, credentialService, retellAgentId } = params
    const provisionNumbers = process.env.VOICE_PROVISION_NUMBERS !== 'false'

    // Reuse existing if already provisioned (idempotent on redeploy)
    const existing = await prisma.clientCredential.findFirst({
      where: { clientId, service: credentialService },
      select: { credentials: true }
    })
    if (existing) {
      try {
        const decrypted = JSON.parse(existing.credentials) as { phoneNumber?: string }
        if (decrypted.phoneNumber) {
          logger.info('Reusing existing outbound phone number', { clientId, credentialService, phoneNumber: decrypted.phoneNumber })
          return decrypted.phoneNumber
        }
      } catch { /* fall through to provision */ }
    }

    if (!provisionNumbers) {
      logger.info('Outbound phone provisioning disabled (VOICE_PROVISION_NUMBERS=false)', { clientId, credentialService })
      return undefined
    }

    let phoneNumber: string | undefined

    try {
      if (country === 'AU') {
        const twilioClient = getTwilioClient()
        const bundleSid = process.env.TWILIO_BUNDLE_SID
        let addressSid = process.env.TWILIO_BUNDLE_ADDRESS_SID

        if (!addressSid && address?.street && address?.city) {
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
          } catch (addrError) {
            logger.warn('Outbound: address creation failed', { clientId, addrError })
            const list = await twilioClient.addresses.list({ customerName: businessName, limit: 1 })
            if (list.length) addressSid = list[0].sid
          }
        }
        if (!addressSid) throw new Error('No Twilio address available for AU outbound number purchase')

        const mobileNumbers = await twilioClient.availablePhoneNumbers('AU').mobile.list({ limit: 1, voiceEnabled: true, smsEnabled: true })
        const localNumbers = mobileNumbers.length
          ? []
          : await twilioClient.availablePhoneNumbers('AU').local.list({ limit: 1, voiceEnabled: true })
        const available: { phoneNumber: string }[] = mobileNumbers.length ? mobileNumbers : localNumbers
        if (!available.length) throw new Error('No Australian Twilio numbers available for outbound')

        const trunkSid = process.env.TWILIO_SIP_TRUNK_SID
        if (!trunkSid) throw new Error('TWILIO_SIP_TRUNK_SID env var not set')

        const purchased = await twilioClient.incomingPhoneNumbers.create({
          phoneNumber: available[0].phoneNumber,
          friendlyName: `${businessName} Outbound (${credentialService}) - ${clientId}`,
          trunkSid,
          addressSid,
          ...(bundleSid && { bundleSid })
        })
        phoneNumber = purchased.phoneNumber
        logger.info('AU outbound number purchased', { phoneNumber, clientId, credentialService })

        const trunk = await twilioClient.trunking.v1.trunks(trunkSid).fetch()
        const terminationUri = trunk.domainName
        if (!terminationUri) throw new Error('Twilio SIP trunk has no domain name configured')

        // Import to Retell as an outbound number — link to the outbound agent if provided
        await retellApi.post('/import-phone-number', {
          phone_number: phoneNumber,
          termination_uri: terminationUri,
          ...(RETELL_SIP_AUTH_USERNAME && { sip_trunk_auth_username: RETELL_SIP_AUTH_USERNAME }),
          ...(RETELL_SIP_AUTH_PASSWORD && { sip_trunk_auth_password: RETELL_SIP_AUTH_PASSWORD }),
          ...(retellAgentId && { outbound_agent_id: retellAgentId }),
          nickname: `${businessName} Outbound - ${clientId}`
        })
        logger.info('AU outbound number imported to Retell', { phoneNumber, clientId, credentialService })
      } else {
        // US/CA: Retell auto-provisions via Twilio
        const phoneRes = await retellApi.post('/create-phone-number', {
          area_code: 512,
          ...(retellAgentId && { outbound_agents: [{ agent_id: retellAgentId, weight: 1 }] }),
          nickname: `${businessName} Outbound - ${clientId}`,
          twilio_account_sid: TWILIO_ACCOUNT_SID,
          twilio_auth_token: TWILIO_AUTH_TOKEN
        })
        phoneNumber = phoneRes.data.phone_number
        logger.info('Outbound phone number provisioned via Retell', { phoneNumber, clientId, credentialService })
      }

      // Save the provisioned number under the supplied credential service key
      if (phoneNumber) {
        await prisma.clientCredential.create({
          data: {
            clientId,
            service: credentialService,
            credentials: JSON.stringify({ phoneNumber })
          }
        })
      }
    } catch (error) {
      logger.error('Failed to provision outbound phone number', { clientId, credentialService, error })
    }

    return phoneNumber
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
    const res = await retellApi.get(`/v2/get-call/${callId}`)
    const transcript = res.data.transcript || ''
    return transcript
  }

  async getAgent(agentId: string): Promise<Record<string, unknown>> {
    const res = await retellApi.get(`/get-agent/${agentId}`)
    return res.data
  }

  async deleteAgent(agentId: string): Promise<void> {
    await retellApi.delete(`/delete-agent/${agentId}`)
    logger.info('Retell agent deleted', { agentId })
  }
}

export const voiceService = new VoiceService()
