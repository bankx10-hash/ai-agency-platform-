'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface TranscriptSegment {
  role: string
  content: string
}

interface CallDetail {
  id: string
  retellCallId: string | null
  retellAgentId: string | null
  direction: 'INBOUND' | 'OUTBOUND'
  fromNumber: string | null
  toNumber: string | null
  status: string
  durationSeconds: number
  transcript: string | null
  startedAt: string | null
  endedAt: string | null
  callerName: string | null
  callerEmail: string | null
  intent: string | null
  appointmentBooked: boolean
  summary: string | null
  contactId: string | null
  analysisData: Record<string, unknown> | null
  createdAt: string
  transcriptSegments: TranscriptSegment[]
}

function formatDuration(s: number) {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), r = s % 60
  return r > 0 ? `${m}m ${r}s` : `${m}m`
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function SpeakerBubble({ segment }: { segment: TranscriptSegment }) {
  const isAgent = segment.role === 'agent'
  return (
    <div className={`flex gap-3 ${isAgent ? '' : 'flex-row-reverse'}`}>
      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
        isAgent
          ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
          : 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
      }`}>
        {isAgent ? 'AI' : 'C'}
      </div>
      <div className={`max-w-xl px-4 py-2.5 rounded-2xl text-sm text-gray-800 dark:text-gray-200 leading-relaxed ${
        isAgent
          ? 'bg-gray-100 dark:bg-gray-800 rounded-tl-sm'
          : 'bg-indigo-50 dark:bg-indigo-900/20 rounded-tr-sm'
      }`}>
        {segment.content}
      </div>
    </div>
  )
}

export default function CallDetailPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  const [call, setCall]     = useState<CallDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  useEffect(() => {
    if (!session || !id) return
    const token = localStorage.getItem('token') || ''
    axios.get(`${API_URL}/calls/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setCall(res.data))
      .catch(() => setError('Call not found'))
      .finally(() => setLoading(false))
  }, [session, id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !call) {
    return (
      <div className="text-center py-24">
        <p className="text-gray-500 dark:text-gray-400 mb-4">{error || 'Call not found'}</p>
        <Link href="/dashboard/voice/calls" className="text-purple-600 hover:underline text-sm">
          ← Back to calls
        </Link>
      </div>
    )
  }

  const analysis = call.analysisData || {}
  const sentiment = (analysis.user_sentiment as string) || null
  const callSuccessful = analysis.call_successful as boolean | null

  const sentimentColor = sentiment === 'positive' ? 'text-green-600 dark:text-green-400'
    : sentiment === 'negative' ? 'text-red-500 dark:text-red-400'
    : 'text-gray-500 dark:text-gray-400'

  // Fill in callerName/intent from analysisData if not on the call row directly
  const callerName = call.callerName || (analysis.caller_name as string) || null
  const intent     = call.intent     || (analysis.intent      as string) || null

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back */}
      <Link
        href="/dashboard/voice/calls"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        All Calls
      </Link>

      {/* Hero */}
      <div className={`rounded-2xl p-6 border ${
        call.direction === 'INBOUND'
          ? 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-800'
          : 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-semibold ${
                call.direction === 'INBOUND'
                  ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                  : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
              }`}>
                {call.direction === 'INBOUND' ? '↙ Inbound Call' : '↗ Outbound Call'}
              </span>
              {call.appointmentBooked && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                  ✓ Appointment Booked
                </span>
              )}
              {callSuccessful === false && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-semibold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                  Unsuccessful
                </span>
              )}
            </div>
            <p className="text-xl font-bold text-gray-900 dark:text-white">
              {call.createdAt ? formatDateTime(call.createdAt) : '—'}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono">
              {call.fromNumber || '?'} → {call.toNumber || '?'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatDuration(call.durationSeconds)}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Duration</p>
            {sentiment && (
              <p className={`text-xs font-medium mt-1 capitalize ${sentimentColor}`}>{sentiment} sentiment</p>
            )}
          </div>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Caller */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Caller</h3>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-400">Name</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{callerName || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Phone</p>
              <p className="text-sm font-mono text-gray-700 dark:text-gray-300">{call.fromNumber || '—'}</p>
            </div>
            {call.callerEmail && (
              <div>
                <p className="text-xs text-gray-400">Email</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{call.callerEmail}</p>
              </div>
            )}
            {call.contactId && (
              <Link
                href={`/dashboard/crm/contacts/${call.contactId}`}
                className="inline-block mt-2 text-xs text-purple-600 dark:text-purple-400 hover:underline"
              >
                View CRM Contact →
              </Link>
            )}
          </div>
        </div>

        {/* Call Outcome */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Outcome</h3>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-400">Intent</p>
              <p className="text-sm text-gray-900 dark:text-white">{intent || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Appointment</p>
              <p className={`text-sm font-medium ${call.appointmentBooked ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {call.appointmentBooked ? '✓ Booked' : 'Not booked'}
              </p>
            </div>
            {analysis.action_items != null && (
              <div>
                <p className="text-xs text-gray-400">Action Items</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{String(analysis.action_items)}</p>
              </div>
            )}
          </div>
        </div>

        {/* AI Summary */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">AI Summary</h3>
          {call.summary ? (
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{call.summary}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">No summary available</p>
          )}
        </div>
      </div>

      {/* Transcript */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Full Transcript</h2>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/40 inline-flex items-center justify-center text-purple-700 dark:text-purple-300 font-bold text-xs">AI</span>
              Agent
            </span>
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 inline-flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-xs">C</span>
              Caller
            </span>
          </div>
        </div>

        <div className="p-6">
          {call.transcriptSegments.length === 0 ? (
            call.transcript ? (
              <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">
                {call.transcript}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 italic text-center py-8">No transcript available for this call</p>
            )
          ) : (
            <div className="space-y-4">
              {call.transcriptSegments.map((seg, i) => (
                <SpeakerBubble key={i} segment={seg} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Raw Analysis (collapsed) */}
      {call.analysisData && Object.keys(call.analysisData).length > 0 && (
        <details className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <summary className="px-6 py-4 text-sm font-medium text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none">
            Raw AI Analysis Data
          </summary>
          <pre className="px-6 pb-6 text-xs text-gray-600 dark:text-gray-400 overflow-auto leading-relaxed">
            {JSON.stringify(call.analysisData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
