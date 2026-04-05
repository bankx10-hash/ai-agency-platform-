'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
  const [error, setError] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const getToken = useCallback(() => {
    return localStorage.getItem('token') || (session as any)?.accessToken || ''
  }, [session])

  const fetchData = useCallback(async () => {
    if (!session) return
    const token = getToken()
    if (!token) { setError('No auth token available'); setLoading(false); return }
    const headers = { Authorization: `Bearer ${token}` }
    const errors: string[] = []

    // Fetch stats and calls independently so one failure doesn't block the other
    const [statsRes, callsRes] = await Promise.all([
      axios.get(`${API_URL}/calls/stats`, { headers }).catch((err: any) => {
        console.error('Failed to load stats:', err?.response?.status, err?.response?.data)
        errors.push(`Stats: ${err?.response?.status || 'network error'} — ${err?.response?.data?.error || err.message}`)
        return null
      }),
      axios.get(`${API_URL}/calls?limit=10`, { headers }).catch((err: any) => {
        console.error('Failed to load calls:', err?.response?.status, err?.response?.data)
        errors.push(`Calls: ${err?.response?.status || 'network error'} — ${err?.response?.data?.error || err.message}`)
        return null
      })
    ])

    if (statsRes) setStats(statsRes.data)
    if (callsRes) setRecentCalls(callsRes.data.calls || [])
    setError(errors.length > 0 ? errors.join(' | ') : '')
    setLoading(false)
  }, [session, getToken])

  useEffect(() => { fetchData() }, [fetchData])

  async function sync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const token = getToken()
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

  // --- Derived data ---

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

  // Inbound/Outbound detail derivations
  const inboundCalls = recentCalls.filter(c => c.direction === 'INBOUND')
  const outboundCalls = recentCalls.filter(c => c.direction === 'OUTBOUND')

  const inboundAvgDur = inboundCalls.length > 0
    ? Math.round(inboundCalls.reduce((a, c) => a + c.durationSeconds, 0) / inboundCalls.length)
    : 0
  const outboundAvgDur = outboundCalls.length > 0
    ? Math.round(outboundCalls.reduce((a, c) => a + c.durationSeconds, 0) / outboundCalls.length)
    : 0

  // Top intents from inbound calls
  const topIntents = useMemo(() => {
    const map: Record<string, number> = {}
    inboundCalls.forEach(c => { if (c.intent) map[c.intent] = (map[c.intent] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [inboundCalls])

  // Top outcomes from outbound calls
  const topOutcomes = useMemo(() => {
    const map: Record<string, number> = {}
    outboundCalls.forEach(c => {
      const label = c.appointmentBooked ? 'Appt Booked' : c.intent || 'No outcome'
      map[label] = (map[label] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [outboundCalls])

  // Donut percentages
  const inPct = s.total > 0 ? Math.round((inboundCount / s.total) * 100) : 0
  const outPct = s.total > 0 ? 100 - inPct : 0

  // Hourly distribution from recentCalls
  const hourlyData = useMemo(() => {
    const hours = Array(24).fill(0)
    recentCalls.forEach(c => {
      const dt = c.startedAt || c.createdAt
      if (dt) {
        const h = new Date(dt).getHours()
        hours[h]++
      }
    })
    return hours
  }, [recentCalls])
  const hourlyMax = Math.max(...hourlyData, 1)

  // Y-axis gridline values for chart
  const gridLines = useMemo(() => {
    if (chartMax <= 1) return [1]
    const step = Math.ceil(chartMax / 4)
    const lines = []
    for (let v = step; v <= chartMax; v += step) lines.push(v)
    if (!lines.includes(chartMax)) lines.push(chartMax)
    return lines
  }, [chartMax])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
            Voice Intelligence
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Real-time analytics and insights across all AI voice agents
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {syncMsg && (
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={syncMsg}>
              {syncMsg}
            </p>
          )}
          <button
            onClick={sync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
          >
            <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? 'Syncing...' : 'Sync Calls'}
          </button>
          <Link
            href="/dashboard/voice/calls"
            className="inline-flex items-center gap-1 px-4 py-2 border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            All Calls
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── 6 Metric Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Total Calls */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{s.total.toLocaleString()}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Total Calls</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{s.today} today</p>
        </div>

        {/* Inbound */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{inboundCount.toLocaleString()}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Inbound</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{s.total > 0 ? inPct : 0}% of total</p>
        </div>

        {/* Outbound */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{outboundCount.toLocaleString()}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Outbound</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{s.total > 0 ? outPct : 0}% of total</p>
        </div>

        {/* Avg Duration */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{formatDuration(s.avgDurationSeconds)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Avg Duration</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Total: {formatDuration(s.totalDurationSeconds)}</p>
        </div>

        {/* Appointments Booked */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{s.appointmentsBooked.toLocaleString()}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Appts Booked</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">from {s.total} calls</p>
        </div>

        {/* Conversion Rate */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{successRate}%</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Conversion Rate</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">calls to appointments</p>
        </div>
      </div>

      {/* ── Call Volume Chart + Donut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stacked Bar Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
              Call Volume &mdash; Last 7 Days
            </h2>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" />
                Inbound
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-purple-400 inline-block" />
                Outbound
              </span>
            </div>
          </div>

          {s.total === 0 ? (
            <div className="flex items-center justify-center h-44 text-sm text-gray-400 dark:text-gray-500">
              No calls yet &mdash; click Sync Calls to import history
            </div>
          ) : (
            <div className="relative h-48">
              {/* Gridlines */}
              {gridLines.map(v => {
                const pct = (v / chartMax) * 100
                return (
                  <div key={v} className="absolute left-8 right-0" style={{ bottom: `${pct}%` }}>
                    <div className="border-t border-gray-100 dark:border-gray-800 w-full" />
                    <span className="absolute -left-8 -top-2 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums w-6 text-right">
                      {v}
                    </span>
                  </div>
                )
              })}
              {/* Zero line */}
              <div className="absolute left-8 right-0 bottom-0">
                <div className="border-t border-gray-200 dark:border-gray-700 w-full" />
                <span className="absolute -left-8 -top-2 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums w-6 text-right">0</span>
              </div>

              {/* Bars */}
              <div className="absolute left-10 right-0 top-0 bottom-0 flex items-end gap-3">
                {chartDays.map(day => {
                  const inH = (day.inbound / chartMax) * 100
                  const outH = (day.outbound / chartMax) * 100
                  return (
                    <div key={day.day} className="flex-1 flex flex-col items-center">
                      <div className="w-full flex flex-col justify-end flex-1" style={{ minHeight: 0 }}>
                        <div className="w-full flex flex-col">
                          {day.inbound > 0 && (
                            <div
                              className="w-full bg-indigo-500 rounded-t transition-all"
                              style={{ height: `${Math.max(inH * 1.7, 3)}px` }}
                              title={`${day.inbound} inbound`}
                            />
                          )}
                          {day.outbound > 0 && (
                            <div
                              className={`w-full bg-purple-400 transition-all ${day.inbound === 0 ? 'rounded-t' : ''} rounded-b`}
                              style={{ height: `${Math.max(outH * 1.7, 3)}px` }}
                              title={`${day.outbound} outbound`}
                            />
                          )}
                          {day.count === 0 && (
                            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded" style={{ height: '3px' }} />
                          )}
                        </div>
                      </div>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 tabular-nums">
                        {shortDay(day.day)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Donut / Ring Chart */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 flex flex-col items-center justify-center">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-5 self-start">
            Direction Split
          </h2>

          {s.total === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
              No data yet
            </div>
          ) : (
            <>
              {/* CSS Conic-gradient donut */}
              <div className="relative w-36 h-36 mb-5">
                <div
                  className="w-full h-full rounded-full"
                  style={{
                    background: `conic-gradient(
                      #6366f1 0% ${inPct}%,
                      #a78bfa ${inPct}% 100%
                    )`
                  }}
                />
                <div className="absolute inset-4 bg-white dark:bg-gray-900 rounded-full flex flex-col items-center justify-center">
                  <span className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{s.total}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">calls</span>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-indigo-500" />
                  <span className="text-gray-600 dark:text-gray-300">In <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{inPct}%</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-purple-400" />
                  <span className="text-gray-600 dark:text-gray-300">Out <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{outPct}%</span></span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Inbound vs Outbound Detail Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inbound Card */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="h-1 bg-blue-500" />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">Inbound Calls</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Count</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{inboundCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Avg Duration</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{formatDuration(inboundAvgDur)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Top Intents</p>
              {topIntents.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">No intent data recorded</p>
              ) : (
                <div className="space-y-1.5">
                  {topIntents.map(([intent, count]) => (
                    <div key={intent} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate mr-2">{intent}</span>
                      <span className="text-xs font-medium text-blue-600 dark:text-blue-400 tabular-nums bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Outbound Card */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="h-1 bg-purple-500" />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">Outbound Calls</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Count</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{outboundCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Avg Duration</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{formatDuration(outboundAvgDur)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Top Outcomes</p>
              {topOutcomes.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">No outcome data recorded</p>
              ) : (
                <div className="space-y-1.5">
                  {topOutcomes.map(([outcome, count]) => (
                    <div key={outcome} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate mr-2">{outcome}</span>
                      <span className="text-xs font-medium text-purple-600 dark:text-purple-400 tabular-nums bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-full">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Hourly Distribution ── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
          Hourly Distribution
        </h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
          Call volume by hour of day (based on recent calls)
        </p>
        <div className="flex items-end gap-[3px] h-20">
          {hourlyData.map((count, hour) => {
            const pct = (count / hourlyMax) * 100
            const intensity = count === 0
              ? 'bg-gray-100 dark:bg-gray-800'
              : pct > 75
                ? 'bg-indigo-600 dark:bg-indigo-500'
                : pct > 50
                  ? 'bg-indigo-500 dark:bg-indigo-400'
                  : pct > 25
                    ? 'bg-indigo-400 dark:bg-indigo-500/60'
                    : 'bg-indigo-300 dark:bg-indigo-500/40'
            return (
              <div key={hour} className="flex-1 flex flex-col items-center gap-1" title={`${hour}:00 — ${count} call${count !== 1 ? 's' : ''}`}>
                <div
                  className={`w-full rounded-sm transition-all ${intensity}`}
                  style={{ height: count > 0 ? `${Math.max(pct * 0.72, 4)}px` : '3px' }}
                />
                {hour % 3 === 0 && (
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 tabular-nums">{hour.toString().padStart(2, '0')}</span>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-gray-400 dark:text-gray-500">
          <span>12am</span>
          <span>12pm</span>
          <span>11pm</span>
        </div>
      </div>

      {/* ── Recent Calls Table ── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Recent Calls
          </h2>
          <Link
            href="/dashboard/voice/calls"
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium transition-colors"
          >
            View all
          </Link>
        </div>

        {recentCalls.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No calls yet. Click <strong>Sync Calls</strong> to import from Retell.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-gray-100 dark:border-gray-800">
                  {['Time', 'Direction', 'Caller', 'Number', 'Duration', 'Outcome'].map(h => (
                    <th key={h} className="px-6 py-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                {recentCalls.map(call => (
                  <tr
                    key={call.id}
                    onClick={() => router.push(`/dashboard/voice/calls/${call.id}`)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer transition-colors group"
                  >
                    <td className="px-6 py-3.5 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap tabular-nums">
                      {call.createdAt ? formatTime(call.createdAt) : '\u2014'}
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        call.direction === 'INBOUND'
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      }`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {call.direction === 'INBOUND'
                            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          }
                        </svg>
                        {call.direction === 'INBOUND' ? 'In' : 'Out'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-sm font-medium text-gray-900 dark:text-white">
                      {call.callerName || <span className="text-gray-400 dark:text-gray-500 font-normal">Unknown</span>}
                    </td>
                    <td className="px-6 py-3.5 text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                      {call.direction === 'INBOUND' ? call.fromNumber : call.toNumber}
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-600 dark:text-gray-300 tabular-nums">
                      {formatDuration(call.durationSeconds)}
                    </td>
                    <td className="px-6 py-3.5">
                      {call.appointmentBooked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                          </svg>
                          Booked
                        </span>
                      ) : call.intent ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px] block">{call.intent}</span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">&mdash;</span>
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
