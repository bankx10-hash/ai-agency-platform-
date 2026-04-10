export enum AgentType {
  LEAD_GENERATION = 'LEAD_GENERATION',
  B2B_OUTREACH = 'B2B_OUTREACH',
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  SOCIAL_ENGAGEMENT = 'SOCIAL_ENGAGEMENT',
  ADVERTISING = 'ADVERTISING',
  APPOINTMENT_SETTER = 'APPOINTMENT_SETTER',
  VOICE_INBOUND = 'VOICE_INBOUND',
  VOICE_OUTBOUND = 'VOICE_OUTBOUND',
  VOICE_CLOSER = 'VOICE_CLOSER',
  CLIENT_SERVICES = 'CLIENT_SERVICES',
  CONVERSATIONAL_WORKFLOW = 'CONVERSATIONAL_WORKFLOW',
  RECEPTIONIST_FOLLOWUP = 'RECEPTIONIST_FOLLOWUP'
}

export enum AgentStatus {
  INACTIVE = 'INACTIVE',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR'
}

export interface AgentDeployment {
  id: string
  clientId: string
  agentType: AgentType
  status: AgentStatus
  n8nWorkflowId?: string
  blandAgentId?: string
  config: AgentConfig
  metrics?: AgentMetrics
  createdAt: Date
  updatedAt: Date
}

export type AgentConfig =
  | LeadGenerationConfig
  | B2BOutreachConfig
  | SocialMediaConfig
  | AdvertisingConfig
  | AppointmentSetterConfig
  | VoiceInboundConfig
  | VoiceOutboundConfig
  | VoiceCloserConfig
  | ClientServicesConfig
  | ConversationalWorkflowConfig

export interface LeadGenerationConfig {
  icp_description: string
  lead_sources: string[]
  scoring_prompt: string
  pipeline_id: string
  high_score_threshold: number
}

export interface B2BOutreachConfig {
  person_titles: string[]
  person_locations: string[]
  employee_ranges: string[]
  industries: string[]
  keywords: string[]
  outreach_message_template: string
  daily_limit: number
}

export interface FollowUpSequence {
  day: number
  message: string
}

export interface SocialMediaConfig {
  business_description: string
  tone: string
  posting_frequency: string
  platforms: string[]
  content_pillars: string[]
  buffer_token: string
}

export interface AdvertisingConfig {
  meta_ad_account_id: string
  google_ads_customer_id: string
  target_roas: number
  daily_budget_limit: number
  alert_email: string
}

export interface AppointmentSetterConfig {
  followup_sequence: FollowUpSequence[]
  calendar_id: string
  objection_handlers: Record<string, string>
  booking_link: string
  sms_number: string
}

export interface VoiceInboundConfig {
  greeting_script: string
  qualification_questions: string[]
  faq_knowledge_base: string
  escalation_number: string
  voice_id: string
  calendar_id: string
  phone_number?: string
  bland_agent_id?: string
}

export interface VoiceOutboundConfig {
  call_script: string
  objection_handlers: Record<string, string>
  max_daily_calls: number
  call_window_hours: string
  retry_attempts: number
  ghl_pipeline_stage: string
  bland_agent_id?: string
}

export interface VoiceCloserConfig {
  closing_script_template: string
  offer_details: string
  payment_link: string
  contract_link: string
  objection_scripts: Record<string, string>
  commission_tracking: boolean
  bland_agent_id?: string
}

export interface ClientServicesConfig {
  welcome_sequence: FollowUpSequence[]
  onboarding_checklist: string[]
  nps_schedule: string
  health_score_weights: Record<string, number>
  upsell_triggers: string[]
}

export interface ConversationalWorkflowConfig {
  workflowId: string
  channels: ('whatsapp' | 'instagram' | 'facebook')[]
  qualifyThreshold: number
  handoffToAppointmentSetter?: boolean
}

export interface AgentMetrics {
  totalLeads?: number
  leadsToday?: number
  callsMade?: number
  callsAnswered?: number
  appointmentsBooked?: number
  appointmentsToday?: number
  emailsSent?: number
  connectionsSent?: number
  postsPublished?: number
  closingRate?: number
  lastRunAt?: string
  errors?: number
}

