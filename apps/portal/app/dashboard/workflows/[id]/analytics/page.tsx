'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Analytics {
  total: number
  inProgress: number
  completed: number
  qualified: number
  disqualified: number
  timedOut: number
  qualificationRate: number
  avgScore: number
  channelBreakdown: Record<string, number>
  dropOffByQuestion: { questionId: string; questionText: string; order: number; answeredCount: number; dropOffRate: number }[]
}

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
}

export default function WorkflowAnalyticsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchAnalytics = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/workflows/${params.id}/analytics`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setAnalytics(res.data)
    } catch {
      console.error('Failed to fetch analytics')
    } finally {
      setLoading(false)
    }
  }, [session, params.id])

  useEffect(() => { fetchAnalytics() }, [fetchAnalytics])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!analytics) return <div className="text-gray-500">No data available</div>

  return (
    <div>
      <div className="mb-6">
        <button onClick={() => router.push(`/dashboard/workflows/${params.id}`)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-1">
          &larr; Back to Workflow
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Workflow Analytics</h1>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {[
          { label: 'Total', value: analytics.total, color: 'text-gray-900 dark:text-white' },
          { label: 'In Progress', value: analytics.inProgress, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Qualified', value: analytics.qualified, color: 'text-green-600 dark:text-green-400' },
          { label: 'Disqualified', value: analytics.disqualified, color: 'text-red-600 dark:text-red-400' },
          { label: 'Timed Out', value: analytics.timedOut, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Avg Score', value: analytics.avgScore, color: 'text-indigo-600 dark:text-indigo-400' },
        ].map(stat => (
          <div key={stat.label} className="theme-card rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold num ${stat.color}`}>{stat.value}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Qualification Rate */}
      <div className="theme-card rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Qualification Rate</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
            <div className="bg-green-500 h-full rounded-full transition-all" style={{ width: `${analytics.qualificationRate}%` }} />
          </div>
          <span className="text-lg font-bold text-green-600 dark:text-green-400 num">{analytics.qualificationRate}%</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Channel Breakdown */}
        <div className="theme-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Channel Breakdown</h3>
          {Object.keys(analytics.channelBreakdown).length === 0 ? (
            <p className="text-sm text-gray-400">No conversations yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(analytics.channelBreakdown).map(([ch, count]) => (
                <div key={ch} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{CHANNEL_LABELS[ch] || ch}</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white num">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Drop-off by Question */}
        <div className="theme-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Drop-off by Question</h3>
          {analytics.dropOffByQuestion.length === 0 ? (
            <p className="text-sm text-gray-400">No data yet</p>
          ) : (
            <div className="space-y-3">
              {analytics.dropOffByQuestion.map((q, i) => (
                <div key={q.questionId}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-600 dark:text-gray-400 truncate max-w-[200px]">Q{i + 1}: {q.questionText}</span>
                    <span className="text-gray-500 num">{q.answeredCount} answered</span>
                  </div>
                  <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-indigo-500 h-full rounded-full transition-all"
                      style={{ width: `${analytics.total > 0 ? (q.answeredCount / analytics.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
