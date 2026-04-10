'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface UsageLineItem {
  type: string
  label: string
  used: number
  limit: number
  overage: number
  overageRate: number
  overageCost: number
  percentUsed: number
}

interface UsageSummary {
  clientId: string
  plan: string
  periodStart: string
  periodEnd: string
  items: UsageLineItem[]
  totalOverageCost: number
}

const PLAN_LABELS: Record<string, string> = {
  AI_RECEPTIONIST: 'AI Receptionist',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  AGENCY: 'Agency'
}

const PLAN_COLORS: Record<string, string> = {
  AI_RECEPTIONIST: '#10b981',
  STARTER: '#3b82f6',
  GROWTH: '#6366f1',
  AGENCY: '#a855f7'
}

const ICONS: Record<string, string> = {
  VOICE_MINUTES: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z',
  AI_ACTIONS: 'M12 2a2 2 0 012 2v2a2 2 0 01-4 0V4a2 2 0 012-2zm0 14a2 2 0 012 2v2a2 2 0 01-4 0v-2a2 2 0 012-2zm10-4a2 2 0 00-2-2h-2a2 2 0 000 4h2a2 2 0 002-2zM6 12a2 2 0 00-2-2H2a2 2 0 000 4h2a2 2 0 002-2z',
  SMS: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  EMAILS: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6',
  SOCIAL_POSTS: 'M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z',
  APOLLO_PROSPECTS: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75'
}

const UNITS: Record<string, string> = {
  VOICE_MINUTES: 'min',
  AI_ACTIONS: 'actions',
  SMS: 'msgs',
  EMAILS: 'emails',
  SOCIAL_POSTS: 'posts',
  APOLLO_PROSPECTS: 'prospects'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })
}

function barColor(pct: number): string {
  if (pct >= 100) return '#ef4444'
  if (pct >= 80) return '#f59e0b'
  return '#22c55e'
}

export default function UsagePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  useEffect(() => {
    if (!session) return
    const fetchUsage = async () => {
      try {
        const token = localStorage.getItem('token') || ''
        const res = await axios.get(`${API_URL}/usage/summary`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        setSummary(res.data)
      } catch (err) {
        console.error('Failed to fetch usage:', err)
        setError('Failed to load usage data')
      } finally {
        setLoading(false)
      }
    }
    fetchUsage()
    const interval = setInterval(fetchUsage, 60000)
    return () => clearInterval(interval)
  }, [session])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-600 dark:text-red-400">
          {error || 'No usage data available'}
        </div>
      </div>
    )
  }

  const activeItems = summary.items.filter(i => i.limit > 0 || i.used > 0)
  const overageItems = summary.items.filter(i => i.overage > 0)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Usage & Billing</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {formatDate(summary.periodStart)} — {formatDate(summary.periodEnd)}
          </p>
        </div>
        <span
          className="px-3 py-1 rounded-full text-sm font-semibold text-white"
          style={{ background: PLAN_COLORS[summary.plan] || '#6366f1' }}
        >
          {PLAN_LABELS[summary.plan] || summary.plan}
        </span>
      </div>

      {/* Estimated overage bill */}
      {summary.totalOverageCost > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">Estimated Overage</h2>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                {overageItems.length} resource{overageItems.length !== 1 ? 's' : ''} over plan limits this period
              </p>
            </div>
            <span className="text-3xl font-bold text-red-700 dark:text-red-400">
              ${summary.totalOverageCost.toFixed(2)}
            </span>
          </div>
          {overageItems.length > 0 && (
            <div className="mt-3 space-y-1">
              {overageItems.map(item => (
                <div key={item.type} className="flex justify-between text-sm text-red-600 dark:text-red-400">
                  <span>{item.label}: {item.overage} over limit x ${item.overageRate}/{UNITS[item.type]?.replace(/s$/, '')}</span>
                  <span>${item.overageCost.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resource cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeItems.map(item => {
          const pct = Math.min(item.percentUsed, 150)
          const color = barColor(item.percentUsed)

          return (
            <div key={item.type} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
              {/* Icon + label */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
                  <svg className="w-5 h-5" fill="none" stroke={color} viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d={ICONS[item.type] || ICONS.AI_ACTIONS} />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{item.label}</h3>
                  <p className="text-xs text-gray-400">{UNITS[item.type]}</p>
                </div>
              </div>

              {/* Usage numbers */}
              <div className="flex items-end justify-between mb-2">
                <span className="text-2xl font-bold text-gray-900 dark:text-white">
                  {item.used.toLocaleString()}
                </span>
                <span className="text-sm text-gray-400">
                  / {item.limit.toLocaleString()}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(pct, 100)}%`, background: color }}
                />
              </div>

              {/* Percentage + overage */}
              <div className="flex justify-between mt-2">
                <span className="text-xs font-medium" style={{ color }}>
                  {item.percentUsed}% used
                </span>
                {item.overage > 0 && (
                  <span className="text-xs font-medium text-red-500">
                    +{item.overage} overage (${item.overageCost.toFixed(2)})
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Overage rates table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Overage Rates</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          If you exceed your plan limits, additional usage is billed at the rates below. Charges appear on your next invoice.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <th className="pb-2 font-medium">Resource</th>
                <th className="pb-2 font-medium text-right">Plan Included</th>
                <th className="pb-2 font-medium text-right">Overage Rate</th>
                <th className="pb-2 font-medium text-right">Used</th>
                <th className="pb-2 font-medium text-right">Overage Cost</th>
              </tr>
            </thead>
            <tbody>
              {summary.items.map(item => (
                <tr key={item.type} className="border-b border-gray-50 dark:border-gray-800/50">
                  <td className="py-2.5 text-gray-900 dark:text-white font-medium">{item.label}</td>
                  <td className="py-2.5 text-right text-gray-600 dark:text-gray-300">{item.limit.toLocaleString()}</td>
                  <td className="py-2.5 text-right text-gray-600 dark:text-gray-300">${item.overageRate.toFixed(2)}/{UNITS[item.type]?.replace(/s$/, '')}</td>
                  <td className="py-2.5 text-right text-gray-900 dark:text-white">{item.used.toLocaleString()}</td>
                  <td className={`py-2.5 text-right font-medium ${item.overageCost > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {item.overageCost > 0 ? `$${item.overageCost.toFixed(2)}` : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
            {summary.totalOverageCost > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4} className="pt-3 text-right font-semibold text-gray-900 dark:text-white">Estimated Total Overage</td>
                  <td className="pt-3 text-right font-bold text-red-500 text-lg">${summary.totalOverageCost.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Upgrade CTA */}
      {summary.items.some(i => i.percentUsed >= 80) && summary.plan !== 'AGENCY' && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-indigo-700 dark:text-indigo-400">Approaching your limits?</h3>
            <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-1">
              Upgrading your plan increases all limits and is cheaper than overage charges at scale.
            </p>
          </div>
          <button
            onClick={() => router.push('/dashboard/settings')}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition whitespace-nowrap"
          >
            View Plans
          </button>
        </div>
      )}
    </div>
  )
}
