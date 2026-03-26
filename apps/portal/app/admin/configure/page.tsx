'use client'
import { useState, useEffect } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
const ADMIN_SECRET = process.env.NEXT_PUBLIC_ADMIN_SECRET || ''

type AgentStatus = 'ACTIVE' | 'PAUSED' | 'ERROR' | 'INACTIVE' | null

interface AgentRow {
  agentType: string
  deployed: boolean
  status: AgentStatus
  n8nWorkflowId: string | null
  retellAgentId: string | null
  createdAt: string | null
}

interface ClientInfo {
  id: string
  businessName: string
  email: string
  plan: string
  country: string
}

const AGENT_LABELS: Record<string, string> = {
  LEAD_GENERATION: 'Lead Generation',
  LINKEDIN_OUTREACH: 'LinkedIn Outreach',
  SOCIAL_MEDIA: 'Social Media',
  ADVERTISING: 'Advertising',
  APPOINTMENT_SETTER: 'Appointment Setter',
  VOICE_INBOUND: 'Voice Inbound',
  VOICE_OUTBOUND: 'Voice Outbound',
  VOICE_CLOSER: 'Voice Closer',
  CLIENT_SERVICES: 'Client Services'
}

const AGENT_ICONS: Record<string, string> = {
  LEAD_GENERATION: '🎯',
  LINKEDIN_OUTREACH: '💼',
  SOCIAL_MEDIA: '📱',
  ADVERTISING: '📢',
  APPOINTMENT_SETTER: '📅',
  VOICE_INBOUND: '📞',
  VOICE_OUTBOUND: '📤',
  VOICE_CLOSER: '🤝',
  CLIENT_SERVICES: '⭐'
}

// Key config fields per agent type (others use defaults)
const AGENT_CONFIG_FIELDS: Record<string, Array<{ key: string; label: string; type: string; placeholder: string; required?: boolean }>> = {
  LINKEDIN_OUTREACH: [
    { key: 'search_url', label: 'LinkedIn Search URL', type: 'url', placeholder: 'https://www.linkedin.com/search/results/people/?keywords=...', required: true },
    { key: 'connection_message_template', label: 'Connection Message Template', type: 'textarea', placeholder: 'Hi {{firstName}}, I noticed your profile...' },
    { key: 'daily_limit', label: 'Daily Connection Limit', type: 'number', placeholder: '20' },
    { key: 'linkedin_cookie', label: 'LinkedIn Session Cookie (li_at)', type: 'textarea', placeholder: 'Paste your li_at cookie value here' }
  ],
  LEAD_GENERATION: [
    { key: 'icp_description', label: 'Ideal Customer Profile', type: 'textarea', placeholder: 'Business owners with 5-50 employees looking to automate their sales process...' },
    { key: 'high_score_threshold', label: 'Hot Lead Threshold (0-100)', type: 'number', placeholder: '70' }
  ],
  SOCIAL_MEDIA: [
    { key: 'business_description', label: 'Business Description', type: 'textarea', placeholder: 'What your business does...' },
    { key: 'tone', label: 'Tone', type: 'text', placeholder: 'professional / friendly / casual' },
    { key: 'posting_frequency', label: 'Posting Frequency', type: 'text', placeholder: 'daily / weekly' }
  ],
  ADVERTISING: [
    { key: 'meta_ad_account_id', label: 'Meta Ad Account ID', type: 'text', placeholder: 'act_XXXXXXX' },
    { key: 'google_ads_customer_id', label: 'Google Ads Customer ID', type: 'text', placeholder: '123-456-7890' },
    { key: 'daily_budget_limit', label: 'Daily Budget Limit ($)', type: 'number', placeholder: '100' },
    { key: 'alert_email', label: 'Alert Email', type: 'email', placeholder: 'alerts@yourbusiness.com' }
  ],
  APPOINTMENT_SETTER: [
    { key: 'booking_link', label: 'Booking Link', type: 'url', placeholder: 'https://calendly.com/...' }
  ],
  VOICE_INBOUND: [
    { key: 'greeting_script', label: 'Greeting Script', type: 'textarea', placeholder: 'Thank you for calling...' },
    { key: 'faq_knowledge_base', label: 'FAQ / Knowledge Base', type: 'textarea', placeholder: 'Common questions and answers...' },
    { key: 'escalation_number', label: 'Escalation Phone Number', type: 'text', placeholder: '+61400000000' },
    { key: 'booking_link', label: 'Booking Link', type: 'url', placeholder: 'https://calendly.com/...' }
  ],
  VOICE_OUTBOUND: [
    { key: 'call_script', label: 'Call Script', type: 'textarea', placeholder: 'Hi, this is...' },
    { key: 'max_daily_calls', label: 'Max Daily Calls', type: 'number', placeholder: '50' }
  ],
  VOICE_CLOSER: [
    { key: 'closing_script_template', label: 'Closing Script', type: 'textarea', placeholder: 'Hi {{firstName}}, calling to follow up...' },
    { key: 'offer_details', label: 'Offer Details', type: 'textarea', placeholder: 'What you are selling...' },
    { key: 'payment_link', label: 'Payment Link', type: 'url', placeholder: 'https://...' }
  ],
  CLIENT_SERVICES: []
}

