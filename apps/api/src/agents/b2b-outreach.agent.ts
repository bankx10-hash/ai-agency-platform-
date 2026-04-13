import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { logger } from '../utils/logger'

export interface B2BOutreachConfig {
  person_titles: string[]
  person_locations: string[]
  employee_ranges: string[]
  industries: string[]
  keywords: string[]
  daily_limit: number
  outreach_message_template: string
  locationId: string
  businessName: string
  owner_email?: string
  booking_link?: string
}

export class B2BOutreachAgent extends BaseAgent {
  agentType = AgentType.B2B_OUTREACH

  generatePrompt(config: Partial<B2BOutreachConfig>): string {
    return `B2B prospecting agent for ${config.businessName || 'our business'} powered by Apollo.io.
Searches for: ${(config.person_titles || []).join(', ')} in ${(config.person_locations || []).join(', ')}.
Daily limit: ${config.daily_limit || 25} prospects per day.`
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    const typedConfig = config as unknown as B2BOutreachConfig
    logger.info('Deploying B2B Outreach Agent (Apollo)', { clientId })

    // Normalise fields that may come as newline-separated strings from textarea
    const toArray = (val: unknown): string[] => {
      if (Array.isArray(val)) return val.filter(Boolean)
      if (typeof val === 'string') return val.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
      return []
    }
    const titles = toArray(typedConfig.person_titles)
    const locations = toArray(typedConfig.person_locations)
    const ranges = toArray(typedConfig.employee_ranges)
    const keywords = toArray(typedConfig.keywords)

    // Generate a personalised outreach message template via Claude
    const outreachTemplate = await this.callClaude(
      `Write a short, personalised outreach email/message template for ${typedConfig.businessName}.
Target audience: ${titles.join(', ')} at companies with ${ranges.join(', ')} employees.
The message should:
- Be under 100 words
- Reference their role/company naturally using the placeholders below
- Mention a specific pain point relevant to their industry
- End with a soft CTA (question, not a hard sell)
- Sign off with "Best regards," followed by "${typedConfig.businessName} Team" on the next line
- Use these exact placeholders (double curly braces): {{firstName}}, {{title}}, {{companyName}}
- NEVER use [brackets] or [Your name] or any other placeholder format — only {{curlyBraces}}
- NEVER include a subject line — only the email body
Return ONLY the message text, nothing else.`,
      'You are an expert B2B outreach copywriter. Your messages get 30%+ reply rates because they feel personal, not templated. Never use square brackets for placeholders.'
    )

    const workflowResult = await n8nService.deployWorkflow('b2b-outreach', {
      clientId,
      locationId: typedConfig.locationId || '',
      businessName: typedConfig.businessName,
      bookingLink: typedConfig.booking_link || '',
      ownerEmail: typedConfig.owner_email || '',
      agentPrompt: outreachTemplate,
      personTitles: titles.join('|'),
      personLocations: locations.join('|'),
      keywords: keywords.join('|'),
      employeeRanges: ranges.join('|')
    })

    const deployment = await this.createDeploymentRecord(
      clientId,
      {
        ...typedConfig,
        generatedOutreachTemplate: outreachTemplate
      },
      workflowResult.workflowId
    )

    logger.info('B2B Outreach Agent deployed', { clientId, deploymentId: deployment.id })

    return {
      id: deployment.id,
      n8nWorkflowId: workflowResult.workflowId
    }
  }
}
