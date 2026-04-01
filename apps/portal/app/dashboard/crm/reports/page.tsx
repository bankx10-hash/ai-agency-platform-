'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface ReportSummary {
  pipeline: { stage: string; count: number; value: number }[]
  activities: { type: string; count: number }[]
  sources: { source: string; count: number }[]
  conversion: {
    totalContacts: number
    closedWon: number
    closedLost: number
    conversionRate: number
  }
  revenue: {
    closedWon: number
    pipeline: number
    average: number
  }
}

const STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: 'New Lead',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  CLOSED_WON: 'Closed Won',
  CLOSED_LOST: 'Closed Lost',
}

const STAGE_BAR_COLORS: Record<string, string> = {
  NEW_LEAD: 'bg-blue-400',
  CONTACTED: 'bg-cyan-400',
  QUALIFIED: 'bg-violet-400',
  PROPOSAL: 'bg-indigo-400',
  CLOSED_WON: 'bg-green-500',
  CLOSED_LOST: 'bg-red-400',
}

const ACTIVITY_ICONS: Record<string, string> = {
  NOTE: '📝',
  CALL: '📞',
  EMAIL: '✉️',
  APPOINTMENT: '📅',
  STAGE_CHANGE: '➡️',
  DEAL: '💰',
  TASK: '✅',
  AI_ACTION: '🤖',
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string | number; sub?: string; highlight?: boolean }) {
  return (
    <div className={`bg-white dark:bg-gray-900 rounded-xl border p-5 ${highlight ? 'border-indigo-300 dark:border-indigo-700' : 'border-gray-200 dark:border-gray-800'}`}>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${highlight ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-900 dark:text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function ReportsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchReport = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/crm/reports/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setReport(res.data)
    } catch (err) {
      console.error('Failed to fetch report:', err)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetchReport() }, [fetchReport])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!report) {
    return (
      <div className="text-center py-16 text-gray-500 dark:text-gray-400 text-sm">
        Failed to load report data.
      </div>
    )
  }

  const maxCount = Math.max(...report.pipeline.map(p => p.count), 1)
  const maxSourceCount = Math.max(...report.sources.map(s => s.count), 1)
  const maxActivityCount = Math.max(...report.activities.map(a => a.count), 1)

  const exportPDF = () => {
    window.print()
  }

  return (
    <div className="space-y-8">
      <style>{`
        @media print {
          header, .no-print { display: none !important; }
          body { background: white !important; }
          .print-header { display: block !important; }
          * { color-adjust: exact; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .print-header { display: none; }
      `}</style>

      <div className="print-header" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>CRM Performance Report</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
          Generated {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">CRM performance overview</p>
        </div>
        <button
          onClick={exportPDF}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Contacts"
          value={report.conversion.totalContacts}
          sub="in pipeline"
        />
        <StatCard
          label="Conversion Rate"
          value={`${report.conversion.conversionRate}%`}
          sub={`${report.conversion.closedWon} won · ${report.conversion.closedLost} lost`}
          highlight
        />
        <StatCard
          label="Revenue Won"
          value={`$${report.revenue.closedWon.toLocaleString()}`}
          sub="closed deals"
        />
        <StatCard
          label="Pipeline Value"
          value={`$${report.revenue.pipeline.toLocaleString()}`}
          sub={report.revenue.average > 0 ? `avg $${report.revenue.average.toLocaleString()}` : 'active deals'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline breakdown */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Pipeline Breakdown</h2>
          <div className="space-y-3">
            {report.pipeline.map(row => (
              <div key={row.stage}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600 dark:text-gray-300">{STAGE_LABELS[row.stage] || row.stage}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-900 dark:text-white">{row.count}</span>
                    {row.value > 0 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">${row.value.toLocaleString()}</span>
                    )}
                  </div>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${STAGE_BAR_COLORS[row.stage] || 'bg-indigo-400'}`}
                    style={{ width: `${(row.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {report.pipeline.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">No contacts yet</p>
            )}
          </div>
        </div>

        {/* Lead sources */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Lead Sources</h2>
          <div className="space-y-3">
            {report.sources.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No source data yet</p>
            ) : report.sources.map(row => (
              <div key={row.source}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600 dark:text-gray-300 capitalize">{row.source || 'Unknown'}</span>
                  <span className="text-xs font-medium text-gray-900 dark:text-white">{row.count}</span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 rounded-full transition-all"
                    style={{ width: `${(row.count / maxSourceCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Activity breakdown */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Activity Breakdown</h2>
        {report.activities.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No activities recorded yet</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {report.activities.map(row => (
              <div key={row.type} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
                <div className="text-2xl mb-2">{ACTIVITY_ICONS[row.type] || '📌'}</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                  {row.type.replace(/_/g, ' ').toLowerCase()}
                </p>
                <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{row.count}</p>
                <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 rounded-full"
                    style={{ width: `${(row.count / maxActivityCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conversion funnel */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Conversion Funnel</h2>
        <div className="flex items-end gap-1 h-32">
          {report.pipeline.map((row, i) => {
            const height = report.conversion.totalContacts > 0
              ? Math.max(8, Math.round((row.count / report.conversion.totalContacts) * 100))
              : 0
            return (
              <div key={row.stage} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{row.count}</span>
                <div
                  className={`w-full rounded-t-md ${STAGE_BAR_COLORS[row.stage] || 'bg-indigo-400'} transition-all`}
                  style={{ height: `${height}%` }}
                />
                <span className="text-xs text-gray-400 text-center leading-tight hidden sm:block" style={{ fontSize: 10 }}>
                  {(STAGE_LABELS[row.stage] || row.stage).replace(' ', '\n')}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
