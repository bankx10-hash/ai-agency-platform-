'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import AgentCard from '../../components/AgentCard'
import MetricsDashboard from '../../components/MetricsDashboard'
import ThemeToggle from '../../components/ThemeToggle'
import NotificationBell from '../../components/NotificationBell'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface AgentDeployment {
  id: string
  agentType: string
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED' | 'ERROR'
  metrics?: {
    totalLeads?: number
    leadsToday?: number
    callsMade?: number
    appointmentsBooked?: number
    emailsSent?: number
    appointmentsToday?: number
  }
  updatedAt: string
}

interface DashboardMetrics {
  leadsToday: number
  callsMade: number
  appointmentsBooked: number
  emailsSent: number
  activeAgents: number
}

const NAV_LINKS = [
  { href: '/dashboard',                       label: 'Dashboard'   },
  { href: '/dashboard/agents',                label: 'Agents'      },
  { href: '/dashboard/analytics',             label: 'Analytics'   },
  { href: '/dashboard/crm/contacts',          label: 'CRM'         },
  { href: '/dashboard/voice',                 label: 'Voice'       },
  { href: '/dashboard/marketing/campaigns',   label: 'Marketing'   },
  { href: '/dashboard/inbox',                 label: 'Inbox'       },
  { href: '/dashboard/sms',                   label: 'SMS'         },
  { href: '/dashboard/connections',           label: 'Connections' },
  { href: '/dashboard/settings',              label: 'Settings'    },
]

