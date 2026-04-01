'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface CallRow {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  fromNumber: string | null
  toNumber: string | null
  status: string
  durationSeconds: number
  startedAt: string | null
  endedAt: string | null
  callerName: string | null
  intent: string | null
  appointmentBooked: boolean
  summary: string | null
  transcript: string | null
  createdAt: string
}

function formatDuration(s: number) {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), r = s % 60
  return r > 0 ? `${m}m ${r}s` : `${m}m`
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export default function OutboundCallsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [calls, setCalls]           = useState<CallRow[]>([])
  const [total, setTotal]           = useState(0)
  const [page, setPage]             = useState(1)
  const [pages, setPages]           = useState(1)
  const [loading, setLoading]       = useState(true)
  const [syncing, setSyncing]       = useState(false)
  const [syncMsg, setSyncMsg]       = useState('')

  const [search, setSearch]         = useState('')
  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')
  const [apptOnly, setApptOnly]     = useState(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // Stats
  const [stats, setStats] = useState({ totalOutbound: 0, avgDuration: 0, appointmentsSet: 0, connectRate: 0 })

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchCalls = useCallback(async (pg = 1) => {
    if (!session) return
    setLoading(true)
    try {
      const params: Record<string, string> = {
        page: String(pg),
        limit: '20',
        direction: 'outbound'
      }
      if (fromDate) params.from = fromDate
      if (toDate)   params.to   = toDate
      if (search)   params.search = search
      if (apptOnly) params.appointmentBooked = 'true'

      const res = await axios.get(`${API_URL}/calls`, {
        params,
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
      })
      const fetchedCalls: CallRow[] = res.data.calls || []
      setCalls(fetchedCalls)
      setTotal(res.data.total || 0)
      setPages(res.data.pages || 1)
      setPage(pg)

      // Compute stats from total + current page data
      const totalOutbound = res.data.total || 0
      const totalDuration = fetchedCalls.reduce((sum, c) => sum + c.durationSeconds, 0)
      const avgDuration = fetchedCalls.length > 0 ? Math.round(totalDuration / fetchedCalls.length) : 0
      const appointmentsSet = fetchedCalls.filter(c => c.appointmentBooked).length
      const connected = fetchedCalls.filter(c => c.durationSeconds > 0).length
      const connectRate = fetchedCalls.length > 0 ? Math.round((connected / fetchedCalls.length) * 100) : 0

      setStats({ totalOutbound, avgDuration, appointmentsSet, connectRate })
    } catch (err) {
      console.error('Failed to load outbound calls:', err)
    } finally {
      setLoading(false)
    }
  }, [session, fromDate, toDate, search, apptOnly])

  useEffect(() => { fetchCalls(1) }, [fetchCalls])

  async function sync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await axios.post(`${API_URL}/calls/sync`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
      })
      setSyncMsg(`Synced ${res.data.synced} calls`)
      fetchCalls(1)
    } catch {
      setSyncMsg('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  function exportCsv() {
    const headers = ['Date/Time', 'To Number', 'Contact Name', 'Duration (s)', 'Summary', 'Outcome']
    const rows = calls.map(c => [
      c.createdAt ? new Date(c.createdAt).toISOString() : '',
      c.toNumber || '',
      c.callerName || '',
      String(c.durationSeconds),
      (c.summary || '').replace(/"/g, '""'),
      c.appointmentBooked ? 'Appointment Booked' : (c.intent || 'No outcome')
    ].map(v => `"${v}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `outbound-calls-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function downloadRecording(callId: string, e: React.MouseEvent) {
    e.stopPropagation()
    setDownloadingId(callId)
    try {
      const res = await axios.get(`${API_URL}/calls/${callId}/recording`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        responseType: 'blob'
      })
      const blob = new Blob([res.data], { type: res.headers['content-type'] || 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recording-${callId}.mp3`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to download recording:', err)
    } finally {
      setDownloadingId(null)
    }
  }

  function toggleTranscript(callId: string, e: React.MouseEvent) {
    e.stopPropagation()
    setExpandedId(prev => prev === callId ? null : callId)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Outbound Calls</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{total.toLocaleString()} total records</p>
        </div>
        <div className="flex items-center gap-2">
          {syncMsg && <p className="text-xs text-gray-500">{syncMsg}</p>}
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sync
          </button>
          <button
            onClick={exportCsv}
            disabled={calls.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <input
              type="search"
              placeholder="Search contact name or number..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchCalls(1)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <span className="self-center text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <label className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer select-none bg-white dark:bg-gray-800">
            <input
              type="checkbox"
              checked={apptOnly}
              onChange={e => setApptOnly(e.target.checked)}
              className="accent-purple-600"
            />
            <span className="text-gray-700 dark:text-gray-300">Appts only</span>
          </label>
          <button
            onClick={() => fetchCalls(1)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Outbound</p>
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{stats.totalOutbound.toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Avg Duration</p>
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{formatDuration(stats.avgDuration)}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Appointments Set</p>
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{stats.appointmentsSet}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Connect Rate</p>
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{stats.connectRate}%</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : calls.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-400">
            No outbound calls match your filters
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    {['Date / Time', 'To Number', 'Contact Name', 'Duration', 'AI Summary', 'Outcome', 'Actions'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {calls.map(call => (
                    <>
                      <tr
                        key={call.id}
                        onClick={() => router.push(`/dashboard/voice/calls/${call.id}`)}
                        className="hover:bg-purple-50 dark:hover:bg-purple-900/10 cursor-pointer transition-colors group"
                      >
                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {call.createdAt ? formatDateTime(call.createdAt) : '—'}
                        </td>
                        <td className="px-5 py-4 text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {call.toNumber || '—'}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-900 dark:text-white">
                          {call.callerName || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                          {formatDuration(call.durationSeconds)}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-48 truncate">
                          {call.summary || '—'}
                        </td>
                        <td className="px-5 py-4">
                          {call.appointmentBooked ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                              Booked
                            </span>
                          ) : call.intent ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                              {call.intent}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1">
                            {/* Download Recording */}
                            <button
                              onClick={(e) => downloadRecording(call.id, e)}
                              disabled={downloadingId === call.id}
                              title="Download recording"
                              className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50 transition-colors"
                            >
                              {downloadingId === call.id ? (
                                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              )}
                            </button>
                            {/* Expand Transcript */}
                            <button
                              onClick={(e) => toggleTranscript(call.id, e)}
                              title={expandedId === call.id ? 'Hide transcript' : 'Show transcript'}
                              className={`p-1.5 rounded-lg transition-colors ${
                                expandedId === call.id
                                  ? 'text-purple-600 bg-purple-50 dark:bg-purple-900/20'
                                  : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                              }`}
                            >
                              <svg className={`w-4 h-4 transition-transform ${expandedId === call.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {/* Expanded Transcript Row */}
                      {expandedId === call.id && (
                        <tr key={`${call.id}-transcript`} className="bg-purple-50/50 dark:bg-purple-900/5">
                          <td colSpan={7} className="px-5 py-4">
                            <div className="max-w-4xl">
                              <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-2">Transcript</p>
                              {call.transcript ? (
                                <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
                                  {call.transcript}
                                </pre>
                              ) : (
                                <p className="text-sm text-gray-400 italic">No transcript available</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 dark:border-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Page {page} of {pages} &middot; {total.toLocaleString()} calls
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchCalls(page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Prev
                  </button>
                  {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
                    const pg = i + 1
                    return (
                      <button
                        key={pg}
                        onClick={() => fetchCalls(pg)}
                        className={`w-8 h-8 text-sm rounded-lg transition-colors ${
                          pg === page
                            ? 'bg-purple-600 text-white'
                            : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        {pg}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => fetchCalls(page + 1)}
                    disabled={page >= pages}
                    className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
