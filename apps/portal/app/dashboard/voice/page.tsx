'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Stats {
  total: number
  thisWeek: number
  today: number
  avgDurationSeconds: number
  totalDurationSeconds: number
  appointmentsBooked: number
  byDay: Array<{ day: string; count: number; inbound: number; outbound: number }>
  byDirection: Record<string, number>
}

interface CallRow {
  id: string
  retellCallId: string | null
  direction: 'INBOUND' | 'OUTBOUND'
  fromNumber: string | null
  toNumber: string | null
  status: string
  durationSeconds: number
  startedAt: string | null
  callerName: string | null
  intent: string | null
  appointmentBooked: boolean
  summary: string | null
  createdAt: string
}

function formatDuration(s: number) {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m}m ${r}s` : `${m}m`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}

function shortDay(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-AU', { weekday: 'short' }).slice(0, 3)
}

export default function VoiceDashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentCalls, setRecentCalls] = useState<CallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchData = useCallback(async () => {
    if (!session) return
    const token = localStorage.getItem('token') || ''
    const headers = { Authorization: `Bearer ${token}` }
    try {
      const [statsRes, callsRes] = await Promise.all([
        axios.get(`${API_URL}/calls/stats`, { headers }),
        axios.get(`${API_URL}/calls?limit=10`, { headers })
      ])
      setStats(statsRes.data)
      setRecentCalls(callsRes.data.calls || [])
    } catch (err) {
      console.error('Failed to load voice data:', err)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetchData() }, [fetchData])

  async function sync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.post(`${API_URL}/calls/sync`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setSyncMsg(`Synced ${res.data.synced} calls from ${res.data.agents} agent(s)`)
      await fetchData()
    } catch {
      setSyncMsg('Sync failed — check that voice agents are deployed')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const s = stats || { total: 0, thisWeek: 0, today: 0, avgDurationSeconds: 0, totalDurationSeconds: 0, appointmentsBooked: 0, byDay: [], byDirection: {} }
  const inboundCount  = s.byDirection['INBOUND']  || 0
  const outboundCount = s.byDirection['OUTBOUND'] || 0
  const successRate   = s.total > 0 ? Math.round((s.appointmentsBooked / s.total) * 100) : 0

  // Chart: fill missing days so we always show 7 bars
  const today = new Date()
  const chartDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (6 - i))
    const key = d.toISOString().slice(0, 10)
    const found = s.byDay.find(r => r.day === key)
    return { day: key, count: found?.count || 0, inbound: found?.inbound || 0, outbound: found?.outbound || 0 }
  })
  const chartMax = Math.max(...chartDays.map(d => d.count), 1)

  const METRICS = [
    { label: 'Total Calls',         value: s.total.toLocaleString(),              sub: `${s.today} today` },
    { label: 'This Week',           value: s.thisWeek.toLocaleString(),            sub: `${inboundCount} in · ${outboundCount} out` },
    { label: 'Avg Duration',        value: formatDuration(s.avgDurationSeconds),   sub: `Total: ${formatDuration(s.totalDurationSeconds)}` },
    { label: 'Appointments Booked', value: s.appointmentsBooked.toLocaleString(),  sub: `${successRate}% conversion` },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Voice Intelligence</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Real-time analytics across all AI voice agents</p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && <p className="text-xs text-gray-500 dark:text-gray-400">{syncMsg}</p>}
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? 'Syncing…' : 'Sync Calls'}
          </button>
          <Link
            href="/dashboard/voice/calls"
            className="px-4 py-2 border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            All Calls →
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {METRICS.map(m => (
          <div key={m.label} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{m.label}</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{m.value}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{m.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Call Volume Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Call Volume — Last 7 Days</h2>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" /> Inbound</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-400 inline-block" /> Outbound</span>
            </div>
          </div>
          {s.total === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-gray-400">No calls yet — click Sync Calls to import history</div>
          ) : (
            <div className="flex items-end gap-2 h-36">
              {chartDays.map(day => (
                <div key={day.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col gap-px">
                    <div
                      className="w-full bg-indigo-500 rounded-t-sm transition-all"
                      style={{ height: `${Math.max((day.inbound  / chartMax) * 108, day.inbound  > 0 ? 4 : 0)}px` }}
                    />
                    <div
                      className="w-full bg-purple-400 rounded-b-sm transition-all"
                      style={{ height: `${Math.max((day.outbound / chartMax) * 108, day.outbound > 0 ? 4 : 0)}px` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">{shortDay(day.day)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Direction breakdown */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex flex-col gap-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Direction Split</h2>
          {s.total === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">No data yet</div>
          ) : (
            <>
              {[
                { label: 'Inbound', count: inboundCount,  color: 'bg-indigo-500' },
                { label: 'Outbound', count: outboundCount, color: 'bg-purple-400' },
              ].map(({ label, count, color }) => (
                <div key={label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600 dark:text-gray-300">{label}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{count}</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${s.total > 0 ? (count / s.total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
              <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Appt conversion</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">{successRate}%</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Recent Calls */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent Calls</h2>
          <Link href="/dashboard/voice/calls" className="text-sm text-purple-600 dark:text-purple-400 hover:underline">
            View all →
          </Link>
        </div>

        {recentCalls.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm">No calls yet. Click <strong>Sync Calls</strong> to import from Retell.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-gray-100 dark:border-gray-800">
                  {['Time', 'Direction', 'Caller', 'Number', 'Duration', 'Outcome'].map(h => (
                    <th key={h} className="px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {recentCalls.map(call => (
                  <tr
                    key={call.id}
                    onClick={() => router.push(`/dashboard/voice/calls/${call.id}`)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {call.createdAt ? formatTime(call.createdAt) : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        call.direction === 'INBOUND'
                          ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                          : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      }`}>
                        {call.direction === 'INBOUND' ? '↙' : '↗'} {call.direction === 'INBOUND' ? 'In' : 'Out'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                      {call.callerName || <span className="text-gray-400">Unknown</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">
                      {call.direction === 'INBOUND' ? call.fromNumber : call.toNumber}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {formatDuration(call.durationSeconds)}
                    </td>
                    <td className="px-6 py-4">
                      {call.appointmentBooked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                          Appt Booked
                        </span>
                      ) : call.intent ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-32 block">{call.intent}</span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
