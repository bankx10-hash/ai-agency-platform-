'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface EmailMessage {
  id: string
  from: string
  to: string
  subject: string
  date: string
  body: string
  bodyText: string
  isUnread: boolean
  messageId: string
  references: string
}

interface Contact {
  id: string
  name?: string
  email?: string
  pipelineStage?: string
  score?: number
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit'
  })
}

function extractName(from: string) {
  const match = from.match(/^(.+?)\s*</)
  return match ? match[1].replace(/"/g, '').trim() : from.split('@')[0]
}

function extractEmail(from: string) {
  const match = from.match(/<(.+?)>/)
  return match ? match[1] : from.trim()
}

function MessageBubble({ msg, connectedEmail, expanded, onToggle }: {
  msg: EmailMessage
  connectedEmail: string
  expanded: boolean
  onToggle: () => void
}) {
  const isMe = extractEmail(msg.from).toLowerCase() === connectedEmail.toLowerCase()

  return (
    <div className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1 ${
        isMe ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
      }`}>
        {extractName(msg.from).charAt(0).toUpperCase()}
      </div>

      <div className={`flex-1 max-w-2xl ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`rounded-2xl border cursor-pointer w-full ${
            expanded
              ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              : 'bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
          }`}
          onClick={!expanded ? onToggle : undefined}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-4 py-3" onClick={onToggle}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{extractName(msg.from)}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {isMe ? `To: ${msg.to}` : extractEmail(msg.from)}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-gray-400">{msg.date ? formatDate(msg.date) : ''}</span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Body */}
          {expanded && (
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800 pt-3">
              {msg.body ? (
                <div
                  className="text-sm text-gray-700 dark:text-gray-300 prose prose-sm dark:prose-invert max-w-none overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: msg.body }}
                />
              ) : (
                <p className="text-sm text-gray-500 whitespace-pre-wrap">{msg.bodyText || '(no content)'}</p>
              )}
            </div>
          )}

          {/* Collapsed preview */}
          {!expanded && (
            <div className="px-4 pb-3">
              <p className="text-xs text-gray-400 truncate">{msg.bodyText?.slice(0, 120) || '(no preview)'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ThreadPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const threadId = params.threadId as string
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [contact, setContact] = useState<Contact | null>(null)
  const [connectedEmail, setConnectedEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [subject, setSubject] = useState('')
  const replyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const token = () => localStorage.getItem('token') || ''

  const fetchThread = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/inbox/threads/${threadId}`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      const msgs: EmailMessage[] = res.data.thread.messages
      setMessages(msgs)
      setContact(res.data.contact)
      setConnectedEmail(res.data.connectedEmail || '')
      setSubject(msgs[0]?.subject || '')
      // Expand last message by default
      if (msgs.length > 0) {
        setExpandedIds(new Set([msgs[msgs.length - 1].id]))
      }
    } catch {
      console.error('Failed to fetch thread')
    } finally {
      setLoading(false)
    }
  }, [threadId])

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchThread()
  }, [status, fetchThread])

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleReply() {
    if (!replyBody.trim()) return
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg) return
    setSending(true)
    try {
      const replyTo = extractEmail(lastMsg.from) === connectedEmail
        ? lastMsg.to
        : lastMsg.from
      await axios.post(`${API_URL}/inbox/threads/${threadId}/reply`, {
        body: replyBody.replace(/\n/g, '<br>'),
        to: extractEmail(replyTo),
        subject,
        messageId: lastMsg.messageId,
        references: lastMsg.references ? `${lastMsg.references} ${lastMsg.messageId}` : lastMsg.messageId,
      }, { headers: { Authorization: `Bearer ${token()}` } })
      setReplyBody('')
      fetchThread()
    } catch {
      console.error('Failed to send reply')
    } finally {
      setSending(false)
    }
  }

  async function handleSuggest() {
    setSuggesting(true)
    try {
      const res = await axios.post(`${API_URL}/inbox/threads/${threadId}/suggest-reply`, {}, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      if (res.data.suggestion) {
        setReplyBody(res.data.suggestion)
        replyRef.current?.focus()
      }
    } catch {
      console.error('Failed to get suggestion')
    } finally {
      setSuggesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const firstMsg = messages[0]

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <button onClick={() => router.push('/dashboard/inbox')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mt-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">
            {firstMsg?.subject || '(no subject)'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{messages.length} message{messages.length !== 1 ? 's' : ''}</p>
        </div>

        {/* CRM contact badge */}
        {contact && (
          <button
            onClick={() => router.push(`/dashboard/crm/contacts/${contact.id}`)}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors flex-shrink-0"
          >
            <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-400">
              {(contact.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="text-left">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">{contact.name || contact.email}</p>
              <p className="text-xs text-indigo-500 dark:text-indigo-500">
                {contact.pipelineStage?.replace(/_/g, ' ')}
                {contact.score != null && ` · ${contact.score}`}
              </p>
            </div>
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="space-y-3 mb-6">
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            connectedEmail={connectedEmail}
            expanded={expandedIds.has(msg.id)}
            onToggle={() => toggleExpanded(msg.id)}
          />
        ))}
      </div>

      {/* Reply box */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Reply to {firstMsg ? extractName(
              extractEmail(messages[messages.length - 1]?.from || '') === connectedEmail
                ? (messages[messages.length - 1]?.to || '')
                : (messages[messages.length - 1]?.from || '')
            ) : ''}
          </p>
        </div>
        <textarea
          ref={replyRef}
          value={replyBody}
          onChange={e => setReplyBody(e.target.value)}
          rows={5}
          placeholder="Write your reply..."
          className="w-full px-4 py-3 text-sm text-gray-900 dark:text-white bg-transparent placeholder-gray-400 focus:outline-none resize-y"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply()
          }}
        />
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-400">Cmd/Ctrl + Enter to send</p>
            <button
              onClick={handleSuggest}
              disabled={suggesting || sending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 transition-colors"
            >
              {suggesting ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Thinking...
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Suggest Reply
                </>
              )}
            </button>
          </div>
          <button
            onClick={handleReply}
            disabled={sending || !replyBody.trim()}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {sending ? 'Sending...' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  )
}
