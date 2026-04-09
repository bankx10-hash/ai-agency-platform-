export interface WorkflowDeployConfig {
  clientId: string
  // Client's plan — used to select per-package template files (e.g.
  // `ai-receptionist-voice-inbound.workflow.json`) so each package has
  // its own customisable template that can't be overwritten by another.
  plan?: 'AI_RECEPTIONIST' | 'STARTER' | 'GROWTH' | 'AGENCY'
  locationId?: string
  agentPrompt?: string
  webhookUrl?: string
  phoneNumber?: string
  calendarId?: string
  pipelineId?: string
  apiKey?: string
  businessName?: string
  icpDescription?: string
  platforms?: string | string[]
  bufferToken?: string
  metaAdAccountId?: string
  metaAccessToken?: string
  metaPageId?: string
  metaDefaultAdsetId?: string
  googleRefreshToken?: string
  googleAdsCustomerId?: string
  adLinkUrl?: string
  paymentLink?: string
  contractLink?: string
  retellAgentId?: string
  [key: string]: unknown
}

export interface WorkflowDeployResult {
  workflowId: string
  active: boolean
  webhookUrl: string
  testResult?: {
    success: boolean
    executionId?: string
    status?: string
    error?: string
  }
}

export interface WorkflowStatus {
  id: string
  name: string
  active: boolean
  lastExecution?: {
    id: string
    status: string
    startedAt: string
    finishedAt: string
  }
}
