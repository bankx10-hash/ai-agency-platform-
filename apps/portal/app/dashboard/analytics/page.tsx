'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts'
import ThemeToggle from '../../../components/ThemeToggle'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
const COLORS = ['#667eea', '#764ba2', '#06d6a0', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

interface AgentDeployment {
  id: string
  agentType: string
  status: string
  metrics?: {
    totalLeads?: number
    callsMade?: number
    appointmentsBooked?: number
    emailsSent?: number
    postsPublished?: number
  }
}

interface DayHistory {
  date: string
  leads: number
  calls: number
  appointments: number
  emails: number
  posts: number
}

export default function AnalyticsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [agents, setAgents] = useState<AgentDeployment[]>([])
  const [history, setHistory] = useState<DayHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  useEffect(() => {
    if (!session) return
    const clientId = (session.user as { clientId?: string })?.clientId
    const token = localStorage.getItem('token') || ''
    const headers = { Authorization: `Bearer ${token}` }

    Promise.all([
      axios.get(`${API_URL}/clients/${clientId}/agents`, { headers }),
      axios.get(`${API_URL}/clients/${clientId}/analytics`, { headers })
    ]).then(([agentsRes, analyticsRes]) => {
      setAgents(agentsRes.data.agents)
      setHistory(analyticsRes.data.history || [])
    }).catch(err => {
      console.error('Failed to fetch analytics:', err)
    }).finally(() => setLoading(false))
  }, [session])

  // Format date as "Mar 30"
  const chartData = history.map(d => ({
    ...d,
    day: new Date(d.date + 'T00:00:00').toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
  }))

  const agentPieData = agents.map((agent, i) => ({
    name: agent.agentType.replace(/_/g, ' '),
    value: (agent.metrics?.totalLeads || 0) + (agent.metrics?.callsMade || 0) + (agent.metrics?.postsPublished || 0),
    color: COLORS[i % COLORS.length]
  })).filter(d => d.value > 0)

  const totalMetrics = agents.reduce((acc, a) => ({
    leads: acc.leads + (a.metrics?.totalLeads || 0),
    calls: acc.calls + (a.metrics?.callsMade || 0),
    appointments: acc.appointments + (a.metrics?.appointmentsBooked || 0),
    emails: acc.emails + (a.metrics?.emailsSent || 0),
    posts: acc.posts + (a.metrics?.postsPublished || 0)
  }), { leads: 0, calls: 0, appointments: 0, emails: 0, posts: 0 })

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Analytics</h1>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Dashboard</Link>
            <Link href="/dashboard/agents" className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Agents</Link>
            <Link href="/dashboard/analytics" className="text-sm font-medium text-indigo-600 dark:text-indigo-400">Analytics</Link>
            <Link href="/dashboard/settings" className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Settings</Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* All-time totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Total Leads', value: totalMetrics.leads, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
            { label: 'Calls Made', value: totalMetrics.calls, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
            { label: 'Appointments', value: totalMetrics.appointments, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
            { label: 'Emails Sent', value: totalMetrics.emails, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
            { label: 'Posts Published', value: totalMetrics.posts, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-50 dark:bg-pink-900/20' }
          ].map(metric => (
            <div key={metric.label} className={`${metric.bg} rounded-xl p-4`}>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{metric.label}</p>
              <p className={`text-3xl font-black ${metric.color} mt-1`}>{metric.value.toLocaleString()}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">All time</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Daily activity — real historical data */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Daily Activity</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">Last {chartData.length || 0} days — real data</p>
            {chartData.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
                Data will appear here after the first full day of activity
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb' }} />
                  <Legend />
                  <Line type="monotone" dataKey="leads" stroke="#667eea" strokeWidth={2} dot={{ r: 3 }} name="Leads" />
                  <Line type="monotone" dataKey="calls" stroke="#764ba2" strokeWidth={2} dot={{ r: 3 }} name="Calls" />
                  <Line type="monotone" dataKey="appointments" stroke="#06d6a0" strokeWidth={2} dot={{ r: 3 }} name="Appointments" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Email & posts volume — real historical data */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Email & Social Volume</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">Last {chartData.length || 0} days — real data</p>
            {chartData.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
                Data will appear here after the first full day of activity
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb' }} />
                  <Bar dataKey="emails" fill="#667eea" radius={[4, 4, 0, 0]} name="Emails" />
                  <Bar dataKey="posts" fill="#ec4899" radius={[4, 4, 0, 0]} name="Posts" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {agentPieData.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-6">Activity by Agent</h2>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={agentPieData} cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={3} dataKey="value">
                    {agentPieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb' }} formatter={(value) => [value, 'Total Actions']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
