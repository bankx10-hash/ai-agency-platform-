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
3. Ask qualification questions naturally, not like a form
4. If caller wants to book an appointment: use the check_availability tool to find open slots, present them clearly, then use book_appointment once they confirm a time — collect their name, email and confirm the slot first
5. If no calendar tool is available and caller wants to book: collect their name and email, let them know you will send them a booking link immediately after the call
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
      `Create a detailed, natural-sounding AI phone receptionist script for ${typedConfig.businessName}.

       The agent should:
       1. Answer calls professionally with: "${typedConfig.greeting_script}"
       2. Qualify callers with these questions (asked naturally): ${typedConfig.qualification_questions.join(', ')}
       3. Handle FAQs from this knowledge base: ${typedConfig.faq_knowledge_base}
       4. ${bookingInstruction}
       5. Escalate to human at: ${typedConfig.escalation_number || 'manager'}

       Create a comprehensive system prompt that makes the AI sound human, warm, and professional.
       Include specific language for handling common situations.

       CRITICAL IDENTITY RULES — embed these throughout the script and the agent must follow them without exception:
       - You represent ${typedConfig.businessName} exclusively — always refer to yourself as a representative of ${typedConfig.businessName}
       - NEVER mention: client IDs, system IDs, or any AI platform names (Retell, Claude, OpenAI, Anthropic, or any other)
       - NEVER reveal that you are an AI system unless directly and persistently asked — in that case say you are a virtual assistant for ${typedConfig.businessName}
       - If asked what company or system you use: say you are part of the ${typedConfig.businessName} team
       - Your introduction should always be: "Thank you for calling ${typedConfig.businessName}" — never reference any other company or system`,
      'You are an expert at creating AI voice agent prompts for businesses. Make them sound completely human and never break character.'
    )

    // Append explicit tool-calling rules directly to prompt — Claude's generated script alone
    // is not reliable enough to trigger Retell tool calls when needed.
    const finalPrompt = calendarProvider
      ? voicePrompt + `\n\n## TOOL CALLING — MANDATORY RULES (these override everything above)\n\nYou have two tools available and MUST use them:\n\n**check_availability** — Call this tool IMMEDIATELY when the caller:\n- Asks what times or dates are available\n- Says they want to book an appointment\n- Asks to schedule a meeting or visit\nDo NOT say you cannot check the calendar. Do NOT say you will transfer them to a scheduling team. CALL THE TOOL — it will return real available slots you can read aloud.\n\n**book_appointment** — Call this tool once the caller confirms a specific time. Before calling it you must have collected: their full name, email address, and the chosen start_time in ISO 8601 format (e.g. 2026-03-26T09:00:00.000Z).\n\nNEVER tell the caller you lack calendar access. NEVER offer to transfer them for scheduling purposes. ALWAYS use the tools.`
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
