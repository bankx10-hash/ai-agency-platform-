'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

type Period = '7d' | '30d' | '90d'

interface OverviewData {
  period: string
  platformInsights: Record<string, number>
  timeSeries: Array<{ metric: string; platform: string; value: number; endTime: string }>
  posts: {
    published: number
    totalEngagements: number
    totalImpressions: number
    totalReach: number
    avgEngagementRate: string
  }
}

interface PostAnalytics {
  id: string
  platform: string
  content: string
  impressions: number
  reach: number
  engagements: number
  engagementRate: string
}

export default function SocialAnalyticsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [posts, setPosts] = useState<PostAnalytics[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [period, setPeriod] = useState<Period>('30d')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchData = useCallback(async () => {
    if (!session) return
    const token = localStorage.getItem('token') || ''
    const headers = { Authorization: `Bearer ${token}` }

    try {
      const [overviewRes, postsRes] = await Promise.all([
        axios.get(`${API_URL}/social/analytics/overview?period=${period}`, { headers }),
        axios.get(`${API_URL}/social/analytics/posts?sortBy=engagements&limit=10`, { headers })
      ])
      setOverview(overviewRes.data)
      setPosts(postsRes.data)
    } catch (err) {
      console.error('Failed to fetch social analytics:', err)
    } finally {
      setLoading(false)
    }
  }, [session, period])

  useEffect(() => {
    setLoading(true)
    fetchData()
  }, [fetchData])

  const handleRefresh = async () => {
    const token = localStorage.getItem('token') || ''
    const headers = { Authorization: `Bearer ${token}` }
    setRefreshing(true)
    try {
      await axios.post(`${API_URL}/social/analytics/refresh`, {}, { headers })
      await fetchData()
    } catch (err) {
      console.error('Failed to refresh analytics:', err)
    } finally {
      setRefreshing(false)
    }
  }

  // Build chart data from timeSeries: group by date, aggregate metrics
  const chartData = (() => {
    if (!overview?.timeSeries?.length) return []
    const grouped: Record<string, { date: string; impressions: number; reach: number; engagements: number }> = {}
    for (const point of overview.timeSeries) {
      const date = point.endTime.slice(0, 10)
      if (!grouped[date]) {
        grouped[date] = { date, impressions: 0, reach: 0, engagements: 0 }
      }
      const metric = point.metric.toLowerCase()
      if (metric.includes('impression')) grouped[date].impressions += point.value
      else if (metric.includes('reach')) grouped[date].reach += point.value
      else if (metric.includes('engage') || metric.includes('click') || metric.includes('reaction'))
        grouped[date].engagements += point.value
    }
    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date))
  })()

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return n.toLocaleString()
  }

  const platformColor = (platform: string) => {
    const p = platform.toLowerCase()
    if (p.includes('facebook') || p.includes('meta')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    if (p.includes('instagram')) return 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300'
    if (p.includes('linkedin')) return 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300'
    if (p.includes('twitter') || p.includes('x')) return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
    return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'
  }

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading analytics...</p>
        </div>
      </div>
    )
  }

  const hasData = overview && (overview.posts.totalImpressions > 0 || overview.timeSeries.length > 0)

  if (!hasData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Social Analytics</h1>
        </div>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
          <svg className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <p className="text-gray-500 dark:text-gray-400 max-w-md">
            No analytics data yet. Connect your social accounts and publish some posts to see insights.
          </p>
        </div>
      </div>
    )
  }

  const stats = [
    {
      label: 'Total Impressions',
      value: formatNumber(overview!.posts.totalImpressions),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      label: 'Total Reach',
      value: formatNumber(overview!.posts.totalReach),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      label: 'Total Engagements',
      value: formatNumber(overview!.posts.totalEngagements),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      ),
    },
    {
      label: 'Avg Engagement Rate',
      value: overview!.posts.avgEngagementRate,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
        </svg>
      ),
    },
  ]

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 shadow-lg text-sm">
        <p className="font-medium text-gray-900 dark:text-white mb-1">{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.name} style={{ color: entry.color }}>
            {entry.name}: {formatNumber(entry.value)}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Social Analytics</h1>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  period === p
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
            </svg>
            {refreshing ? 'Refreshing...' : 'Refresh Analytics'}
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-gray-200 dark:border-gray-800 p-6"
          >
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-2">
              {stat.icon}
              <span className="text-sm">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Time-series Chart */}
      {chartData.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Performance Over Time</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradImpressions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradReach" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradEngagements" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  className="text-gray-500 dark:text-gray-400"
                  tickFormatter={(d) =>
                    new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
                  }
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  className="text-gray-500 dark:text-gray-400"
                  tickFormatter={(v) => formatNumber(v)}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="impressions"
                  name="Impressions"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#gradImpressions)"
                />
                <Area
                  type="monotone"
                  dataKey="reach"
                  name="Reach"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fill="url(#gradReach)"
                />
                <Area
                  type="monotone"
                  dataKey="engagements"
                  name="Engagements"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  fill="url(#gradEngagements)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top Performing Posts */}
      {posts.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Top Performing Posts</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Platform</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Content</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Impressions</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Reach</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Engagements</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Eng. Rate</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr
                    key={post.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="py-3 px-2">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${platformColor(post.platform)}`}>
                        {post.platform}
                      </span>
                    </td>
                    <td className="py-3 px-2 max-w-xs truncate text-gray-700 dark:text-gray-300">
                      {post.content?.slice(0, 80)}{post.content?.length > 80 ? '...' : ''}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-900 dark:text-white font-medium">
                      {formatNumber(post.impressions)}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-900 dark:text-white font-medium">
                      {formatNumber(post.reach)}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-900 dark:text-white font-medium">
                      {formatNumber(post.engagements)}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-900 dark:text-white font-medium">
                      {post.engagementRate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
