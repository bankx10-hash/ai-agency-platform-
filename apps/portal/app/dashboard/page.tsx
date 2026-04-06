'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import AgentCard from '../../components/AgentCard'
import MetricsDashboard from '../../components/MetricsDashboard'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface AgentDeployment {
  id: string; agentType: string
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED' | 'ERROR'
  metrics?: { totalLeads?: number; leadsToday?: number; callsMade?: number; appointmentsBooked?: number; emailsSent?: number; appointmentsToday?: number }
  updatedAt: string
}

interface DashboardMetrics {
  leadsToday: number; callsMade: number; appointmentsBooked: number; emailsSent: number; activeAgents: number
}

interface AgentHealthCheck {
  agentType: string
  deploymentId: string
  status: 'healthy' | 'degraded' | 'down'
  checks: { db: boolean; n8n: boolean; retell: boolean }
  lastError?: string
}

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  healthy:  { color: '#22c55e', label: 'Healthy' },
  degraded: { color: '#eab308', label: 'Degraded' },
  down:     { color: '#ef4444', label: 'Down' },
}

function AgentHealthStatus({ clientId }: { clientId: string }) {
  const [healthData, setHealthData] = useState<AgentHealthCheck[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token') || ''
    axios.get(`${API_URL}/agents/health/${clientId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => setHealthData(res.data.agents || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) return null
  if (healthData.length === 0) return null

  return (
    <div>
      <SectionHeader title="Agent Health" badge={`${healthData.filter(a => a.status === 'healthy').length}/${healthData.length} healthy`} href="/dashboard/agents" linkLabel="Details" />
      <div className="theme-card rounded-xl p-4">
        <div className="space-y-2">
          {healthData.map(agent => {
            const dot = STATUS_DOT[agent.status] || STATUS_DOT.down
            const label = agent.agentType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            return (
              <div key={agent.deploymentId} className="flex items-center justify-between py-1.5 px-2 rounded-lg" style={{ background: 'var(--bg-secondary, transparent)' }}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot.color }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
                </div>
                <span className="text-[11px] font-medium" style={{ color: dot.color }}>{dot.label}</span>
              </div>
            )
          })}
        </div>
        {healthData.some(a => a.lastError) && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-card)' }}>
            {healthData.filter(a => a.lastError).map(a => (
              <p key={a.deploymentId} className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                {a.agentType.replace(/_/g, ' ')}: {a.lastError}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const CONNECTIONS = [
  { key: 'facebook',        label: 'Facebook',   color: '#1877f2', abbr: 'FB' },
  { key: 'instagram',       label: 'Instagram',  color: '#e1306c', abbr: 'IG' },
  { key: 'linkedin',        label: 'LinkedIn',   color: '#0a66c2', abbr: 'in' },
  { key: 'gmail',           label: 'Gmail',      color: '#ea4335', abbr: 'G'  },
  { key: 'google-calendar', label: 'G. Calendar',color: '#4285f4', abbr: 'GC' },
  { key: 'calendly',        label: 'Calendly',   color: '#006bff', abbr: 'CL' },
  { key: 'calcom',          label: 'Cal.com',    color: '#111',    abbr: 'CC' },
  { key: 'hubspot',         label: 'HubSpot',    color: '#ff7a59', abbr: 'HS' },
  { key: 'gohighlevel',     label: 'GHL',        color: '#ef4444', abbr: 'GH' },
  { key: 'salesforce',      label: 'Salesforce', color: '#00a1e0', abbr: 'SF' },
  { key: 'zoho',            label: 'Zoho',       color: '#e42527', abbr: 'Z'  },
  { key: 'twilio-phone',    label: 'Phone',      color: '#f22f46', abbr: '☎'  },
]

function SectionHeader({ title, badge, href, linkLabel = 'View all' }: { title: string; badge?: string; href: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {badge && <span className="text-[11px] px-1.5 py-0.5 rounded-md font-medium" style={{ color: 'var(--text-muted)', background: 'var(--border-card)' }}>{badge}</span>}
      </div>
      <Link href={href} className="text-xs font-medium" style={{ color: '#2563eb' }}>{linkLabel} →</Link>
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [agents, setAgents] = useState<AgentDeployment[]>([])
  const [metrics, setMetrics] = useState<DashboardMetrics>({ leadsToday: 0, callsMade: 0, appointmentsBooked: 0, emailsSent: 0, activeAgents: 0 })
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<Record<string, boolean>>({})

  useEffect(() => { if (status === 'unauthenticated') router.push('/login') }, [status, router])

  useEffect(() => {
    if (!session) return
    const fetchData = async () => {
      try {
        const clientId = (session.user as { clientId?: string })?.clientId
        const token = localStorage.getItem('token') || (session as { accessToken?: string })?.accessToken || ''
        if (!clientId) return

        const headers = { Authorization: `Bearer ${token}` }
        const [clientRes, agentsRes, connectionsRes, callStatsRes] = await Promise.all([
          axios.get(`${API_URL}/clients/${clientId}`, { headers }),
          axios.get(`${API_URL}/clients/${clientId}/agents`, { headers }),
          axios.get(`${API_URL}/onboarding/${clientId}/connections`, { headers }).catch(() => ({ data: { connected: {} } })),
          axios.get(`${API_URL}/calls/stats`, { headers }).catch(() => ({ data: { total: 0, today: 0, appointmentsBooked: 0 } }))
        ])

        const clientData = clientRes.data.client
        // Store plan for sidebar filtering and onboarding
        if (clientData.plan) localStorage.setItem('clientPlan', clientData.plan)
        if (clientData.status === 'PENDING') {
          // Check onboarding step — step 1 = needs plan selection, step 2+ = go to connect
          const onboardingStep = clientData.onboarding?.step || 1
          if (onboardingStep <= 1 && !clientData.stripeSubId) {
            router.push('/onboarding')
          } else {
            router.push(`/onboarding/connect?clientId=${clientId}`)
          }
          return
        }

        const agentsData: AgentDeployment[] = agentsRes.data.agents
        const callStats = callStatsRes.data
        setBusinessName(clientData.businessName)
        setAgents(agentsData)
        setConnections((connectionsRes.data as { connected: Record<string, boolean> }).connected || {})

        setMetrics(agentsData.reduce((acc, a) => ({
          leadsToday:         acc.leadsToday + (a.metrics?.leadsToday ?? 0),
          callsMade:          acc.callsMade,
          appointmentsBooked: acc.appointmentsBooked,
          emailsSent:         acc.emailsSent + (a.metrics?.emailsSent ?? 0),
          activeAgents:       acc.activeAgents + (a.status === 'ACTIVE' ? 1 : 0)
        }), {
          leadsToday: 0,
          callsMade: callStats.total || 0,
          appointmentsBooked: callStats.appointmentsBooked || 0,
          emailsSent: 0,
          activeAgents: 0
        }))
      } catch (err) { console.error(err) } finally { setLoading(false) }
    }
    fetchData()
  }, [session])

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'rgba(37,99,235,0.3)', borderTopColor: '#2563eb' }} />
      </div>
    )
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const connectedCount = Object.values(connections).filter(Boolean).length

  return (
    <div className="max-w-6xl space-y-6">

      {/* Page title */}
      <div>
        <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>{today}</p>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          {getGreeting()}, <span style={{ color: '#2563eb' }}>{businessName}</span>
        </h1>
      </div>

      {/* Metrics */}
      <MetricsDashboard metrics={metrics} />

      {/* Agents */}
      <div>
        <SectionHeader
          title="AI Agents"
          badge={`${metrics.activeAgents} active`}
          href="/dashboard/agents"
        />
        {agents.length === 0 ? (
          <div className="theme-card rounded-xl p-8 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No agents deployed yet</p>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Your agents are being configured — usually takes 2–3 minutes.</p>
            <Link href="/onboarding/complete" className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors">
              Check setup status
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {agents.slice(0, 6).map(agent => (
              <AgentCard key={agent.id} agent={agent} onStatusChange={() => {}} />
            ))}
          </div>
        )}
      </div>

      {/* Agent Health */}
      {(() => {
        const clientId = (session?.user as { clientId?: string })?.clientId
        return clientId ? <AgentHealthStatus clientId={clientId} /> : null
      })()}

      {/* Connected accounts */}
      <div>
        <SectionHeader
          title="Connected Accounts"
          badge={`${connectedCount}/${CONNECTIONS.length}`}
          href="/dashboard/connections"
          linkLabel="Manage"
        />
        <div className="theme-card rounded-xl p-4">
          <div className="flex flex-wrap gap-2">
            {CONNECTIONS.map(({ key, label, color, abbr }) => {
              const on = !!connections[key]
              return (
                <div
                  key={key}
                  title={`${label} — ${on ? 'Connected' : 'Not connected'}`}
                  className="relative flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background:   on ? `${color}10` : 'var(--border-card)',
                    border:       `1px solid ${on ? `${color}30` : 'transparent'}`,
                    color:        on ? color : 'var(--text-muted)',
                  }}
                >
                  <span className="font-bold text-[11px]">{abbr}</span>
                  <span style={{ color: on ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{label}</span>
                  {/* status dot */}
                  <span className="w-1.5 h-1.5 rounded-full ml-0.5" style={{ background: on ? '#22c55e' : '#cbd5e1' }} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

    </div>
  )
}
