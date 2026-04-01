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

        const [clientRes, agentsRes, connectionsRes] = await Promise.all([
          axios.get(`${API_URL}/clients/${clientId}`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_URL}/clients/${clientId}/agents`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_URL}/onboarding/${clientId}/connections`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { connected: {} } }))
        ])

        const clientData = clientRes.data.client
        if (clientData.status === 'PENDING') { router.push(`/onboarding/connect?clientId=${clientId}`); return }

        const agentsData: AgentDeployment[] = agentsRes.data.agents
        setBusinessName(clientData.businessName)
        setAgents(agentsData)
        setConnections((connectionsRes.data as { connected: Record<string, boolean> }).connected || {})

        setMetrics(agentsData.reduce((acc, a) => ({
          leadsToday:         acc.leadsToday + (a.metrics?.leadsToday ?? 0),
          callsMade:          acc.callsMade + (a.metrics?.callsMade ?? 0),
          appointmentsBooked: acc.appointmentsBooked + (a.metrics?.appointmentsBooked ?? 0),
          emailsSent:         acc.emailsSent + (a.metrics?.emailsSent ?? 0),
          activeAgents:       acc.activeAgents + (a.status === 'ACTIVE' ? 1 : 0)
        }), { leadsToday: 0, callsMade: 0, appointmentsBooked: 0, emailsSent: 0, activeAgents: 0 }))
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
