export interface N8NWorkflow {
  id?: string
  name: string
  active: boolean
  nodes: N8NNode[]
  connections: Record<string, N8NConnection>
  settings?: Record<string, unknown>
  staticData?: Record<string, unknown>
  tags?: string[]
}

export interface N8NNode {
  id: string
  name: string
  type: string
  typeVersion: number
  position: [number, number]
  parameters: Record<string, unknown>
  credentials?: Record<string, unknown>
  webhookId?: string
}

export interface N8NConnection {
  main: Array<Array<{ node: string; type: string; index: number }>>
}

export interface WorkflowVariable {
  name: string
  value: string
  placeholder: string
}

export interface WorkflowDeployConfig {
  clientId: string
  locationId: string
  agentPrompt?: string
  webhookUrl?: string
  phoneNumber?: string
  retellAgentId?: string
  calendarId?: string
  pipelineId?: string
  apiKey?: string
  businessName?: string
  bookingLink?: string
  icpDescription?: string
  connectionTemplate?: string
  platforms?: string
  ownerEmail?: string
  n8nApiSecret?: string
  retellApiKey?: string
  anthropicApiKey?: string
  apiBaseUrl?: string
}

export interface WorkflowDeployResult {
  workflowId: string
  webhookUrl?: string
  active: boolean
  webhooksRegistered?: boolean
  testExecutionPassed?: boolean
}

export interface N8NApiResponse<T> {
  data: T
  nextCursor?: string
}

export interface WorkflowStatus {
  id: string
  name: string
  active: boolean
  lastExecution?: {
    id: string
    status: 'success' | 'error' | 'waiting'
    startedAt: string
    finishedAt?: string
  }
}

export interface WorkflowNodeIssue {
  nodeId: string
  nodeName: string
  issue: string
  severity: 'error' | 'warning'
}

export interface WorkflowTestResult {
  success: boolean
  checks: {
    // Pre-deployment
    templateValid: boolean
    noUnreplacedPlaceholders: boolean
    triggersValid: boolean
    connectionGraphValid: boolean
    nodeDataFlowValid: boolean
    nodeParametersValid: boolean
    n8nReachable: boolean
    externalApisReachable: Record<string, boolean>
    // Post-deployment (populated after deploy)
    deploymentVerified?: boolean
    workflowActive?: boolean
    webhooksRegistered?: boolean
    testExecutionPassed?: boolean
  }
  errors: string[]
  warnings: string[]
  nodeIssues: WorkflowNodeIssue[]
}
