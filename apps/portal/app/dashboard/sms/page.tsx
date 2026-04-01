'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Conversation {
  phone: string
  lastMessage: string
  lastAt: string
  contactId: string | null
  contactName: string | null
}

interface SmsMessage {
  id: string
  from: string
  to: string
  body: string
  direction: 'INBOUND' | 'OUTBOUND'
  createdAt: string
  contactId: string | null
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function SmsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [myNumber, setMyNumber] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activePhone, setActivePhone] = useState<string | null>(null)
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [threadContact, setThreadContact] = useState<{ id: string; name: string | null; email: string | null } | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [showNew, setShowNew] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (status === 'unauthenticated') router.push('/login') }, [status, router])

  const fetchConversations = useCallback(async () => {
    if (!session) return
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/sms/conversations`, { headers: { Authorization: `Bearer ${token}` } })
      setConversations(res.data.conversations)
      setMyNumber(res.data.myNumber)
    } catch (err) {
      console.error('Failed to fetch SMS conversations:', err)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  // Poll for new messages every 20 seconds
  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => {
      fetchConversations()
      if (activePhone) fetchThread(activePhone)
    }, 20000)
    return () => clearInterval(interval)
  }, [session, activePhone, fetchConversations])

  async function fetchThread(phone: string) {
    setLoadingThread(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/sms/conversations/${encodeURIComponent(phone)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setMessages(res.data.messages)
      setThreadContact(res.data.contact)
    } catch (err) {
      console.error('Failed to fetch thread:', err)
    } finally {
      setLoadingThread(false)
    }
  }

  function openThread(phone: string) {
    setActivePhone(phone)
    setMessages([])
    setReplyBody('')
    fetchThread(phone)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendReply() {
    if (!replyBody.trim() || !activePhone) return
    setSending(true)
    try {
      const token = localStorage.getItem('token') || ''
      await axios.post(`${API_URL}/sms/send`, { to: activePhone, body: replyBody }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setReplyBody('')
      await fetchThread(activePhone)
      fetchConversations()
    } catch (err) {
      console.error('Failed to send SMS:', err)
    } finally {
      setSending(false)
    }
  }

  function startNew() {
    if (!newPhone.trim()) return
    setShowNew(false)
    openThread(newPhone.trim())
    setNewPhone('')
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-140px)]">
      {/* Left — Conversations */}
      <div className={`w-full lg:w-80 flex-shrink-0 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col ${activePhone ? 'hidden lg:flex' : 'flex'}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Conversations</h2>
          <button
            onClick={() => setShowNew(true)}
            className="w-7 h-7 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center transition-colors"
            title="New conversation"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {showNew && (
          <div className="p-3 border-b border-gray-100 dark:border-gray-800 bg-indigo-50 dark:bg-indigo-900/20">
            <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mb-2">New conversation</p>
            <div className="flex gap-2">
              <input
                type="tel"
                placeholder="+61 400 000 000"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startNew()}
                className="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
              <button onClick={startNew} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg">Start</button>
              <button onClick={() => setShowNew(false)} className="px-2 py-1.5 text-xs text-gray-500">✕</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm text-gray-500 dark:text-gray-400">No SMS conversations yet</p>
              {myNumber && <p className="text-xs text-gray-400 mt-1">Your number: {myNumber}</p>}
            </div>
          ) : (
            conversations.map(convo => (
              <button
                key={convo.phone}
                onClick={() => openThread(convo.phone)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${activePhone === convo.phone ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {convo.contactName || convo.phone}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{timeAgo(convo.lastAt)}</span>
                </div>
                {convo.contactName && (
                  <p className="text-xs text-gray-400 mb-0.5">{convo.phone}</p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{convo.lastMessage}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right — Thread */}
      <div className={`flex-1 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col ${!activePhone ? 'hidden lg:flex' : 'flex'}`}>
        {!activePhone ? (
          <div className="flex-1 flex items-center justify-center text-center px-8">
            <div>
              <div className="text-4xl mb-3">💬</div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Select a conversation or start a new one</p>
              {myNumber && <p className="text-xs text-gray-400 mt-1">Sending from {myNumber}</p>}
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
              <button onClick={() => setActivePhone(null)} className="lg:hidden text-gray-400 hover:text-gray-600 mr-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/40 rounded-full flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-sm flex-shrink-0">
                {(threadContact?.name || activePhone).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {threadContact?.name || activePhone}
                </p>
                {threadContact?.name && <p className="text-xs text-gray-400 truncate">{activePhone}</p>}
              </div>
              {threadContact && (
                <Link
                  href={`/dashboard/crm/contacts/${threadContact.id}`}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0"
                >
                  View Contact →
                </Link>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {loadingThread ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">No messages yet. Send one below.</p>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm ${
                      msg.direction === 'OUTBOUND'
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-bl-md'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.body}</p>
                      <p className={`text-xs mt-1 ${msg.direction === 'OUTBOUND' ? 'text-indigo-200' : 'text-gray-400'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply box */}
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
              <div className="flex gap-3">
                <textarea
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                  placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                  rows={2}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !replyBody.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors self-end"
                >
                  {sending ? '...' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
