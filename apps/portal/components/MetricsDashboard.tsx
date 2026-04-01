interface DashboardMetrics {
  leadsToday: number
  callsMade: number
  appointmentsBooked: number
  emailsSent: number
  activeAgents: number
}

const CARDS = (m: DashboardMetrics) => [
  { label: 'Leads Today',    value: m.leadsToday,        color: '#2563eb', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { label: 'Calls Made',     value: m.callsMade,         color: '#7c3aed', icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z' },
  { label: 'Appointments',   value: m.appointmentsBooked,color: '#059669', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { label: 'Emails Sent',    value: m.emailsSent,        color: '#d97706', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { label: 'Active Agents',  value: m.activeAgents,      color: '#dc2626', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
]

export default function MetricsDashboard({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {CARDS(metrics).map(({ label, value, color, icon }) => (
        <div key={label} className="theme-card rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}15` }}>
            <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d={icon} />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="num text-xl font-bold leading-none" style={{ color: 'var(--text-primary)' }}>{value.toLocaleString()}</p>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
