import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { voiceService, RetellTool } from '../services/voice.service'
import { calendarService } from '../services/calendar.service'
import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

const prisma = new PrismaClient()

export interface VoiceInboundConfig {
  greeting_script: string
  qualification_questions: string[]
  faq_knowledge_base: string
  escalation_number: string
  voice_id: string
  calendar_id: string
  booking_link?: string
  locationId: string
  businessName: string
  country?: string
  address?: {
    street: string
    city: string
    state?: string
    postcode?: string
  }
}

export class VoiceInboundAgent extends BaseAgent {
  agentType = AgentType.VOICE_INBOUND

  generatePrompt(config: Partial<VoiceInboundConfig>, contactData?: Record<string, unknown>): string {
    const caller = contactData || {}

    return `You are a professional AI receptionist for ${config.businessName || 'our business'}. You are answering a live phone call right now.

Greeting: ${config.greeting_script || `Thank you for calling ${config.businessName}. How can I help you today?`}

Your qualification questions to work through naturally:
${(config.qualification_questions || []).map((q, i) => `${i + 1}. ${q}`).join('\n')}

Knowledge base:
${config.faq_knowledge_base || 'Answer common questions about the business.'}

Call handling rules:
1. Always greet warmly and professionally
2. Listen actively — do not interrupt
3. Early in every call, collect the caller's name, phone number, and email address — ask for each one at a time, never skip email
4. If caller wants to book an appointment: use the check_availability tool to find open slots, present them clearly, then use book_appointment once they confirm a time — name/email should already be collected
5. If no calendar tool is available and caller wants to book: ensure you have their name and email, then let them know you will send them a booking link immediately after the call
6. If question not in knowledge base: say you will have someone call back and take their contact info
7. If caller is upset or frustrated: empathise, then offer to connect them with a human (transfer to ${config.escalation_number || 'manager'})
8. Keep calls focused but never rushed
9. Always end with a clear next step

Caller context:
${JSON.stringify(caller, null, 2)}

Respond naturally as if in a real phone conversation.`
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    const typedConfig = config as unknown as VoiceInboundConfig
    logger.info('Deploying Voice Inbound Agent', { clientId })

    // Check calendar provider before generating prompt so we can embed correct booking instructions
    const calendarProvider = await calendarService.getCalendarProvider(clientId)
    const bookingInstruction = calendarProvider
      ? `You have access to real-time calendar availability. When a caller wants to book an appointment, use the check_availability tool to fetch open slots, present them clearly, collect the caller's name and email, confirm the chosen slot, then use the book_appointment tool to lock it in and send a confirmation email.`
      : typedConfig.booking_link
        ? `When a caller wants to book, collect their name and email and let them know you will send a booking link to their email right after the call.`
        : `When a caller wants to book, collect their name and email and let them know someone will follow up to confirm a time.`

    const voicePrompt = await this.callClaude(
      `Create a concise, focused AI phone receptionist script for ${typedConfig.businessName}.

       PERSONALITY: Warm but efficient. Short responses. Never ramble. Every sentence has a purpose.

       PRIORITY ORDER — the agent must do these in order on every call:
       1. Greet with: "${typedConfig.greeting_script}"
       2. Ask why they are calling (one sentence)
       3. Collect their name, phone number, and email address — ask for each one at a time, do not skip any of these three fields
       4. Ask the qualification questions ONE AT A TIME — do not ask more than one at once: ${typedConfig.qualification_questions.join(', ')}
       5. ${bookingInstruction}
       6. End the call with a clear next step

       RESPONSE STYLE RULES — follow these strictly:
       - Maximum 2 sentences per response
       - Brief warm acknowledgements are fine ("Wonderful!", "Great!") but never more than 3 words — then immediately move to the next question or action
       - Never repeat back what the caller just said at length
       - Do not explain the business unless directly asked
       - Do not ask non-essential questions like "how did you hear about us"
       - Always move the conversation forward — every response should either collect missing info or progress toward booking

       FAQ knowledge base (only use if caller asks a direct question):
       ${typedConfig.faq_knowledge_base}

       Escalation: if caller is upset or asks for a human, offer to transfer to ${typedConfig.escalation_number || 'a team member'}.

       IDENTITY RULES:
       - You represent ${typedConfig.businessName} only — never mention AI platforms
       - If asked if you are AI: say you are a virtual assistant for ${typedConfig.businessName}`,
      'You are an expert at creating focused, efficient AI voice agent scripts. Prioritise brevity and momentum. No filler, no rambling.'
    )

    // Append explicit tool-calling rules directly to prompt — Claude's generated script alone
    // is not reliable enough to trigger Retell tool calls when needed.
    const finalPrompt = calendarProvider
      ? voicePrompt + `\n\n## BOOKING TOOLS — MANDATORY (override everything above)\n\nWhen the caller mentions booking, appointments, availability, or scheduling — do this immediately:\n\nSTEP 1: Call check_availability tool — do not say you cannot check the calendar, just call it and read the slots aloud: "I have the following times available: [list options]. Which works for you?"\n\nSTEP 2: Once they pick a time, confirm you have their name and email (you should already have these from earlier in the call — if somehow missing, ask for them one at a time before proceeding).\n\nSTEP 3: Call book_appointment tool with: start_time (ISO 8601), caller_name, caller_email.\n\nSTEP 4: Confirm booking — "Done, you are booked for [time]. A confirmation will be sent to [email]."\n\nNEVER say you lack calendar access. NEVER suggest transferring for scheduling. ALWAYS call the tools.`
      : voicePrompt

    // Build Retell tools if the client has a calendar connected (calendarProvider already fetched above)
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000'

    const calendarTools: RetellTool[] = calendarProvider ? [
      {
        type: 'custom',
        name: 'check_availability',
        description: 'Check available appointment times in the calendar. Call this when the caller wants to book an appointment.',
        url: `${apiBaseUrl}/calendar/${clientId}/availability`,
        speak_during_execution: true,
        speak_after_execution: false,
        execution_message_description: "Let me check our available appointment times for you...",
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        type: 'custom',
        name: 'book_appointment',
        description: 'Book an appointment for the caller once they have confirmed a time slot. Requires their name, email, and chosen start time in ISO 8601 format.',
        url: `${apiBaseUrl}/calendar/${clientId}/book`,
        speak_during_execution: true,
        speak_after_execution: false,
        execution_message_description: "Let me lock that appointment in for you...",
        parameters: {
          type: 'object',
          properties: {
            start_time: { type: 'string', description: 'ISO 8601 datetime of the chosen appointment slot' },
            caller_name: { type: 'string', description: 'Full name of the caller' },
            caller_email: { type: 'string', description: 'Email address of the caller' },
            caller_phone: { type: 'string', description: 'Phone number of the caller (optional)' }
          },
          required: ['start_time', 'caller_name', 'caller_email']
        }
      }
    ] : []

    if (calendarProvider) {
      logger.info('Calendar tools enabled for voice agent', { clientId, calendarProvider })
    }

    let retellAgentId: string | undefined
    let phoneNumber: string | undefined

    try {
      const voiceResult = await voiceService.createInboundAgent({
        prompt: finalPrompt,
        voice: typedConfig.voice_id || '11labs-Adrian',
        firstSentence: typedConfig.greeting_script,
        clientId,
        businessName: typedConfig.businessName,
        transferNumber: typedConfig.escalation_number,
        callWebhook: `${process.env.N8N_BASE_URL}/webhook/voice-inbound-${clientId}`,
        country: typedConfig.country || 'AU',
        tools: calendarTools.length > 0 ? calendarTools : undefined,
        address: typedConfig.address
      })

      retellAgentId = voiceResult.agentId
      phoneNumber = voiceResult.phoneNumber

      logger.info('Retell AI inbound agent created', { clientId, retellAgentId, phoneNumber })
    } catch (error) {
      logger.warn('Failed to create Retell AI agent', { clientId, error })
    }

    let workflowResult: { workflowId: string } | undefined

    try {
      workflowResult = await n8nService.deployWorkflow('voice-inbound', {
        clientId,
        locationId: typedConfig.locationId,
        agentPrompt: voicePrompt,
        webhookUrl: `${process.env.N8N_BASE_URL}/webhook/voice-inbound-${clientId}`,
        phoneNumber,
        retellAgentId,
        calendarId: typedConfig.calendar_id,
        businessName: typedConfig.businessName,
        bookingLink: typedConfig.booking_link || ''
      })
    } catch (error) {
      logger.warn('N8N workflow deployment failed', { clientId, error })
    }

    const deployment = await this.createDeploymentRecord(
      clientId,
      {
        ...typedConfig,
        generatedPrompt: voicePrompt,
        phone_number: phoneNumber,
        retell_agent_id: retellAgentId
      },
      workflowResult?.workflowId
    )

    if (retellAgentId) {
      await prisma.agentDeployment.update({
        where: { id: deployment.id },
        data: { retellAgentId: retellAgentId }
      })
    }

    logger.info('Voice Inbound Agent deployed', { clientId, deploymentId: deployment.id, phoneNumber })

    return {
      id: deployment.id,
      n8nWorkflowId: workflowResult?.workflowId
    }
  }
}