export type PlanType = 'AI_RECEPTIONIST' | 'STARTER' | 'GROWTH' | 'AGENCY'

export const ADDONS = {
  SMART_CAPTURE: {
    id: 'smart_capture',
    name: 'Smart Capture',
    price: 49,
    description: 'Website lead form + AI outbound calls to new enquiries within 5 minutes',
    agents: [
      AgentType.LEAD_GENERATION,
      AgentType.VOICE_OUTBOUND
    ],
    availableOn: ['AI_RECEPTIONIST'] as PlanType[]
  }
} as const

export type BusinessType = 'dentist' | 'salon' | 'mechanic' | 'tradie' | 'clinic' | 'vet' | 'physio' | 'other'

export const REBOOKING_INTERVALS: Record<BusinessType, { months: number; label: string }> = {
  dentist: { months: 6, label: '6-month checkup' },
  salon: { months: 1.5, label: '6-week appointment' },
  mechanic: { months: 12, label: 'annual service' },
  tradie: { months: 12, label: 'annual maintenance check' },
  clinic: { months: 6, label: '6-month checkup' },
  vet: { months: 12, label: 'annual checkup' },
  physio: { months: 1, label: 'monthly session' },
  other: { months: 6, label: '6-month follow-up' }
}

export const SERVICE_PIPELINE_STAGES = [
  'NEW_INQUIRY',
  'APPOINTMENT_BOOKED',
  'APPOINTMENT_COMPLETED',
  'FOLLOW_UP_DUE',
  'RECURRING_CLIENT',
  'NO_SHOW',
  'INACTIVE'
] as const

export type ServicePipelineStage = typeof SERVICE_PIPELINE_STAGES[number]

export const PLANS = {
  AI_RECEPTIONIST: {
    price: 147,
    stripePriceId: process.env.STRIPE_RECEPTIONIST_PRICE_ID || 'price_receptionist',
    pipelineType: 'service' as const,
    phoneNumbers: 2,
    agents: [
      AgentType.VOICE_INBOUND,
      AgentType.RECEPTIONIST_FOLLOWUP
    ]
  },
  STARTER: {
    price: 297,
    stripePriceId: process.env.STRIPE_STARTER_PRICE_ID || 'price_starter',
    pipelineType: 'sales' as const,
    phoneNumbers: 1,
    agents: [
      AgentType.LEAD_GENERATION,
      AgentType.APPOINTMENT_SETTER,
      AgentType.VOICE_INBOUND,
      AgentType.VOICE_OUTBOUND
    ]
  },
  GROWTH: {
    price: 497,
    stripePriceId: process.env.STRIPE_GROWTH_PRICE_ID || 'price_growth',
    agents: [
      AgentType.LEAD_GENERATION,
      AgentType.B2B_OUTREACH,
      AgentType.SOCIAL_MEDIA,
      AgentType.APPOINTMENT_SETTER,
      AgentType.VOICE_INBOUND,
      AgentType.VOICE_OUTBOUND
    ]
  },
  AGENCY: {
    price: 997,
    stripePriceId: process.env.STRIPE_AGENCY_PRICE_ID || 'price_agency',
    agents: [
      AgentType.LEAD_GENERATION,
      AgentType.B2B_OUTREACH,
      AgentType.SOCIAL_MEDIA,
      AgentType.ADVERTISING,
      AgentType.APPOINTMENT_SETTER,
      AgentType.VOICE_INBOUND,
      AgentType.VOICE_OUTBOUND,
      AgentType.VOICE_CLOSER,
      AgentType.CLIENT_SERVICES
    ]
  }
} as const

/**
 * Add-on agents — not bundled in any plan. Clients purchase these
 * separately and they get deployed on top of their existing plan.
 */
export const ADDON_AGENTS: AgentType[] = [
  AgentType.SOCIAL_ENGAGEMENT,
  AgentType.CONVERSATIONAL_WORKFLOW
]
