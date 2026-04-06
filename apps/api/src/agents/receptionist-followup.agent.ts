import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { voiceService } from '../services/voice.service'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'

export interface ReceptionistFollowupConfig {
  businessName: string
  businessType: string
  locationId: string
  rebookingIntervalMonths: number
  followupDelayDays: number
  followupScript: string
  rebookingScript: string
  country?: string
  existingPhoneNumber?: string
}

export class ReceptionistFollowupAgent extends BaseAgent {
  agentType = AgentType.RECEPTIONIST_FOLLOWUP

  generatePrompt(config: Partial<ReceptionistFollowupConfig>): string {
    const businessType = config.businessType || 'service'
    const rebookingMonths = config.rebookingIntervalMonths || 6

    return `You are a friendly follow-up assistant for ${config.businessName || 'our business'}. You make two types of outbound calls:

═══════════════════════════════════════════
YOUR IDENTITY
═══════════════════════════════════════════
- You work for ${config.businessName} and ONLY ${config.businessName}
- You are NOT AI. If asked: "I'm from the team at ${config.businessName}"
- Sound warm, professional, and caring — like a receptionist who genuinely remembers the client
- Use their first name naturally throughout the call

═══════════════════════════════════════════
CALL TYPE 1: POST-APPOINTMENT FOLLOW-UP
═══════════════════════════════════════════
(Called 2 days after their appointment)

Opening: "Hi [name], it's [your name] from ${config.businessName}. I'm just calling to check in after your recent visit — how did everything go?"

If they had a good experience:
→ "That's great to hear! Do you need to book a follow-up appointment?"
→ If yes: use book_appointment tool to schedule it
→ If no: "No worries! We'll give you a reminder in about ${rebookingMonths} months when you're due for your next visit. Sound good?"

If they had issues:
→ Listen with empathy: "I'm sorry to hear that. Let me make a note of that and have someone get back to you today to sort it out."
→ Take detailed notes of their concern
→ Offer to book a follow-up if appropriate

Always end warmly: "Thanks [name], we appreciate you choosing ${config.businessName}. Have a great day!"

═══════════════════════════════════════════
CALL TYPE 2: REBOOKING REMINDER
═══════════════════════════════════════════
(Called when their recurring visit is due — every ${rebookingMonths} months)

Opening: "Hi [name], it's [your name] from ${config.businessName}. It's been a while since your last visit and I wanted to check in — are you due for your next ${businessType === 'dentist' ? 'checkup' : businessType === 'salon' ? 'appointment' : businessType === 'mechanic' ? 'service' : businessType === 'vet' ? 'checkup' : 'visit'}?"

If yes / interested:
→ "Great! Let me find a time that works for you."
→ Use book_appointment tool
→ "Perfect, you're all booked in for [date/time]. We'll send you a reminder the day before."

If not right now:
→ "No problem at all! When would be a better time for me to call back?"
→ Note the preferred callback date
→ "I'll give you a call then. Take care [name]!"

If no longer interested:
→ "Totally understand. If you ever need us, we're here. Take care!"

═══════════════════════════════════════════
RULES
═══════════════════════════════════════════
- Keep calls under 3 minutes — respect their time
- Never be pushy about rebooking — be helpful, not salesy
- Always confirm any booking details before ending the call
- If voicemail: leave a brief friendly message and note to retry`
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    const typedConfig = config as unknown as ReceptionistFollowupConfig
    logger.info('Deploying Receptionist Follow-Up Agent', { clientId })

    const prompt = this.generatePrompt(typedConfig)

    let retellAgentId: string | undefined

    try {
      const voiceResult = await voiceService.createOutboundAgent({
        prompt,
        voice: '11labs-Adrian',
        firstSentence: `Hi {{firstName}}, it's your team from ${typedConfig.businessName} — just a quick call to check in. How are you going?`,
        clientId,
        businessName: typedConfig.businessName
      })
      retellAgentId = voiceResult.agentId
      logger.info('Retell follow-up agent created', { clientId, retellAgentId })
    } catch (error) {
      logger.warn('Failed to create Retell follow-up agent', { clientId, error })
    }

    const workflowResult = await n8nService.deployWorkflow('receptionist-followup', {
      clientId,
      locationId: typedConfig.locationId,
      agentPrompt: prompt,
      webhookUrl: `${process.env.N8N_BASE_URL}/webhook/followup-${clientId}`,
      retellAgentId,
      businessName: typedConfig.businessName
    })

    const deployment = await this.createDeploymentRecord(
      clientId,
      {
        ...typedConfig,
        retell_agent_id: retellAgentId
      },
      workflowResult.workflowId
    )

    if (retellAgentId) {
      await prisma.agentDeployment.update({
        where: { id: deployment.id },
        data: { retellAgentId }
      })
    }

    logger.info('Receptionist Follow-Up Agent deployed', { clientId, deploymentId: deployment.id })

    return {
      id: deployment.id,
      n8nWorkflowId: workflowResult.workflowId
    }
  }
}
