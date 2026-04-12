import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { voiceService } from '../services/voice.service'
import { calendarService } from '../services/calendar.service'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'
import type { RetellTool } from '../services/voice.service'

export interface VoiceOutboundConfig {
  call_script: string
  objection_handlers: Record<string, string>
  max_daily_calls: number
  call_window_hours: string
  retry_attempts: number
  ghl_pipeline_stage: string
  locationId: string
  businessName: string
  /**
   * Plain-text or markdown knowledge base shared with the closer/receptionist —
   * services, plans, examples, FAQs, case studies. The agent references this
   * during calls to handle objections, answer queries, and demonstrate expertise.
   */
  upsell_knowledge_base?: string
}

export class VoiceOutboundAgent extends BaseAgent {
  agentType = AgentType.VOICE_OUTBOUND

  generatePrompt(config: Partial<VoiceOutboundConfig>, contactData?: Record<string, unknown>): string {
    const contact = contactData || {}

    return `You are a professional outbound calling agent for ${config.businessName || 'our business'}. You are making a live outbound call right now.

Call script:
${config.call_script || `Hi, this is an AI assistant calling from ${config.businessName}. Is this a good time to chat for 2 minutes?`}

You are calling: ${contact.firstName || ''} ${contact.lastName || ''}
Their context: ${JSON.stringify(contact, null, 2)}

Objection handling responses:
${JSON.stringify(config.objection_handlers || {}, null, 2)}

Call goals:
1. Confirm identity warmly
2. State your reason for calling concisely
3. Qualify their interest level
4. If interested: book an appointment or transfer to specialist
5. If not interested: thank them and ask if it's okay to follow up in future
6. Log call outcome clearly

Call outcomes to track:
- INTERESTED: Schedule appointment
- CALLBACK: Schedule callback for specific time
- NOT_INTERESTED: Note reason, do not call again
- VOICEMAIL: Leave professional voicemail, send follow-up SMS
- NO_ANSWER: Schedule retry

Always be respectful of the person's time. If they're busy, offer to call at a better time.`
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    const typedConfig = config as unknown as VoiceOutboundConfig
    logger.info('Deploying Voice Outbound Agent', { clientId })

    const outboundScript = await this.callClaude(
      `Create a natural-sounding outbound call script for ${typedConfig.businessName}.

       Starting script: "${typedConfig.call_script}"
       Call window: ${typedConfig.call_window_hours}
       Max daily calls: ${typedConfig.max_daily_calls}

       Develop:
       1. Opening (first 15 seconds - get permission to continue)
       2. Value proposition (30 seconds)
       3. Qualifying questions (2-3 questions)
       4. Objection handlers for: not interested, too busy, already have solution, need to think about it
       5. Close (book appointment or get callback time)
       6. Voicemail script (under 30 seconds)

       Make it sound completely natural and human. Include emotional intelligence cues.

       CRITICAL IDENTITY RULES — embed these throughout the script and the agent must follow them without exception:
       - Always introduce yourself as calling from ${typedConfig.businessName} — for example: "Hi, I'm Alex calling from ${typedConfig.businessName}"
       - NEVER mention: client IDs, system IDs, or any AI platform names (Retell, Claude, OpenAI, Anthropic, or any other)
       - NEVER reveal that you are an AI unless directly and persistently asked — in that case say you are a virtual assistant representing ${typedConfig.businessName}
       - If asked who you work for: you work for ${typedConfig.businessName}, no other company or system
       - The voicemail must also identify only as calling from ${typedConfig.businessName}`,
      'You are an expert at creating outbound sales call scripts that feel authentic and get results. Never break character or reveal AI systems.'
    )

    // Append client-provided knowledge base for objection handling, query answering,
    // and demonstrating expertise during outbound calls. Falls back to onboarding data.
    let knowledgeBase = (typedConfig.upsell_knowledge_base || '').trim()
    if (!knowledgeBase) {
      const onboarding = await prisma.onboarding.findUnique({ where: { clientId } })
      const onboardingData = (onboarding?.data as Record<string, unknown>) || {}
      knowledgeBase = ((onboardingData.upsell_knowledge_base as string) || '').trim()
    }
    const finalScript = knowledgeBase
      ? `${outboundScript}\n\n═══════════════════════════════════════════\nSERVICES & KNOWLEDGE BASE\n═══════════════════════════════════════════\n${knowledgeBase}\n\nIMPORTANT: Use the knowledge above to answer prospect questions, handle objections, and demonstrate expertise during the call. Reference specific examples and pricing naturally — never read it verbatim.`
      : outboundScript

    // Build calendar booking tools so the agent can book appointments
    // mid-call if the prospect is interested. This is what wires the
    // outbound agent into the closer flow — a booking → /appointments →
    // closer-ready webhook → closer calls at the booked time.
    const calendarProvider = await calendarService.getCalendarProvider(clientId).catch(() => null)
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000'
    const calendarTools: RetellTool[] = calendarProvider ? [
      {
        type: 'custom',
        name: 'check_availability',
        description: 'Check available appointment times in the calendar. Call this IMMEDIATELY when the prospect expresses interest in booking a call or meeting. Do NOT make up times — you MUST call this tool to get real availability.',
        url: `${apiBaseUrl}/calendar/${clientId}/availability`,
        speak_during_execution: true,
        speak_after_execution: true,
        execution_message_description: 'Let me check our available times for you...',
        timeout_ms: 15000,
        parameters: { type: 'object', properties: {}, required: [] }
      },
      {
        type: 'custom',
        name: 'book_appointment',
        description: 'Book an appointment for the prospect. You MUST call this tool to actually create the booking — do NOT pretend the booking is done without calling this tool. Requires the prospect name, email, and chosen start time.',
        url: `${apiBaseUrl}/calendar/${clientId}/book`,
        speak_during_execution: true,
        speak_after_execution: true,
        execution_message_description: 'Let me lock that appointment in for you...',
        timeout_ms: 15000,
        parameters: {
          type: 'object',
          properties: {
            start_time: { type: 'string', description: 'ISO 8601 datetime of the chosen appointment slot' },
            caller_name: { type: 'string', description: 'Full name of the prospect' },
            caller_email: { type: 'string', description: 'Email address of the prospect' },
            caller_phone: { type: 'string', description: 'Phone number of the prospect (optional)' }
          },
          required: ['start_time', 'caller_name', 'caller_email']
        }
      }
    ] : []

    // If calendar tools are wired up, strengthen the prompt with explicit
    // instructions so the agent actually invokes them mid-call rather than
    // just promising a follow-up.
    const promptWithBookingTools = calendarProvider
      ? finalScript + `\n\n## BOOKING TOOLS — MANDATORY\n\nIf the prospect expresses ANY interest in a chat, demo, or meeting, do this immediately:\n\nSTEP 1: Call check_availability tool — read the slots aloud: "I can do [list options]. Which works for you?"\n\nSTEP 2: Confirm their name and email if you don't already have them.\n\nSTEP 3: Call book_appointment tool with start_time (ISO 8601), caller_name, caller_email, caller_phone.\n\nSTEP 4: Confirm: "You're booked for [time]. We'll call you then — looking forward to it!"\n\nNEVER suggest booking later or via email. ALWAYS call the tools mid-call.`
      : finalScript

    let retellAgentId: string | undefined

    try {
      const voiceResult = await voiceService.createOutboundAgent({
        prompt: promptWithBookingTools,
        voice: '11labs-Cimo',
        firstSentence: `Hi, is this a good time to chat for just 2 minutes? I'm calling from ${typedConfig.businessName}.`,
        clientId,
        businessName: typedConfig.businessName,
        callWebhook: `${process.env.API_URL || 'https://api.nodusaisystems.com'}/calls/webhook`,
        tools: calendarTools.length > 0 ? calendarTools : undefined
      })

      retellAgentId = voiceResult.agentId
      logger.info('Retell AI outbound agent created', { clientId, retellAgentId })
    } catch (error) {
      logger.warn('Failed to create Retell AI outbound agent', { clientId, error })
    }

    // Provision dedicated outbound phone number for voice outbound agent
    const phoneNumber = await voiceService.provisionOutboundPhoneNumber({
      clientId,
      businessName: typedConfig.businessName,
      country: ((typedConfig as unknown as Record<string, unknown>).country as string) || 'AU',
      address: (typedConfig as unknown as Record<string, unknown>).address as { street: string; city: string; state?: string; postcode?: string } | undefined,
      credentialService: 'voice-outbound-phone',
      retellAgentId
    }) || ''
    if (!phoneNumber) {
      logger.warn('Voice outbound: no outbound phone provisioned — outbound calls will fail', { clientId })
    }

    let workflowResult: { workflowId: string } | undefined

    try {
      workflowResult = await n8nService.deployWorkflow('voice-outbound', {
        clientId,
        locationId: typedConfig.locationId,
        agentPrompt: outboundScript,
        webhookUrl: `${process.env.N8N_BASE_URL}/webhook/voice-outbound-${clientId}`,
        retellAgentId,
        phoneNumber,
        businessName: typedConfig.businessName
      })
    } catch (error) {
      logger.warn('N8N workflow deployment failed', { clientId, error })
    }

    const deployment = await this.createDeploymentRecord(
      clientId,
      {
        ...typedConfig,
        generatedScript: outboundScript,
        retell_agent_id: retellAgentId,
        phone_number: phoneNumber
      },
      workflowResult?.workflowId
    )

    if (retellAgentId) {
      await prisma.agentDeployment.update({
        where: { id: deployment.id },
        data: { retellAgentId: retellAgentId }
      })
    }

    logger.info('Voice Outbound Agent deployed', { clientId, deploymentId: deployment.id })

    return {
      id: deployment.id,
      n8nWorkflowId: workflowResult?.workflowId
    }
  }
}
