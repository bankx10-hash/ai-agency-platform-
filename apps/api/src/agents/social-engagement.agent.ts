import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { logger } from '../utils/logger'

export interface SocialEngagementConfig {
  businessName: string
  locationId: string
  business_description: string
  booking_link: string
  objection_handlers: Record<string, string>
  platforms: string[]
  handoff_to_appointment_setter: boolean
  handoff_to_closer: boolean
}

export class SocialEngagementAgent extends BaseAgent {
  agentType = AgentType.SOCIAL_ENGAGEMENT

  generatePrompt(config: Partial<SocialEngagementConfig>): string {
    return `You are a social media engagement bot for ${config.businessName || 'a business'}.
Classify incoming messages and comments, then draft natural replies that build relationships.
Business: ${config.business_description || ''}
Booking link: ${config.booking_link || 'not set'}`
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    logger.info('Deploying Social Engagement Agent', { clientId })

    let workflowResult: { workflowId: string } | undefined
    try {
      workflowResult = await n8nService.deployWorkflow('social-engagement', {
        clientId,
        locationId: (config.locationId as string) || '',
        businessName: config.businessName as string,
        bookingLink: (config.booking_link as string) || '',
      })
    } catch (error) {
      logger.warn('N8N engagement workflow deployment failed', { clientId, error })
    }

    const deployment = await this.createDeploymentRecord(
      clientId,
      config,
      workflowResult?.workflowId
    )

    logger.info('Social Engagement Agent deployed', { clientId, deploymentId: deployment.id })
    return { id: deployment.id, n8nWorkflowId: workflowResult?.workflowId }
  }
}
