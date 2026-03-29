'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Appointment {
  id: string
  contactId: string
  contactName?: string
  contactEmail?: string
  startTime: string
  title?: string
  bookedAt: string
}

interface AgentDeployment {
  id: string
  agentType: string
  status: string
  config: Record<string, unknown>
  metrics: Record<string, unknown>
}

// Fields shown in the config tab per agent type
const CONFIG_FIELDS: Record<string, Array<{ key: string; label: string; type: 'text' | 'textarea' | 'number'; placeholder: string; help?: string }>> = {
  VOICE_INBOUND: [
    { key: 'greeting_script', label: 'Welcome Greeting', type: 'textarea', placeholder: 'Thank you for calling [Business Name]! How can I help you today?', help: 'What the voice agent says when a call is answered.' },
    { key: 'faq_knowledge_base', label: 'FAQ / Knowledge Base', type: 'textarea', placeholder: 'Q: What are your hours?\nA: We are open Mon–Fri 9am–5pm...', help: 'Common questions and answers the agent uses to respond to callers.' },
    { key: 'escalation_number', label: 'Escalation Phone Number', type: 'text', placeholder: '+61400000000', help: 'Number to transfer the call to when the agent cannot help.' },
  ],
  VOICE_OUTBOUND: [
    { key: 'call_script', label: 'Call Script', type: 'textarea', placeholder: 'Hi, this is [Agent Name] calling from [Business]. I am reaching out because...', help: 'The script the outbound agent follows when making calls.' },
    { key: 'max_daily_calls', label: 'Max Daily Calls', type: 'number', placeholder: '50', help: 'Maximum number of outbound calls to make per day.' },
    { key: 'call_window_hours', label: 'Call Window Hours', type: 'text', placeholder: '9am-5pm AEST', help: 'Hours during which calls are allowed to be made.' },
  ],
  VOICE_CLOSER: [
    { key: 'closing_script_template', label: 'Closing Script', type: 'textarea', placeholder: 'Hi {{firstName}}, this is [Agent] calling to follow up on your interest in...', help: 'Script used by the closer agent when calling warm leads ready to buy.' },
    { key: 'offer_details', label: 'Offer Details', type: 'textarea', placeholder: 'Our premium package includes...', help: 'Details about what you are selling — the agent uses this to answer questions.' },
  ],
  SOCIAL_MEDIA: [
    { key: 'business_description', label: 'Business Description', type: 'textarea', placeholder: 'We are a Sydney-based electrical company specialising in residential and commercial...', help: 'Used by Claude to generate on-brand social media content.' },
    { key: 'tone', label: 'Tone of Voice', type: 'text', placeholder: 'professional, friendly, approachable', help: 'The tone Claude should use when writing posts.' },
    { key: 'posting_frequency', label: 'Posting Frequency', type: 'text', placeholder: 'daily', help: 'How often content should be posted (daily, weekly, etc).' },
  ],
  SOCIAL_ENGAGEMENT: [
    { key: 'business_description', label: 'Business Description', type: 'textarea', placeholder: 'What your business does...', help: 'Context Claude uses to understand how to respond to comments and DMs.' },
    { key: 'booking_link', label: 'Booking Link', type: 'text', placeholder: 'https://calendly.com/...', help: 'Link shared when someone is ready to book.' },
  ],
  APPOINTMENT_SETTER: [
    { key: 'booking_link', label: 'Booking Link', type: 'text', placeholder: 'https://calendly.com/...', help: 'The link sent to leads to book an appointment.' },
  ],
  LEAD_GENERATION: [
    { key: 'icp_description', label: 'Ideal Customer Profile (ICP)', type: 'textarea', placeholder: 'Business owners with 5–50 employees in the trades industry looking to automate...', help: 'Describes your ideal customer. Claude uses this to score leads.' },
    { key: 'high_score_threshold', label: 'Hot Lead Threshold (0–100)', type: 'number', placeholder: '70', help: 'Leads scored above this number are classed as hot and sent to the appointment setter.' },
  ],
  LINKEDIN_OUTREACH: [
    { key: 'connection_message_template', label: 'Connection Request Message', type: 'textarea', placeholder: 'Hi {{firstName}}, I came across your profile and...', help: 'Message sent with LinkedIn connection requests. Use {{firstName}} for personalisation.' },
    { key: 'daily_limit', label: 'Daily Connection Limit', type: 'number', placeholder: '20', help: 'Max connection invites per day (LinkedIn recommends ≤20).' },
  ],
}

