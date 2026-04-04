'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Snapshot {
  followers: number
  posts: number
  avgLikes: number
  avgComments: number
  engagementRate: number
  fetchedAt: string
}

interface Competitor {
  id: string
  name: string
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN'
  handle: string
  avatarUrl: string | null
  isActive: boolean
  snapshots: Snapshot[]
}

const PLATFORM_COLORS: Record<string, string> = {
  FACEBOOK: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  INSTAGRAM: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  LINKEDIN: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-rose-500', 'bg-amber-500', 'bg-cyan-500', 'bg-violet-500']

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export default function CompetitorsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [historicalSnapshots, setHistoricalSnapshots] = useState<Snapshot[]>([])
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)

  // Add form state
  const [formName, setFormName] = useState('')
  const [formPlatform, setFormPlatform] = useState<'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN'>('INSTAGRAM')
  const [formHandle, setFormHandle] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem('token') || (session as any)?.accessToken || ''
    return { Authorization: `Bearer ${token}` }
  }, [session])

  const fetchCompetitors = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/social/competitors`, { headers: authHeaders() })
      setCompetitors(res.data || [])
    } catch (err) {
      console.error('Failed to load competitors:', err)
    } finally {
      setLoading(false)
    }
  }, [session, authHeaders])

  useEffect(() => { fetchCompetitors() }, [fetchCompetitors])

  async function handleAdd() {
    if (!formName.trim() || !formHandle.trim()) return
    setSaving(true)
    try {
      await axios.post(`${API_URL}/social/competitors`, {
        name: formName.trim(),
        platform: formPlatform,
        handle: formHandle.trim(),
      }, { headers: authHeaders() })
      setFormName('')
      setFormHandle('')
      setFormPlatform('INSTAGRAM')
      setShowAdd(false)
      fetchCompetitors()
    } catch (err) {
      console.error('Failed to add competitor:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await axios.delete(`${API_URL}/social/competitors/${id}`, { headers: authHeaders() })
      setDeleteConfirm(null)
      if (expandedId === id) setExpandedId(null)
      fetchCompetitors()
    } catch (err) {
      console.error('Failed to delete competitor:', err)
    }
  }

  async function toggleExpanded(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      setHistoricalSnapshots([])
      return
    }
    setExpandedId(id)
    setLoadingSnapshots(true)
    try {
      const res = await axios.get(`${API_URL}/social/competitors/${id}/snapshots`, {
        params: { limit: 30 },
        headers: authHeaders(),
      })
      setHistoricalSnapshots(res.data || [])
    } catch (err) {
      console.error('Failed to load snapshots:', err)
      setHistoricalSnapshots([])
    } finally {
      setLoadingSnapshots(false)
    }
  }

  if (status === 'loading' || (status === 'authenticated' && loading)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Competitor Tracker</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition"
        >
          Add Competitor
        </button>
      </div>

      {/* Add Competitor Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add Competitor</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Competitor name"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Platform</label>
                <select
                  value={formPlatform}
                  onChange={e => setFormPlatform(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="FACEBOOK">Facebook</option>
                  <option value="INSTAGRAM">Instagram</option>
                  <option value="LINKEDIN">LinkedIn</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Handle / Username</label>
                <input
                  value={formHandle}
                  onChange={e => setFormHandle(e.target.value)}
                  placeholder="@username"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={saving || !formName.trim() || !formHandle.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {competitors.length === 0 && !loading && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            No competitors tracked yet. Add your first competitor to start monitoring.
          </p>
        </div>
      )}

      {/* Competitor Grid */}
      {competitors.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {competitors.map((c, idx) => {
            const latest = c.snapshots?.[0]
            const isExpanded = expandedId === c.id
            return (
              <div
                key={c.id}
                className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 transition ${
                  isExpanded ? 'col-span-1 md:col-span-2 lg:col-span-3' : ''
                }`}
              >
                <div
                  className="p-5 cursor-pointer"
                  onClick={() => toggleExpanded(c.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm ${AVATAR_COLORS[idx % AVATAR_COLORS.length]}`}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{c.name}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">@{c.handle}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PLATFORM_COLORS[c.platform] || ''}`}>
                        {c.platform.charAt(0) + c.platform.slice(1).toLowerCase()}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteConfirm(c.id) }}
                        className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Latest stats */}
                  {latest && (
                    <div className="grid grid-cols-4 gap-3 mt-4">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Followers</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatNumber(latest.followers)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Avg Likes</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatNumber(latest.avgLikes)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Avg Comments</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatNumber(latest.avgComments)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Engagement</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{latest.engagementRate.toFixed(2)}%</p>
                      </div>
                    </div>
                  )}

                  {!latest && (
                    <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">No snapshot data yet</p>
                  )}
                </div>

                {/* Delete confirm */}
                {deleteConfirm === c.id && (
                  <div className="px-5 pb-4 flex items-center gap-2">
                    <span className="text-xs text-red-600 dark:text-red-400">Delete this competitor?</span>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(c.id) }}
                      className="px-3 py-1 rounded text-xs font-medium text-white bg-red-600 hover:bg-red-700 transition"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteConfirm(null) }}
                      className="px-3 py-1 rounded text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Expanded: historical chart */}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-800 px-5 py-4">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Follower History</h4>
                    {loadingSnapshots ? (
                      <div className="flex justify-center py-8">
                        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : historicalSnapshots.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No historical data available.</p>
                    ) : (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={[...historicalSnapshots].reverse().map(s => ({ date: formatDate(s.fetchedAt), followers: s.followers }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9CA3AF" />
                            <YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px', color: '#F9FAFB' }}
                              labelStyle={{ color: '#9CA3AF' }}
                            />
                            <Line type="monotone" dataKey="followers" stroke="#6366F1" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
