'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const STEP_TYPE_ICONS: Record<string, string> = {
  LANDING: '🏠', OPT_IN: '📋', UPSELL: '💰', THANK_YOU: '🎉',
  SALES_PAGE: '🛒', WEBINAR: '🎥', CHECKOUT: '💳',
}

interface FunnelStep {
  id: string
  name: string
  type: string
  order: number
  headline?: string
  subheadline?: string
  ctaText?: string
}

interface Funnel {
  id: string
  name: string
  description?: string
  status: string
  createdAt: string
  steps: FunnelStep[]
  _count?: { submissions: number }
}

interface Submission {
  id: string
  createdAt: string
  data?: Record<string, string>
  ip?: string
  step?: { name: string; type: string }
}

export default function FunnelDetailPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [stepCounts, setStepCounts] = useState<Record<string, number>>({})
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'submissions'>('overview')
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchData = useCallback(async () => {
    if (!session) return
    try {
      const token = localStorage.getItem('token') || ''
      const [funnelRes, submissionsRes] = await Promise.all([
        axios.get(`${API_URL}/marketing/funnels/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/marketing/funnels/${id}/submissions`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      setFunnel(funnelRes.data.funnel)
      setStepCounts(funnelRes.data.stepCounts || {})
      setSubmissions(submissionsRes.data.submissions)
    } catch {
      console.error('Failed to fetch funnel')
    } finally {
      setLoading(false)
    }
  }, [session, id])

  useEffect(() => { fetchData() }, [fetchData])

  async function toggleStatus() {
    if (!funnel) return
    setToggling(true)
    try {
      const token = localStorage.getItem('token') || ''
      const newStatus = funnel.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE'
      await axios.patch(`${API_URL}/marketing/funnels/${id}`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFunnel(prev => prev ? { ...prev, status: newStatus } : prev)
    } catch {
      console.error('Failed to toggle status')
    } finally {
      setToggling(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this funnel and all its data?')) return
    const token = localStorage.getItem('token') || ''
    await axios.delete(`${API_URL}/marketing/funnels/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    router.push('/dashboard/marketing/funnels')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!funnel) return <div className="text-gray-500 text-sm">Funnel not found.</div>

  const totalSubmissions = funnel._count?.submissions ?? submissions.length
  const conversionRate = funnel.steps.length > 1 && (stepCounts[funnel.steps[0]?.id] || 0) > 0
    ? Math.round(((stepCounts[funnel.steps[funnel.steps.length - 1]?.id] || 0) / stepCounts[funnel.steps[0]?.id]) * 100)
    : 0

  // Public embed URL
  const submitUrl = `${API_URL}/marketing/funnels/${id}/submit`

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <button onClick={() => router.push('/dashboard/marketing/funnels')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mt-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{funnel.name}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                funnel.status === 'ACTIVE'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}>
                {funnel.status}
              </span>
            </div>
            {funnel.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{funnel.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleStatus}
            disabled={toggling}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
              funnel.status === 'ACTIVE'
                ? 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                : 'border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
            }`}
          >
            {toggling ? '...' : funnel.status === 'ACTIVE' ? 'Pause Funnel' : 'Activate Funnel'}
          </button>
          <button onClick={handleDelete} className="px-4 py-2 text-sm border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
            Delete
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Submissions</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{totalSubmissions}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Steps</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{funnel.steps.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Conversion</p>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{conversionRate}%</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {(['overview', 'submissions'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Funnel flow */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Funnel Flow</h2>
            <div className="space-y-3">
              {funnel.steps.map((step, i) => {
                const count = stepCounts[step.id] || 0
                const prevCount = i > 0 ? (stepCounts[funnel.steps[i - 1].id] || 0) : count
                const dropOff = prevCount > 0 && i > 0 ? Math.round(((prevCount - count) / prevCount) * 100) : 0

                return (
                  <div key={step.id}>
                    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-400 flex-shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{STEP_TYPE_ICONS[step.type] || '📄'}</span>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{step.name}</span>
                        </div>
                        {step.headline && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{step.headline}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{count}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">views</p>
                      </div>
                    </div>
                    {i < funnel.steps.length - 1 && (
                      <div className="flex items-center gap-2 pl-6 py-1">
                        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 ml-3" />
                        {dropOff > 0 && (
                          <span className="text-xs text-red-500 dark:text-red-400 ml-2">{dropOff}% drop-off</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* API endpoint info */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Opt-In Form Integration</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Send form submissions to this endpoint. Contacts are automatically added to your CRM at NEW_LEAD stage.
            </p>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <code className="text-xs font-mono text-indigo-600 dark:text-indigo-400 break-all">
                POST {submitUrl}
              </code>
            </div>
            <div className="mt-3 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <code className="text-xs font-mono text-gray-600 dark:text-gray-300 block whitespace-pre">{`{
  "name": "Contact Name",
  "email": "email@example.com",
  "phone": "+61 400 000 000",
  "stepId": "${funnel.steps.find(s => s.type === 'OPT_IN')?.id || funnel.steps[0]?.id || 'step-id'}"
}`}</code>
            </div>
          </div>
        </div>
      )}

      {tab === 'submissions' && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {submissions.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
              No submissions yet. {funnel.status !== 'ACTIVE' && 'Activate the funnel to start receiving submissions.'}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden sm:table-cell">Step</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {submissions.map(sub => (
                  <tr key={sub.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{sub.data?.name || '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{sub.data?.email || sub.data?.phone || '—'}</p>
                    </td>
                    <td className="px-6 py-3 hidden sm:table-cell">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {sub.step ? `${STEP_TYPE_ICONS[sub.step.type] || '📄'} ${sub.step.name}` : '—'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(sub.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
