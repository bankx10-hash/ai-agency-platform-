'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Thread {
  id: string
  subject: string
  from: string
  snippet: string
  date: string
  isUnread: boolean
  messageCount: number
  contact?: { id: string; name?: string; email?: string } | null
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function extractName(from: string) {
  const match = from.match(/^(.+?)\s*</)
  return match ? match[1].replace(/"/g, '').trim() : from.split('@')[0]
}

export default function InboxPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(true)
  const [connectedEmail, setConnectedEmail] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [label, setLabel] = useState('INBOX')
  const [showCompose, setShowCompose] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeSending, setComposeSending] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const token = () => localStorage.getItem('token') || ''

  const fetchThreads = useCallback(async (reset = true) => {
    if (reset) setLoading(true)
    try {
      const params = new URLSearchParams({ label })
      if (search) params.set('q', search)
      const res = await axios.get(`${API_URL}/inbox/threads?${params}`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      if (reset) setThreads(res.data.threads)
      else setThreads(prev => [...prev, ...res.data.threads])
      setNextPageToken(res.data.nextPageToken)
      setConnectedEmail(res.data.connectedEmail || '')
      setConnected(true)
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 400) setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [search, label])

  // Only fetch once session is confirmed — avoids the blank screen race condition
  useEffect(() => {
    if (status !== 'authenticated') return
    fetchThreads(true)
  }, [status, search, label, fetchThreads])

  async function handleCompose() {
    if (!composeTo || !composeSubject || !composeBody) return
    setComposeSending(true)
    try {
      await axios.post(`${API_URL}/inbox/compose`, {
        to: composeTo, subject: composeSubject, body: composeBody
      }, { headers: { Authorization: `Bearer ${token()}` } })
      setShowCompose(false)
      setComposeTo(''); setComposeSubject(''); setComposeBody('')
      fetchThreads(true)
    } catch { /* show error */ }
    finally { setComposeSending(false) }
  }

  if (!connected) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-16 text-center">
        <div className="text-5xl mb-4">✉️</div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Gmail not connected</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Connect your Gmail account to read and reply to emails from within the platform.</p>
        <button onClick={() => router.push('/dashboard/connections')} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg">
          Connect Gmail
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Inbox</h1>
          {connectedEmail && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{connectedEmail}</p>}
        </div>
        <button
          onClick={() => setShowCompose(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Compose
        </button>
      </div>

      {/* Filters + search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search emails..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput) } }}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex gap-2">
          {[
            { value: 'INBOX', label: 'Inbox' },
            { value: 'SENT', label: 'Sent' },
            { value: 'STARRED', label: 'Starred' },
          ].map(l => (
            <button key={l.value} onClick={() => setLabel(l.value)}
              className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                label === l.value
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Thread list */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : threads.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 text-sm">No emails found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {threads.map(thread => (
              <div
                key={thread.id}
                onClick={() => router.push(`/dashboard/inbox/${thread.id}`)}
                className={`flex items-start gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${thread.isUnread ? 'bg-indigo-50/30 dark:bg-indigo-900/5' : ''}`}
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-sm font-bold text-indigo-700 dark:text-indigo-400 flex-shrink-0">
                  {extractName(thread.from || '?').charAt(0).toUpperCase()}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-sm truncate ${thread.isUnread ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-700 dark:text-gray-200'}`}>
                        {thread.contact?.name || extractName(thread.from)}
                      </span>
                      {thread.contact && (
                        <span className="text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded flex-shrink-0">CRM</span>
                      )}
                      {thread.messageCount > 1 && (
                        <span className="text-xs text-gray-400 flex-shrink-0">{thread.messageCount}</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{thread.date ? formatDate(thread.date) : ''}</span>
                  </div>
                  <p className={`text-sm truncate ${thread.isUnread ? 'font-medium text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}>
                    {thread.subject || '(no subject)'}
                  </p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{thread.snippet}</p>
                </div>

                {thread.isUnread && (
                  <div className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0 mt-2" />
                )}
              </div>
            ))}

            {nextPageToken && (
              <div className="px-5 py-4 text-center">
                <button onClick={() => fetchThreads(false)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">New Email</h2>
              <button onClick={() => setShowCompose(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">To</label>
                <input type="email" value={composeTo} onChange={e => setComposeTo(e.target.value)} placeholder="recipient@example.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Subject</label>
                <input type="text" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Subject"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Message</label>
                <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} rows={8} placeholder="Write your message..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowCompose(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                  Cancel
                </button>
                <button onClick={handleCompose} disabled={composeSending || !composeTo || !composeSubject || !composeBody}
                  className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium">
                  {composeSending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
