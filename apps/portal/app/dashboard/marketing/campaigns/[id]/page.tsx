'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  SCHEDULED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  SENDING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  SENT: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const RECIPIENT_STATUS_COLORS: Record<string, string> = {
  PENDING: 'text-gray-400',
  SENT: 'text-blue-600 dark:text-blue-400',
  OPENED: 'text-green-600 dark:text-green-400',
  CLICKED: 'text-indigo-600 dark:text-indigo-400',
  FAILED: 'text-red-600 dark:text-red-400',
}

interface Campaign {
  id: string
  name: string
  type: 'EMAIL' | 'SMS'
  subject?: string
  body: string
  status: string
  sentAt?: string
  createdAt: string
  stats?: { sent?: number; failed?: number; total?: number }
  _count?: { recipients: number }
  recipients: {
    id: string
    status: string
    sentAt?: string
    openedAt?: string
    error?: string
    contact: { id: string; name?: string; email?: string; phone?: string }
  }[]
}

export default function CampaignDetailPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'overview' | 'recipients'>('overview')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchCampaign = useCallback(async () => {
    if (!session) return
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/marketing/campaigns/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setCampaign(res.data.campaign)
    } catch {
      console.error('Failed to fetch campaign')
    } finally {
      setLoading(false)
    }
  }, [session, id])

  useEffect(() => { fetchCampaign() }, [fetchCampaign])

  // Poll while sending
  useEffect(() => {
    if (campaign?.status !== 'SENDING') return
    const interval = setInterval(fetchCampaign, 3000)
    return () => clearInterval(interval)
  }, [campaign?.status, fetchCampaign])

  async function handleSend() {
    if (!campaign) return
    setSending(true)
    try {
      const token = localStorage.getItem('token') || ''
      await axios.post(`${API_URL}/marketing/campaigns/${id}/send`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      fetchCampaign()
    } catch (err) {
      console.error('Failed to send', err)
    } finally {
      setSending(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this campaign?')) return
    const token = localStorage.getItem('token') || ''
    await axios.delete(`${API_URL}/marketing/campaigns/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    router.push('/dashboard/marketing/campaigns')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!campaign) return <div className="text-gray-500 text-sm">Campaign not found.</div>

  const stats = campaign.stats || {}
  const total = stats.total ?? campaign._count?.recipients ?? 0
  const sent = stats.sent ?? 0
  const failed = stats.failed ?? 0
  const openRate = sent > 0 && campaign.recipients.filter(r => r.openedAt).length > 0
    ? Math.round((campaign.recipients.filter(r => r.openedAt).length / sent) * 100) : 0

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <button onClick={() => router.push('/dashboard/marketing/campaigns')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mt-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{campaign.name}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[campaign.status]}`}>
                {campaign.status === 'SENDING' && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5 animate-pulse" />}
                {campaign.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {campaign.type} · {campaign.sentAt
                ? `Sent ${new Date(campaign.sentAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : `Created ${new Date(campaign.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === 'DRAFT' && (
            <button
              onClick={handleSend}
              disabled={sending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              {sending ? 'Sending...' : `Send Now`}
            </button>
          )}
          {campaign.status === 'DRAFT' && (
            <button onClick={handleDelete} className="px-4 py-2 text-sm border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {campaign.status !== 'DRAFT' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Recipients', value: total },
            { label: 'Sent', value: sent, color: 'text-blue-600 dark:text-blue-400' },
            { label: 'Failed', value: failed, color: failed > 0 ? 'text-red-600 dark:text-red-400' : '' },
            { label: 'Open Rate', value: campaign.type === 'EMAIL' ? `${openRate}%` : 'N/A' },
          ].map(stat => (
            <div key={stat.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{stat.label}</p>
              <p className={`text-2xl font-bold mt-1 ${stat.color || 'text-gray-900 dark:text-white'}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {(['overview', 'recipients'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
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
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          {campaign.type === 'EMAIL' && campaign.subject && (
            <div className="mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{campaign.subject}</p>
            </div>
          )}
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            {campaign.type === 'EMAIL' ? 'Email Body' : 'SMS Message'}
          </p>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
            {campaign.body}
          </div>
        </div>
      )}

      {tab === 'recipients' && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {campaign.recipients.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
              {campaign.status === 'DRAFT' ? 'Send the campaign to see recipients.' : 'No recipients yet.'}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden sm:table-cell">Sent At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {campaign.recipients.map(r => (
                  <tr key={r.id} onClick={() => router.push(`/dashboard/crm/contacts/${r.contact.id}`)} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer">
                    <td className="px-6 py-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{r.contact.name || '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{r.contact.email || r.contact.phone || '—'}</p>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`text-xs font-medium ${RECIPIENT_STATUS_COLORS[r.status] || 'text-gray-400'}`}>
                        {r.status}
                        {r.error && <span className="ml-1 text-gray-400">({r.error.slice(0, 40)})</span>}
                      </span>
                    </td>
                    <td className="px-6 py-3 hidden sm:table-cell">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {r.sentAt ? new Date(r.sentAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
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
