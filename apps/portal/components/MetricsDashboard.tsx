interface DashboardMetrics {
  leadsToday: number
  callsMade: number
  appointmentsBooked: number
  emailsSent: number
  activeAgents: number
}

interface MetricCardProps {
  label: string
  value: number
  icon: React.ReactNode
  accentColor: string
  glowColor: string
  trend?: string
}

function MetricCard({ label, value, icon, accentColor, glowColor, trend }: MetricCardProps) {
  return (
    <div
      className="relative rounded-2xl p-5 overflow-hidden transition-all duration-300 group"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
      }}
    >
      {/* Ambient glow on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl"
        style={{ background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${glowColor} 0%, transparent 70%)` }}
      />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {label}
          </p>
          <p className="num text-3xl font-bold text-white mt-2.5 tracking-tight">
            {value.toLocaleString()}
          </p>
          {trend && (
            <p className="flex items-center gap-1 text-xs font-medium mt-2" style={{ color: '#34d399' }}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              {trend}
            </p>
          )}
        </div>

        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: `${accentColor}18`,
            border: `1px solid ${accentColor}30`,
            boxShadow: `0 0 16px ${accentColor}20`
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  )
}

export default function MetricsDashboard({ metrics }: { metrics: DashboardMetrics }) {
  const cards = [
    {
      label: 'Leads Today',
      value: metrics.leadsToday,
      accentColor: '#6366f1',
      glowColor: 'rgba(99,102,241,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="#6366f1" viewBox="0 0 24 24" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    },
    {
      label: 'Calls Made',
      value: metrics.callsMade,
      accentColor: '#a855f7',
      glowColor: 'rgba(168,85,247,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="#a855f7" viewBox="0 0 24 24" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      )
    },
    {
      label: 'Appointments',
      value: metrics.appointmentsBooked,
      accentColor: '#10b981',
      glowColor: 'rgba(16,185,129,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="#10b981" viewBox="0 0 24 24" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      label: 'Emails Sent',
      value: metrics.emailsSent,
      accentColor: '#38bdf8',
      glowColor: 'rgba(56,189,248,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="#38bdf8" viewBox="0 0 24 24" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      label: 'Active Agents',
      value: metrics.activeAgents,
      accentColor: '#f59e0b',
      glowColor: 'rgba(245,158,11,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="#f59e0b" viewBox="0 0 24 24" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      )
    }
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {cards.map(card => (
        <MetricCard key={card.label} {...card} />
      ))}
    </div>
  )
}