const CONNECTIONS = [
  { key: 'facebook',        label: 'Facebook',    icon: 'F',  color: '#1877f2' },
  { key: 'instagram',       label: 'Instagram',   icon: 'IG', color: '#e1306c' },
  { key: 'linkedin',        label: 'LinkedIn',    icon: 'in', color: '#0a66c2' },
  { key: 'gmail',           label: 'Gmail',       icon: 'G',  color: '#ea4335' },
  { key: 'google-calendar', label: 'Google Cal',  icon: 'GC', color: '#4285f4' },
  { key: 'calendly',        label: 'Calendly',    icon: 'CL', color: '#006bff' },
  { key: 'calcom',          label: 'Cal.com',     icon: 'C',  color: '#292929' },
  { key: 'hubspot',         label: 'HubSpot',     icon: 'HS', color: '#ff7a59' },
  { key: 'gohighlevel',     label: 'GHL',         icon: 'GH', color: '#ef4444' },
  { key: 'salesforce',      label: 'Salesforce',  icon: 'SF', color: '#00a1e0' },
  { key: 'zoho',            label: 'Zoho CRM',    icon: 'Z',  color: '#e42527' },
  { key: 'twilio-phone',    label: 'Phone',       icon: '☎',  color: '#f22f46' },
]

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [agents, setAgents] = useState<AgentDeployment[]>([])
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    leadsToday: 0, callsMade: 0, appointmentsBooked: 0, emailsSent: 0, activeAgents: 0
  })
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

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

        const computedMetrics = agentsData.reduce((acc, agent) => {
          const m = agent.metrics || {}
          return {
            leadsToday: acc.leadsToday + (m.leadsToday || 0),
            callsMade: acc.callsMade + (m.callsMade || 0),
            appointmentsBooked: acc.appointmentsBooked + (m.appointmentsBooked || 0),
            emailsSent: acc.emailsSent + (m.emailsSent || 0),
            activeAgents: acc.activeAgents + (agent.status === 'ACTIVE' ? 1 : 0)
          }
        }, { leadsToday: 0, callsMade: 0, appointmentsBooked: 0, emailsSent: 0, activeAgents: 0 })

        setMetrics(computedMetrics)
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [session])

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07080d' }}>
        <div className="text-center">
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-4"
            style={{ borderColor: 'rgba(99,102,241,0.3)', borderTopColor: '#6366f1' }}
          />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>Loading your workspace...</p>
        </div>
      </div>
    )
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const connectedCount = Object.values(connections).filter(Boolean).length

  return (
    <div className="min-h-screen mesh-bg" style={{ background: '#07080d' }}>

      {/* ── Navigation ── */}
      <header
        className="sticky top-0 z-50"
        style={{
          background: 'rgba(7,8,13,0.80)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-4 flex-shrink-0">
            <img src="/nodus-logo.jpeg" alt="Nodus AI" className="h-7 w-auto object-contain rounded" />
            <div className="hidden sm:block w-px h-4" style={{ background: 'rgba(255,255,255,0.10)' }} />
            <span className="hidden sm:block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.30)' }}>
              AI Command Centre
            </span>
          </div>

          {/* Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
                style={{ color: 'rgba(255,255,255,0.50)' }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.90)'
                  ;(e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.06)'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.50)'
                  ;(e.currentTarget as HTMLAnchorElement).style.background = 'transparent'
                }}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <NotificationBell />
            <ThemeToggle />
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff',
                boxShadow: '0 0 12px rgba(99,102,241,0.35)'
              }}
            >
              {businessName.charAt(0).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-7xl mx-auto px-6 py-10">

        {/* Hero */}
        <div className="mb-10">
          <p className="text-xs font-medium mb-2" style={{ color: 'rgba(255,255,255,0.28)', letterSpacing: '0.08em' }}>
            {today.toUpperCase()}
          </p>
          <h1 className="text-2xl font-bold text-white mb-1.5">
            {getGreeting()},{' '}
            <span style={{
              background: 'linear-gradient(90deg, #6366f1, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              {businessName}
            </span>
          </h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.38)' }}>
            Your AI agents are running autonomously. Here&apos;s today&apos;s performance.
          </p>
        </div>

        {/* Metrics */}
        <MetricsDashboard metrics={metrics} />

        {/* Agents */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-white">AI Agents</h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
                {metrics.activeAgents} of {agents.length} active
              </p>
            </div>
            <Link
              href="/dashboard/agents"
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              style={{
                color: '#6366f1',
                background: 'rgba(99,102,241,0.10)',
                border: '1px solid rgba(99,102,241,0.20)'
              }}
            >
              View all →
            </Link>
          </div>

          {agents.length === 0 ? (
            <div
              className="rounded-2xl p-14 text-center"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderStyle: 'dashed'
              }}
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
                style={{ background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.20)' }}
              >
                <svg className="w-7 h-7" fill="none" stroke="#6366f1" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-white mb-1.5">No agents deployed yet</h3>
              <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Your agents are being configured. This usually takes 2–3 minutes.
              </p>
              <Link
                href="/onboarding/complete"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  boxShadow: '0 0 20px rgba(99,102,241,0.30)'
                }}
              >
                Check setup status
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.slice(0, 6).map(agent => (
                <AgentCard key={agent.id} agent={agent} onStatusChange={() => {}} />
              ))}
            </div>
          )}
        </div>

        {/* Connected Accounts */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-white">Connected Accounts</h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
                {connectedCount} of {CONNECTIONS.length} connected
              </p>
            </div>
            <Link
              href="/dashboard/connections"
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              style={{
                color: 'rgba(255,255,255,0.45)',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)'
              }}
            >
              Manage →
            </Link>
          </div>

          <div
            className="rounded-2xl p-5"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)'
            }}
          >
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {CONNECTIONS.map(({ key, label, icon, color }) => {
                const isConnected = !!connections[key]
                return (
                  <div
                    key={key}
                    className="relative flex flex-col items-center gap-2.5 p-3.5 rounded-xl transition-all duration-200 group"
                    style={{
                      background: isConnected ? `${color}0d` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isConnected ? `${color}28` : 'rgba(255,255,255,0.05)'}`,
                    }}
                  >
                    {/* Brand icon */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: isConnected ? `${color}22` : 'rgba(255,255,255,0.05)',
                        color: isConnected ? color : 'rgba(255,255,255,0.25)',
                        border: `1px solid ${isConnected ? `${color}35` : 'transparent'}`
                      }}
                    >
                      {icon}
                    </div>

                    <span
                      className="text-xs font-medium text-center leading-tight"
                      style={{ color: isConnected ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)' }}
                    >
                      {label}
                    </span>

                    {/* Status dot */}
                    <div className="flex items-center gap-1">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: isConnected ? '#34d399' : 'rgba(255,255,255,0.15)' }}
                      />
                      <span
                        className="text-[10px] font-medium"
                        style={{ color: isConnected ? '#34d399' : 'rgba(255,255,255,0.20)' }}
                      >
                        {isConnected ? 'Live' : 'Off'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer spacer */}
        <div className="h-16" />
      </main>
    </div>
  )
}