const AGENT_LABELS: Record<string, string> = {
  VOICE_INBOUND: 'Voice Inbound Agent',
  VOICE_OUTBOUND: 'Voice Outbound Agent',
  VOICE_CLOSER: 'Voice Closer Agent',
  SOCIAL_MEDIA: 'Social Media Agent',
  SOCIAL_ENGAGEMENT: 'Social Engagement Agent',
  APPOINTMENT_SETTER: 'Appointment Setter Agent',
  LEAD_GENERATION: 'Lead Generation Agent',
  LINKEDIN_OUTREACH: 'LinkedIn Outreach Agent',
  ADVERTISING: 'Advertising Agent',
  CLIENT_SERVICES: 'Client Services Agent',
}

// Simple month calendar
function AppointmentCalendar({ appointments }: { appointments: Appointment[] }) {
  const [viewDate, setViewDate] = useState(() => new Date())
  const [selected, setSelected] = useState<string | null>(null)

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthStart = new Date(year, month, 1)
  const startDay = monthStart.getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Map of date string → appointments
  const apptsByDate: Record<string, Appointment[]> = {}
  for (const a of appointments) {
    const d = new Date(a.startTime)
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = d.getDate().toString()
      apptsByDate[key] = [...(apptsByDate[key] || []), a]
    }
  }

  const selectedAppts = selected ? apptsByDate[selected] || [] : []
  const monthName = viewDate.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)); setSelected(null) }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)); setSelected(null) }

  const todayStr = new Date().getDate().toString()
  const todayMonth = new Date().getMonth()
  const todayYear = new Date().getFullYear()
  const isCurrentMonth = month === todayMonth && year === todayYear

  return (
    <div className="space-y-6">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-base font-semibold text-gray-900">{monthName}</h3>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-100">
          {days.map(d => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-gray-400">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: startDay }).map((_, i) => (
            <div key={`empty-${i}`} className="h-16 border-b border-r border-gray-50" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = (i + 1).toString()
            const hasAppts = !!apptsByDate[day]
            const isToday = isCurrentMonth && day === todayStr
            const isSelected = selected === day
            return (
              <div
                key={day}
                onClick={() => setSelected(isSelected ? null : day)}
                className={`h-16 border-b border-r border-gray-50 p-1.5 cursor-pointer transition-colors ${
                  isSelected ? 'bg-indigo-50' : hasAppts ? 'hover:bg-gray-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium mb-1 ${
                  isToday ? 'bg-indigo-600 text-white' : 'text-gray-700'
                }`}>
                  {day}
                </div>
                {hasAppts && (
                  <div className="flex flex-wrap gap-0.5">
                    {(apptsByDate[day] || []).slice(0, 3).map((_, idx) => (
                      <div key={idx} className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected day appointments */}
      {selected && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h4 className="font-semibold text-gray-900 mb-4">
            {new Date(year, month, parseInt(selected)).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h4>
          {selectedAppts.length === 0 ? (
            <p className="text-sm text-gray-400">No appointments on this day.</p>
          ) : (
            <div className="space-y-3">
              {selectedAppts.map(a => (
                <div key={a.id} className="flex items-start gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {new Date(a.startTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{a.contactName || 'Unknown'}</div>
                    {a.title && <div className="text-xs text-gray-500 mt-0.5">{a.title}</div>}
                    {a.contactEmail && <div className="text-xs text-gray-400 mt-0.5">{a.contactEmail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upcoming list */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-900 mb-4">Upcoming Appointments</h4>
        {(() => {
          const upcoming = appointments
            .filter(a => new Date(a.startTime) >= new Date())
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .slice(0, 10)
          if (upcoming.length === 0) return <p className="text-sm text-gray-400">No upcoming appointments.</p>
          return (
            <div className="space-y-2">
              {upcoming.map(a => (
                <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="text-xs font-medium text-indigo-600 w-20 shrink-0">
                    {new Date(a.startTime).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  </div>
                  <div className="text-xs text-gray-500 w-14 shrink-0">
                    {new Date(a.startTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </div>
                  <div className="text-sm text-gray-900 font-medium truncate">{a.contactName || 'Unknown'}</div>
                  {a.contactEmail && <div className="text-xs text-gray-400 truncate">{a.contactEmail}</div>}
                </div>
              ))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

export default function AgentConfigurePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const agentId = params?.id as string

  const [agent, setAgent] = useState<AgentDeployment | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [form, setForm] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'config' | 'appointments'>('config')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function getToken() {
    return localStorage.getItem('token') || (session as { accessToken?: string })?.accessToken || ''
  }

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  useEffect(() => {
    if (!session || !agentId) return
    const token = getToken()

    Promise.all([
      axios.get(`${API_URL}/agents/${agentId}`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_URL}/agents/${agentId}/appointments`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { appointments: [] } }))
    ]).then(([agentRes, apptRes]) => {
      const a = agentRes.data.agent as AgentDeployment
      setAgent(a)
      // Pre-fill form from stored config
      const fields = CONFIG_FIELDS[a.agentType] || []
      const initial: Record<string, string> = {}
      for (const f of fields) {
        initial[f.key] = String((a.config as Record<string, unknown>)?.[f.key] ?? '')
      }
      setForm(initial)
      setAppointments(apptRes.data.appointments || [])
    }).catch(() => {
      setError('Failed to load agent.')
    }).finally(() => setLoading(false))
  }, [session, agentId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const token = getToken()
      // Parse number fields
      const parsed: Record<string, unknown> = { ...form }
      const fields = CONFIG_FIELDS[agent?.agentType || ''] || []
      for (const f of fields) {
        if (f.type === 'number' && form[f.key]) parsed[f.key] = Number(form[f.key])
      }
      await axios.patch(`${API_URL}/agents/${agentId}/config`, { config: parsed }, { headers: { Authorization: `Bearer ${token}` } })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Agent not found.</p>
      </div>
    )
  }

  const fields = CONFIG_FIELDS[agent.agentType] || []
  const label = AGENT_LABELS[agent.agentType] || agent.agentType
  const hasAppointments = agent.agentType === 'APPOINTMENT_SETTER'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard/agents" className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{label}</h1>
              <p className="text-xs text-gray-400 mt-0.5">Configure agent settings</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-medium text-gray-600 hover:text-gray-900">Dashboard</Link>
            <Link href="/dashboard/agents" className="text-sm font-medium text-indigo-600">Agents</Link>
            <Link href="/dashboard/connections" className="text-sm font-medium text-gray-600 hover:text-gray-900">Connections</Link>
            <Link href="/dashboard/settings" className="text-sm font-medium text-gray-600 hover:text-gray-900">Settings</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-8 w-fit">
          <button
            onClick={() => setTab('config')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === 'config' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Configuration
          </button>
          {hasAppointments && (
            <button
              onClick={() => setTab('appointments')}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === 'appointments' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Appointments
              {appointments.length > 0 && (
                <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                  {appointments.length}
                </span>
              )}
            </button>
          )}
        </div>

        {tab === 'config' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            {error && (
              <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</div>
            )}
            {saved && (
              <div className="mb-5 bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">Settings saved successfully.</div>
            )}

            {fields.length === 0 ? (
              <p className="text-gray-400 text-sm">No configurable settings for this agent type.</p>
            ) : (
              <form onSubmit={handleSave} className="space-y-6">
                {fields.map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-semibold text-gray-800 mb-1">{f.label}</label>
                    {f.help && <p className="text-xs text-gray-400 mb-2">{f.help}</p>}
                    {f.type === 'textarea' ? (
                      <textarea
                        rows={5}
                        value={form[f.key] || ''}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-y"
                      />
                    ) : (
                      <input
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={form[f.key] || ''}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      />
                    )}
                  </div>
                ))}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <p className="text-xs text-gray-400 mt-3">
                    Changes take effect on the agent&apos;s next run. To apply immediately, contact support for a redeploy.
                  </p>
                </div>
              </form>
            )}
          </div>
        )}

        {tab === 'appointments' && hasAppointments && (
          <AppointmentCalendar appointments={appointments} />
        )}
      </main>
    </div>
  )
}
