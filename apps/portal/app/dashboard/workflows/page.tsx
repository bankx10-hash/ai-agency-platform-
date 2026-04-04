'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  PAUSED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  ARCHIVED: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
}

const CHANNEL_ICONS: Record<string, { label: string; color: string }> = {
  whatsapp:  { label: 'WA', color: 'bg-green-500' },
  facebook:  { label: 'FB', color: 'bg-blue-600' },
  instagram: { label: 'IG', color: 'bg-pink-500' },
}

const TRIGGER_LABELS: Record<string, string> = {
  dm: 'DMs',
  comment: 'Comments',
  story_reply: 'Story Replies',
  story_mention: 'Story Mentions',
}

interface Workflow {
  id: string
  name: string
  description?: string
  status: string
  channels: string[]
  triggerOn?: string[]
  qualifyThreshold: number
  conversationCount: number
  qualifiedCount: number
  qualificationRate: number
  questions: { id: string }[]
  createdAt: string
}

export default function WorkflowsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('ALL')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchWorkflows = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/workflows`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setWorkflows(res.data)
    } catch {
      console.error('Failed to fetch workflows')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetchWorkflows() }, [fetchWorkflows])

  const filtered = filter === 'ALL' ? workflows : workflows.filter(w => w.status === filter)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Workflows</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Conversational lead qualification across messaging channels
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/workflows/new')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Workflow
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
        {['ALL', 'ACTIVE', 'DRAFT', 'PAUSED'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === s
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="theme-card rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">💬</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No workflows yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Create a conversational workflow to qualify leads on WhatsApp, Instagram, and Facebook.
          </p>
          <button
            onClick={() => router.push('/dashboard/workflows/new')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Create your first workflow
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(w => (
            <div
              key={w.id}
              onClick={() => router.push(`/dashboard/workflows/${w.id}`)}
              className="theme-card rounded-xl p-5 cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate pr-2">{w.name}</h3>
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase ${STATUS_COLORS[w.status] || STATUS_COLORS.DRAFT}`}>
                  {w.status}
                </span>
              </div>

              {w.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{w.description}</p>
              )}

              {/* Channels & Triggers */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {w.channels.map(ch => {
                  const info = CHANNEL_ICONS[ch]
                  if (!info) return null
                  return (
                    <span key={ch} className={`${info.color} text-white text-[9px] font-bold px-1.5 py-0.5 rounded`}>
                      {info.label}
                    </span>
                  )
                })}
                {(w.triggerOn || ['dm']).map(t => (
                  <span key={t} className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[9px] font-medium px-1.5 py-0.5 rounded">
                    {TRIGGER_LABELS[t] || t}
                  </span>
                ))}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white num">{w.questions.length}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">Questions</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white num">{w.conversationCount}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">Conversations</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-green-600 dark:text-green-400 num">{w.qualificationRate}%</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">Qualified</div>
                </div>
              </div>

              {/* Delete button */}
              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  if (!confirm(`Delete workflow "${w.name}"? This will also delete all conversations and questions.`)) return
                  try {
                    const token = localStorage.getItem('token')
                    await axios.delete(`${API_URL}/workflows/${w.id}`, {
                      headers: { Authorization: `Bearer ${token}` }
                    })
                    fetchWorkflows()
                  } catch {
                    alert('Failed to delete workflow')
                  }
                }}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
