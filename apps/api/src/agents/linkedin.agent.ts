import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { logger } from '../utils/logger'

export interface LinkedInAgentConfig {
  search_url: string
  connection_message_template: string
  followup_sequences: Array<{ day: number; message: string }>
  daily_limit: number
  linkedin_cookie: string
  locationId: string
  businessName: string
}

export class LinkedInAgent extends BaseAgent {
  agentType = AgentType.LINKEDIN_OUTREACH

  generatePrompt(config: Partial<LinkedInAgentConfig>): string {
    return `LinkedIn outreach agent for ${config.businessName || 'our business'}. Daily limit: ${config.daily_limit || 20}.`
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    const typedConfig = config as unknown as LinkedInAgentConfig
    logger.info('Deploying LinkedIn Outreach Agent', { clientId })

    let workflowResult: { workflowId: string } | undefined

    try {
      workflowResult = await n8nService.deployWorkflow('linkedin-outreach', {
        clientId,
        locationId: typedConfig.locationId || '',
        businessName: typedConfig.businessName,
        connectionTemplate: typedConfig.connection_message_template || 'Hi {{firstName}}, I came across your profile and thought it would be great to connect!',
        apiKey: process.env.PHANTOMBUSTER_LEADOUTREACH_ID || ''
      })
    } catch (error) {
      logger.warn('N8N workflow deployment failed', { clientId, error })
    }

    const deployment = await this.createDeploymentRecord(
      clientId,
      {
        ...typedConfig,
        phantomAutoConnectId: process.env.PHANTOMBUSTER_AUTOCONNECT_ID,
        phantomMessageSenderId: process.env.PHANTOMBUSTER_MESSAGESENDER_ID
      },
      workflowResult?.workflowId
    )

    logger.info('LinkedIn Outreach Agent deployed', { clientId, deploymentId: deployment.id })

    return {
      id: deployment.id,
      n8nWorkflowId: workflowResult?.workflowId
    }
  }
}
