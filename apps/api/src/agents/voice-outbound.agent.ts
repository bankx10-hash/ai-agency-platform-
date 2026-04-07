import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { voiceService } from '../services/voice.service'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'

export interface VoiceOutboundConfig {
  call_script: string
  objection_handlers: Record<string, string>
  max_daily_calls: number
  call_window_hours: string
  retry_attempts: number
  ghl_pipeline_stage: string
  locationId: string
  businessName: string
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

    let retellAgentId: string | undefined

    try {
      const voiceResult = await voiceService.createOutboundAgent({
        prompt: outboundScript,
        voice: '11labs-Cimo',
        firstSentence: `Hi, is this a good time to chat for just 2 minutes? I'm calling from ${typedConfig.businessName}.`,
        clientId,
        businessName: typedConfig.businessName,
        callWebhook: `${process.env.API_URL || 'https://api.nodusaisystems.com'}/calls/webhook`
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

    logger.info('Voice Outbound Agent deployed', { clientId, deploymentId: deployment.id })

    return {
      id: deployment.id,
      n8nWorkflowId: workflowResult?.workflowId
    }
  }
}
