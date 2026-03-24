import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { voiceService } from '../services/voice.service'
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
  locationId: string
  businessName: string
  country?: string
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
4. If caller wants to book: collect name, email, and preferred time, then confirm calendar availability
5. If question not in knowledge base: say you will have someone call back and take their contact info
6. If caller is upset or frustrated: empathise, then offer to connect them with a human (transfer to ${config.escalation_number || 'manager'})
7. Keep calls focused but never rushed
8. Always end with a clear next step

Caller context:
${JSON.stringify(caller, null, 2)}

Respond naturally as if in a real phone conversation.`
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    const typedConfig = config as unknown as VoiceInboundConfig
    logger.info('Deploying Voice Inbound Agent', { clientId })

    const voicePrompt = await this.callClaude(
      `Create a detailed, natural-sounding AI phone receptionist script for ${typedConfig.businessName}.

       The agent should:
       1. Answer calls professionally with: "${typedConfig.greeting_script}"
       2. Qualify callers with these questions (asked naturally): ${typedConfig.qualification_questions.join(', ')}
       3. Handle FAQs from this knowledge base: ${typedConfig.faq_knowledge_base}
       4. Book appointments using calendar ID: ${typedConfig.calendar_id}
       5. Escalate to human at: ${typedConfig.escalation_number}

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

    let retellAgentId: string | undefined
    let phoneNumber: string | undefined

    try {
      const voiceResult = await voiceService.createInboundAgent({
        prompt: voicePrompt,
        voice: typedConfig.voice_id || '11labs-Adrian',
        firstSentence: typedConfig.greeting_script,
        clientId,
        businessName: typedConfig.businessName,
        transferNumber: typedConfig.escalation_number,
        calendarWebhook: `${process.env.N8N_BASE_URL}/webhook/voice-calendar-${clientId}`,
        country: typedConfig.country || 'AU'
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
        businessName: typedConfig.businessName
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