export default function AdminConfigurePage() {
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState(ADMIN_SECRET)
  const [client, setClient] = useState<ClientInfo | null>(null)
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, Record<string, string>>>({})
  const [deploying, setDeploying] = useState<string | null>(null)
  const [deployResults, setDeployResults] = useState<Record<string, { success: boolean; message: string }>>({})

  async function loadClient() {
    if (!clientId.trim() || !secret.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/admin/agents/${clientId.trim()}`, {
        headers: { 'x-admin-secret': secret.trim() }
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const data = await res.json() as { client: ClientInfo; agents: AgentRow[] }
      setClient(data.client)
      setAgents(data.agents)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load client')
    } finally {
      setLoading(false)
    }
  }

  async function deployAgent(agentType: string) {
    setDeploying(agentType)
    setDeployResults(prev => ({ ...prev, [agentType]: { success: false, message: 'Deploying...' } }))
    try {
      const config = configs[agentType] || {}
      // Parse number fields
      const parsedConfig: Record<string, unknown> = { ...config }
      if (agentType === 'LINKEDIN_OUTREACH' && config.daily_limit) parsedConfig.daily_limit = parseInt(config.daily_limit)
      if (agentType === 'ADVERTISING' && config.daily_budget_limit) parsedConfig.daily_budget_limit = parseFloat(config.daily_budget_limit)
      if (agentType === 'VOICE_OUTBOUND' && config.max_daily_calls) parsedConfig.max_daily_calls = parseInt(config.max_daily_calls)
      if (config.high_score_threshold) parsedConfig.high_score_threshold = parseInt(config.high_score_threshold)

      const res = await fetch(`${API_URL}/admin/deploy-agent/${clientId.trim()}`, {
        method: 'POST',
        headers: { 'x-admin-secret': secret.trim(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentType, config: parsedConfig })
      })
      const data = await res.json() as { success?: boolean; error?: string; result?: unknown }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setDeployResults(prev => ({ ...prev, [agentType]: { success: true, message: 'Deployed successfully!' } }))
      // Refresh agent list
      await loadClient()
      setExpandedAgent(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deploy failed'
      setDeployResults(prev => ({ ...prev, [agentType]: { success: false, message: msg } }))
    } finally {
      setDeploying(null)
    }
  }

  function updateConfig(agentType: string, key: string, value: string) {
    setConfigs(prev => ({ ...prev, [agentType]: { ...(prev[agentType] || {}), [key]: value } }))
  }

  const undeployedAgents = agents.filter(a => !a.deployed || a.status === 'ERROR')
  const deployedAgents = agents.filter(a => a.deployed && a.status !== 'ERROR')

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: 900, margin: '0 auto', padding: 24, background: '#f9fafb', minHeight: '100vh' }}>
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 24, borderRadius: 12, marginBottom: 24 }}>
        <h1 style={{ color: 'white', margin: 0, fontSize: 24 }}>Admin — Agent Configuration</h1>
        <p style={{ color: 'rgba(255,255,255,0.8)', margin: '8px 0 0', fontSize: 14 }}>
          Deploy any agent for any client regardless of plan
        </p>
      </div>

      {/* Client Lookup */}
      <div style={{ background: 'white', borderRadius: 12, padding: 24, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 16, color: '#333' }}>Load Client</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="Client ID"
            style={{ flex: 1, minWidth: 240, padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          />
          <input
            value={secret}
            onChange={e => setSecret(e.target.value)}
            placeholder="Admin Secret"
            type="password"
            style={{ flex: 1, minWidth: 200, padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          />
          <button
            onClick={loadClient}
            disabled={loading}
            style={{ padding: '10px 24px', background: '#667eea', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
        {error && <p style={{ color: '#e53e3e', margin: '12px 0 0', fontSize: 14 }}>{error}</p>}
      </div>

      {client && (
        <>
          {/* Client Info */}
          <div style={{ background: 'white', borderRadius: 12, padding: 20, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Business</div>
              <div style={{ fontWeight: 600, color: '#333' }}>{client.businessName}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Email</div>
              <div style={{ color: '#333' }}>{client.email}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Plan</div>
              <div style={{ fontWeight: 600, color: '#667eea' }}>{client.plan}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Country</div>
              <div style={{ color: '#333' }}>{client.country || 'AU'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Client ID</div>
              <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 13 }}>{client.id}</div>
            </div>
          </div>

          {/* Unconfigured Agents */}
          {undeployedAgents.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, color: '#333', marginBottom: 12 }}>
                Not Configured ({undeployedAgents.length})
              </h2>
              {undeployedAgents.map(agent => {
                const isExpanded = expandedAgent === agent.agentType
                const fields = AGENT_CONFIG_FIELDS[agent.agentType] || []
                const result = deployResults[agent.agentType]
                const isDeploying = deploying === agent.agentType

                return (
                  <div key={agent.agentType} style={{ background: 'white', borderRadius: 12, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer' }}
                      onClick={() => setExpandedAgent(isExpanded ? null : agent.agentType)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 24 }}>{AGENT_ICONS[agent.agentType] || '🤖'}</span>
                        <div>
                          <div style={{ fontWeight: 600, color: '#333' }}>{AGENT_LABELS[agent.agentType] || agent.agentType}</div>
                          <div style={{ fontSize: 13, color: agent.status === 'ERROR' ? '#e53e3e' : '#888' }}>
                            {agent.status === 'ERROR' ? 'Error — needs redeploy' : 'Not deployed'}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {result && (
                          <span style={{ fontSize: 13, color: result.success ? '#38a169' : '#e53e3e' }}>{result.message}</span>
                        )}
                        <span style={{ fontSize: 20, color: '#667eea' }}>{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ borderTop: '1px solid #f0f0f0', padding: '20px 20px 24px' }}>
                        {fields.length > 0 ? (
                          <>
                            <p style={{ margin: '0 0 16px', fontSize: 14, color: '#666' }}>
                              Configure key settings below. All other settings use sensible defaults.
                            </p>
                            {fields.map(field => (
                              <div key={field.key} style={{ marginBottom: 16 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>
                                  {field.label}{field.required && <span style={{ color: '#e53e3e' }}> *</span>}
                                </label>
                                {field.type === 'textarea' ? (
                                  <textarea
                                    value={configs[agent.agentType]?.[field.key] || ''}
                                    onChange={e => updateConfig(agent.agentType, field.key, e.target.value)}
                                    placeholder={field.placeholder}
                                    rows={3}
                                    style={{ width: '100%', padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
                                  />
                                ) : (
                                  <input
                                    type={field.type}
                                    value={configs[agent.agentType]?.[field.key] || ''}
                                    onChange={e => updateConfig(agent.agentType, field.key, e.target.value)}
                                    placeholder={field.placeholder}
                                    style={{ width: '100%', padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                                  />
                                )}
                              </div>
                            ))}
                          </>
                        ) : (
                          <p style={{ margin: '0 0 16px', fontSize: 14, color: '#666' }}>
                            This agent uses default settings. Click Deploy to activate it.
                          </p>
                        )}
                        <button
                          onClick={() => deployAgent(agent.agentType)}
                          disabled={isDeploying}
                          style={{ padding: '10px 28px', background: isDeploying ? '#a0aec0' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', border: 'none', borderRadius: 8, cursor: isDeploying ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}
                        >
                          {isDeploying ? 'Deploying...' : `Deploy ${AGENT_LABELS[agent.agentType] || agent.agentType}`}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Configured Agents */}
          {deployedAgents.length > 0 && (
            <div>
              <h2 style={{ fontSize: 16, color: '#333', marginBottom: 12 }}>
                Configured ({deployedAgents.length})
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {deployedAgents.map(agent => (
                  <div key={agent.agentType} style={{ background: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 20 }}>{AGENT_ICONS[agent.agentType] || '🤖'}</span>
                      <div style={{ fontWeight: 600, color: '#333', fontSize: 14 }}>{AGENT_LABELS[agent.agentType] || agent.agentType}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: agent.status === 'ACTIVE' ? '#38a169' : agent.status === 'PAUSED' ? '#d69e2e' : '#718096' }} />
                      <span style={{ fontSize: 13, color: '#666' }}>{agent.status || 'Unknown'}</span>
                    </div>
                    {agent.n8nWorkflowId && (
                      <div style={{ fontSize: 12, color: '#aaa', marginTop: 6, fontFamily: 'monospace' }}>
                        N8N: {agent.n8nWorkflowId}
                      </div>
                    )}
                    <button
                      onClick={() => { setExpandedAgent(agent.agentType); setDeployResults({}) }}
                      style={{ marginTop: 12, padding: '6px 14px', background: '#f7fafc', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#667eea', fontWeight: 500 }}
                    >
                      Re-deploy
                    </button>
                    {expandedAgent === agent.agentType && (
                      <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                        {(AGENT_CONFIG_FIELDS[agent.agentType] || []).map(field => (
                          <div key={field.key} style={{ marginBottom: 10 }}>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>{field.label}</label>
                            {field.type === 'textarea' ? (
                              <textarea rows={2} value={configs[agent.agentType]?.[field.key] || ''} onChange={e => updateConfig(agent.agentType, field.key, e.target.value)} placeholder={field.placeholder} style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                            ) : (
                              <input type={field.type} value={configs[agent.agentType]?.[field.key] || ''} onChange={e => updateConfig(agent.agentType, field.key, e.target.value)} placeholder={field.placeholder} style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                            )}
                          </div>
                        ))}
                        <button onClick={() => deployAgent(agent.agentType)} disabled={deploying === agent.agentType} style={{ padding: '8px 18px', background: '#667eea', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                          {deploying === agent.agentType ? 'Deploying...' : 'Re-deploy'}
                        </button>
                        {deployResults[agent.agentType] && (
                          <span style={{ marginLeft: 10, fontSize: 13, color: deployResults[agent.agentType].success ? '#38a169' : '#e53e3e' }}>
                            {deployResults[agent.agentType].message}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {agents.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>No agents found for this client.</div>
          )}
        </>
      )}
    </div>
  )
}
