'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const STAGES = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST']

export default function NewCampaignPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [type, setType] = useState<'EMAIL' | 'SMS'>('EMAIL')
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipientMode, setRecipientMode] = useState<'all' | 'stages'>('all')
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState('')

  const token = () => localStorage.getItem('token') || ''

  async function saveDraft() {
    if (!name || !body) { setError('Name and message body are required'); return }
    if (type === 'EMAIL' && !subject) { setError('Subject is required for email campaigns'); return }
    setError('')
    setSaving(true)
    try {
      const recipientFilter = recipientMode === 'all'
        ? { all: true }
        : { all: false, stages: selectedStages }
      const res = await axios.post(`${API_URL}/marketing/campaigns`, {
        name, type, subject: type === 'EMAIL' ? subject : undefined, body, recipientFilter
      }, { headers: { Authorization: `Bearer ${token()}` } })
      setCampaignId(res.data.campaign.id)
      return res.data.campaign.id
    } catch {
      setError('Failed to save campaign')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function previewRecipients(id: string) {
    setPreviewLoading(true)
    try {
      const res = await axios.get(`${API_URL}/marketing/campaigns/${id}/preview-recipients`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      setPreviewCount(res.data.count)
    } catch {
      setPreviewCount(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleSaveAndPreview() {
    const id = campaignId || await saveDraft()
    if (id) previewRecipients(id)
  }

  async function handleSend() {
    setError('')
    let id = campaignId
    if (!id) {
      id = await saveDraft()
      if (!id) return
    }
    setSending(true)
    try {
      await axios.post(`${API_URL}/marketing/campaigns/${id}/send`, {}, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      router.push(`/dashboard/marketing/campaigns/${id}`)
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to send'
      setError(msg || 'Failed to send campaign')
    } finally {
      setSending(false)
    }
  }

  function toggleStage(stage: string) {
    setSelectedStages(prev => prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage])
  }

  const charCount = body.length
  const smsSegments = type === 'SMS' ? Math.ceil(charCount / 160) : 0

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/dashboard/marketing/campaigns')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New Campaign</h1>
      </div>

      <div className="space-y-6">
        {/* Type selector */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Campaign Type</h2>
          <div className="flex gap-3">
            {(['EMAIL', 'SMS'] as const).map(t => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                  type === t
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                }`}
              >
                <span className="text-lg">{t === 'EMAIL' ? '✉️' : '💬'}</span>
                {t === 'EMAIL' ? 'Email Campaign' : 'SMS Campaign'}
              </button>
            ))}
          </div>
        </div>

        {/* Details */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Campaign Details</h2>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Campaign Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. March Newsletter, Flash Sale SMS"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {type === 'EMAIL' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject Line *</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Exclusive offer just for you 🎉"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {type === 'EMAIL' ? 'Email Body *' : 'SMS Message *'}
              </label>
              {type === 'SMS' && (
                <span className={`text-xs ${charCount > 160 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                  {charCount} chars · {smsSegments} segment{smsSegments !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={type === 'EMAIL' ? 10 : 4}
              placeholder={type === 'EMAIL'
                ? 'Write your email content here. You can use HTML or plain text.'
                : 'Write your SMS message (160 chars = 1 segment, billed per segment)'}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
            {type === 'EMAIL' && (
              <p className="text-xs text-gray-400 mt-1">Tip: use &lt;b&gt;bold&lt;/b&gt;, &lt;a href=""&gt;links&lt;/a&gt;, or plain text.</p>
            )}
          </div>
        </div>

        {/* Recipients */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recipients</h2>

          <div className="flex gap-3">
            {[
              { value: 'all', label: 'All Contacts' },
              { value: 'stages', label: 'By Pipeline Stage' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setRecipientMode(opt.value as 'all' | 'stages')}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  recipientMode === opt.value
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {recipientMode === 'stages' && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Select which pipeline stages to target:</p>
              <div className="flex flex-wrap gap-2">
                {STAGES.map(stage => (
                  <button
                    key={stage}
                    onClick={() => toggleStage(stage)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selectedStages.includes(stage)
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                    }`}
                  >
                    {stage.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveAndPreview}
              disabled={previewLoading || !name || !body}
              className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {previewLoading ? 'Counting...' : 'Preview Recipients'}
            </button>
            {previewCount !== null && (
              <span className="text-sm text-gray-600 dark:text-gray-300">
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">{previewCount}</span> recipients match
                {type === 'EMAIL' && ' (contacts with email addresses only)'}
                {type === 'SMS' && ' (contacts with phone numbers only)'}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={saveDraft}
            disabled={saving}
            className="px-5 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            onClick={handleSend}
            disabled={sending || saving || !name || !body || (type === 'EMAIL' && !subject)}
            className="px-5 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium"
          >
            {sending ? 'Sending...' : `Send ${type === 'EMAIL' ? 'Email' : 'SMS'} Now`}
          </button>
        </div>
      </div>
    </div>
  )
}
