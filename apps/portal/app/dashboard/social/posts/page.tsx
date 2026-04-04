'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface PostAnalytics {
  impressions: number
  reach: number
  engagements: number
  likes: number
  comments: number
  shares: number
}

interface Post {
  id: string
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN'
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED'
  source: 'MANUAL' | 'AI_GENERATED' | 'NEWS_INSPIRED'
  content: string
  imageUrl?: string
  imagePrompt?: string
  hashtags: string[]
  contentPillar?: string
  scheduledAt?: string
  publishedAt?: string
  externalPostId?: string
  errorMessage?: string
  autoApproved: boolean
  metadata?: Record<string, unknown>
  createdAt: string
  analytics?: PostAnalytics
}

type StatusFilter = 'ALL' | 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED'
type PlatformFilter = 'ALL' | 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  SCHEDULED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  PUBLISHING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  PUBLISHED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const PLATFORM_COLORS: Record<string, string> = {
  FACEBOOK: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  INSTAGRAM: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  LINKEDIN: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
}

const PLATFORM_LABELS: Record<string, string> = {
  FACEBOOK: 'FB',
  INSTAGRAM: 'IG',
  LINKEDIN: 'LI',
}

const CONTENT_PILLARS = [
  { value: 'education', label: 'Education' },
  { value: 'social_proof', label: 'Social Proof' },
  { value: 'behind_the_scenes', label: 'Behind the Scenes' },
  { value: 'offers', label: 'Offers' },
  { value: 'entertainment', label: 'Entertainment' },
]

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncate(str: string, len: number) {
  if (str.length <= len) return str
  return str.slice(0, len) + '...'
}

export default function SocialPostsPage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()

  const [posts, setPosts] = useState<Post[]>([])
  const [draftCount, setDraftCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('ALL')

  const [autoApprove, setAutoApprove] = useState(false)
  const [autoApproveLoading, setAutoApproveLoading] = useState(false)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  // Form fields
  const [formPlatform, setFormPlatform] = useState<Post['platform']>('FACEBOOK')
  const [formContent, setFormContent] = useState('')
  const [formContentPillar, setFormContentPillar] = useState('')
  const [formTopic, setFormTopic] = useState('')
  const [formScheduledAt, setFormScheduledAt] = useState('')

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
  }, [authStatus, router])

  const getToken = useCallback(() => {
    return typeof window !== 'undefined'
      ? localStorage.getItem('token') || (session as any)?.accessToken || ''
      : ''
  }, [session])

  const fetchPosts = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    try {
      const token = getToken()
      const params: Record<string, string> = { limit: '50' }
      if (statusFilter !== 'ALL') params.status = statusFilter
      if (platformFilter !== 'ALL') params.platform = platformFilter

      const res = await axios.get(`${API_URL}/social/posts`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      })
      setPosts(res.data.posts || [])
      setDraftCount(res.data.draftCount || 0)
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load posts')
    } finally {
      setLoading(false)
    }
  }, [session, statusFilter, platformFilter, getToken])

  const fetchAutoApprove = useCallback(async () => {
    if (!session) return
    try {
      const token = getToken()
      const res = await axios.get(`${API_URL}/social/settings/auto-approve`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setAutoApprove(!!res.data.autoApprovePosts)
    } catch {
      // non-critical
    }
  }, [session, getToken])

  useEffect(() => {
    fetchPosts()
    fetchAutoApprove()
  }, [fetchPosts, fetchAutoApprove])

  const toggleAutoApprove = async () => {
    setAutoApproveLoading(true)
    try {
      const token = getToken()
      await axios.patch(
        `${API_URL}/social/settings/auto-approve`,
        { enabled: !autoApprove },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setAutoApprove(!autoApprove)
    } catch {
      // ignore
    } finally {
      setAutoApproveLoading(false)
    }
  }

  // --- Modal helpers ---

  function openCreateModal() {
    setModalMode('create')
    setSelectedPost(null)
    setFormPlatform('FACEBOOK')
    setFormContent('')
    setFormContentPillar('')
    setFormTopic('')
    setFormScheduledAt('')
    setModalOpen(true)
  }

  function openEditModal(post: Post) {
    setModalMode('edit')
    setSelectedPost(post)
    setFormPlatform(post.platform)
    setFormContent(post.content)
    setFormContentPillar(post.contentPillar || '')
    setFormTopic('')
    setFormScheduledAt(
      post.scheduledAt ? new Date(post.scheduledAt).toISOString().slice(0, 16) : ''
    )
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setSelectedPost(null)
    setSaving(false)
    setGenerating(false)
  }

  // --- API actions ---

  async function handleCreatePost() {
    setSaving(true)
    try {
      const token = getToken()
      await axios.post(
        `${API_URL}/social/posts`,
        {
          platform: formPlatform,
          content: formContent,
          contentPillar: formContentPillar || undefined,
          scheduledAt: formScheduledAt || undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      closeModal()
      fetchPosts()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to create post')
      setSaving(false)
    }
  }

  async function handleUpdatePost() {
    if (!selectedPost) return
    setSaving(true)
    try {
      const token = getToken()
      await axios.patch(
        `${API_URL}/social/posts/${selectedPost.id}`,
        {
          platform: formPlatform,
          content: formContent,
          contentPillar: formContentPillar || undefined,
          scheduledAt: formScheduledAt || undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      closeModal()
      fetchPosts()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to update post')
      setSaving(false)
    }
  }

  async function handleGenerateAI() {
    setGenerating(true)
    try {
      const token = getToken()
      const res = await axios.post(
        `${API_URL}/social/posts/generate`,
        {
          platform: formPlatform,
          topic: formTopic || undefined,
          contentPillar: formContentPillar || undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      // If we're in create mode, fill in the content. If returned a full post, switch to edit mode.
      if (res.data.post) {
        setSelectedPost(res.data.post)
        setModalMode('edit')
        setFormContent(res.data.post.content || '')
        setFormContentPillar(res.data.post.contentPillar || formContentPillar)
      } else if (res.data.content) {
        setFormContent(res.data.content)
      }
      fetchPosts()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'AI generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleRegenerate() {
    if (!selectedPost) return
    setGenerating(true)
    try {
      const token = getToken()
      const res = await axios.post(
        `${API_URL}/social/posts/${selectedPost.id}/regenerate`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.data.post) {
        setSelectedPost(res.data.post)
        setFormContent(res.data.post.content || '')
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Regeneration failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleApprove(publishNow = false) {
    if (!selectedPost) return
    setSaving(true)
    try {
      const token = getToken()
      const body = publishNow
        ? { publishNow: true }
        : { scheduledAt: formScheduledAt || undefined }
      await axios.post(
        `${API_URL}/social/posts/${selectedPost.id}/approve`,
        body,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      closeModal()
      fetchPosts()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to approve post')
      setSaving(false)
    }
  }

  async function handlePublishNow() {
    if (!selectedPost) return
    setSaving(true)
    try {
      const token = getToken()
      await axios.post(
        `${API_URL}/social/posts/${selectedPost.id}/publish`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      closeModal()
      fetchPosts()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to publish post')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedPost) return
    if (!confirm('Are you sure you want to delete this post?')) return
    setSaving(true)
    try {
      const token = getToken()
      await axios.delete(`${API_URL}/social/posts/${selectedPost.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      closeModal()
      fetchPosts()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to delete post')
      setSaving(false)
    }
  }

  // --- Character limits per platform ---
  const charLimits: Record<string, number> = {
    FACEBOOK: 63206,
    INSTAGRAM: 2200,
    LINKEDIN: 3000,
  }

  const charLimit = charLimits[formPlatform] || 3000

  // --- Filter tabs ---
  const filterTabs: { key: StatusFilter; label: string; count?: number }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'DRAFT', label: 'Drafts', count: draftCount },
    { key: 'SCHEDULED', label: 'Scheduled' },
    { key: 'PUBLISHED', label: 'Published' },
    { key: 'FAILED', label: 'Failed' },
  ]

  // --- Render ---

  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Social Posts</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage, schedule, and publish your social media content across platforms.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Auto-approve toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Auto-Approve AI Posts</span>
            <button
              onClick={toggleAutoApprove}
              disabled={autoApproveLoading}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                autoApprove ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
              } ${autoApproveLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              role="switch"
              aria-checked={autoApprove}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoApprove ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create Post
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={() => setError('')}
              className="text-red-500 hover:text-red-700 dark:hover:text-red-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Draft notification banner */}
      {draftCount > 0 && statusFilter !== 'DRAFT' && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-amber-700 dark:text-amber-400">
              You have <strong>{draftCount}</strong> AI-generated draft{draftCount !== 1 ? 's' : ''} waiting for review.
            </p>
            <button
              onClick={() => setStatusFilter('DRAFT')}
              className="ml-auto text-sm font-medium text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 underline"
            >
              Review now
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        {/* Status tabs */}
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === tab.key
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Platform filter */}
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value as PlatformFilter)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="ALL">All Platforms</option>
          <option value="FACEBOOK">Facebook</option>
          <option value="INSTAGRAM">Instagram</option>
          <option value="LINKEDIN">LinkedIn</option>
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!loading && posts.length === 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 py-16 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">No posts found</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {statusFilter !== 'ALL'
              ? `No ${statusFilter.toLowerCase()} posts. Try a different filter.`
              : 'Get started by creating your first post or generating one with AI.'}
          </p>
          {statusFilter === 'ALL' && (
            <button
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              Create Post
            </button>
          )}
        </div>
      )}

      {/* Post cards */}
      {!loading && posts.length > 0 && (
        <div className="grid gap-4">
          {posts.map((post) => (
            <div
              key={post.id}
              onClick={() => openEditModal(post)}
              className="cursor-pointer rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {/* Platform badge */}
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                        PLATFORM_COLORS[post.platform] || ''
                      }`}
                    >
                      {PLATFORM_LABELS[post.platform] || post.platform}
                    </span>

                    {/* Status badge */}
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLORS[post.status] || ''
                      }`}
                    >
                      {post.status}
                    </span>

                    {/* Source badge */}
                    {post.source === 'AI_GENERATED' && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                        </svg>
                        AI
                      </span>
                    )}
                    {post.source === 'NEWS_INSPIRED' && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                        News
                      </span>
                    )}

                    {/* Auto-approved indicator */}
                    {post.autoApproved && (
                      <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Auto-approved
                      </span>
                    )}
                  </div>

                  {/* Content preview */}
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {truncate(post.content, 100)}
                  </p>

                  {/* Hashtags */}
                  {post.hashtags && post.hashtags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {post.hashtags.slice(0, 5).map((tag, i) => (
                        <span
                          key={i}
                          className="text-xs text-indigo-600 dark:text-indigo-400"
                        >
                          #{tag}
                        </span>
                      ))}
                      {post.hashtags.length > 5 && (
                        <span className="text-xs text-gray-400">+{post.hashtags.length - 5} more</span>
                      )}
                    </div>
                  )}

                  {/* Error message for failed posts */}
                  {post.status === 'FAILED' && post.errorMessage && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      Error: {post.errorMessage}
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                  {post.scheduledAt && post.status === 'SCHEDULED' && (
                    <span>Scheduled: {formatDateTime(post.scheduledAt)}</span>
                  )}
                  {post.publishedAt && (
                    <span>Published: {formatDateTime(post.publishedAt)}</span>
                  )}
                  {!post.publishedAt && !post.scheduledAt && (
                    <span>Created: {formatDateTime(post.createdAt)}</span>
                  )}

                  {/* Analytics summary for published posts */}
                  {post.analytics && (
                    <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span title="Impressions">{post.analytics.impressions.toLocaleString()} views</span>
                      <span title="Engagements">{post.analytics.engagements.toLocaleString()} eng.</span>
                      <span title="Likes">{post.analytics.likes.toLocaleString()} likes</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Modal content */}
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {modalMode === 'create' ? 'Create Post' : 'Edit Post'}
              </h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Published / read-only state */}
            {selectedPost?.status === 'PUBLISHED' && (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                <p className="text-sm text-green-700 dark:text-green-400">
                  This post has been published and cannot be edited.
                </p>
              </div>
            )}

            {/* Failed post error */}
            {selectedPost?.status === 'FAILED' && selectedPost.errorMessage && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                <p className="text-sm text-red-700 dark:text-red-400">
                  <strong>Publish failed:</strong> {selectedPost.errorMessage}
                </p>
              </div>
            )}

            {/* Platform selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Platform
              </label>
              <div className="flex gap-2">
                {(['FACEBOOK', 'INSTAGRAM', 'LINKEDIN'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setFormPlatform(p)}
                    disabled={selectedPost?.status === 'PUBLISHED'}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      formPlatform === p
                        ? PLATFORM_COLORS[p] + ' ring-2 ring-offset-1 ring-indigo-500 dark:ring-offset-gray-900'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    } ${selectedPost?.status === 'PUBLISHED' ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    {p === 'FACEBOOK' ? 'Facebook' : p === 'INSTAGRAM' ? 'Instagram' : 'LinkedIn'}
                  </button>
                ))}
              </div>
            </div>

            {/* Content pillar */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Content Pillar
              </label>
              <select
                value={formContentPillar}
                onChange={(e) => setFormContentPillar(e.target.value)}
                disabled={selectedPost?.status === 'PUBLISHED'}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              >
                <option value="">Select a pillar (optional)</option>
                {CONTENT_PILLARS.map((cp) => (
                  <option key={cp.value} value={cp.value}>
                    {cp.label}
                  </option>
                ))}
              </select>
            </div>

            {/* AI Generation section - only for create or draft */}
            {(modalMode === 'create' || selectedPost?.status === 'DRAFT') && (
              <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800/50">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <svg className="h-4 w-4 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                  AI Generation
                </h3>
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Topic (optional - describe what you want the post about)
                  </label>
                  <input
                    type="text"
                    value={formTopic}
                    onChange={(e) => setFormTopic(e.target.value)}
                    placeholder="e.g., Benefits of automation for small businesses"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex gap-2">
                  {modalMode === 'create' && (
                    <button
                      onClick={handleGenerateAI}
                      disabled={generating}
                      className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generating && (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      )}
                      Generate with AI
                    </button>
                  )}
                  {modalMode === 'edit' && selectedPost?.status === 'DRAFT' && (
                    <button
                      onClick={handleRegenerate}
                      disabled={generating}
                      className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generating && (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      )}
                      Regenerate
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Content textarea */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Content
                </label>
                <span
                  className={`text-xs ${
                    formContent.length > charLimit
                      ? 'text-red-500'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {formContent.length.toLocaleString()} / {charLimit.toLocaleString()}
                </span>
              </div>
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                disabled={selectedPost?.status === 'PUBLISHED'}
                rows={6}
                placeholder="Write your post content here..."
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 resize-y"
              />
            </div>

            {/* Image section */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Image
              </label>
              {selectedPost?.imageUrl || (modalMode === 'edit' && selectedPost?.imageUrl) ? (
                <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 mb-2">
                  <img
                    src={selectedPost?.imageUrl}
                    alt="Post image"
                    className="w-full h-48 object-cover"
                  />
                </div>
              ) : null}
              {selectedPost?.status !== 'PUBLISHED' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!selectedPost?.id) return
                      setGenerating(true)
                      try {
                        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
                        const res = await axios.post(
                          `${API_URL}/social/posts/${selectedPost.id}/generate-image`,
                          { imagePrompt: selectedPost.imagePrompt },
                          { headers: { Authorization: `Bearer ${token}` } }
                        )
                        setSelectedPost({ ...selectedPost, imageUrl: res.data.imageUrl })
                        fetchPosts()
                      } catch {
                        alert('Failed to generate image')
                      } finally {
                        setGenerating(false)
                      }
                    }}
                    disabled={generating || !selectedPost?.imagePrompt}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generating ? (
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                    )}
                    {selectedPost?.imageUrl ? 'Regenerate Image' : 'Generate Image'}
                  </button>
                  {selectedPost?.imagePrompt && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[200px]" title={selectedPost.imagePrompt}>
                      Prompt: {selectedPost.imagePrompt.substring(0, 50)}...
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Schedule date/time */}
            {selectedPost?.status !== 'PUBLISHED' && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Schedule Date &amp; Time
                </label>
                <input
                  type="datetime-local"
                  value={formScheduledAt}
                  onChange={(e) => setFormScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {/* Analytics for published posts */}
            {selectedPost?.status === 'PUBLISHED' && selectedPost.analytics && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Analytics
                </h3>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {[
                    { label: 'Impressions', value: selectedPost.analytics.impressions },
                    { label: 'Reach', value: selectedPost.analytics.reach },
                    { label: 'Engagements', value: selectedPost.analytics.engagements },
                    { label: 'Likes', value: selectedPost.analytics.likes },
                    { label: 'Comments', value: selectedPost.analytics.comments },
                    { label: 'Shares', value: selectedPost.analytics.shares },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3 text-center"
                    >
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">
                        {stat.value.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 dark:border-gray-700 pt-4">
              {/* CREATE mode */}
              {modalMode === 'create' && (
                <>
                  <button
                    onClick={closeModal}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreatePost}
                    disabled={saving || !formContent.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving && (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    )}
                    Create Post
                  </button>
                </>
              )}

              {/* DRAFT mode */}
              {modalMode === 'edit' && selectedPost?.status === 'DRAFT' && (
                <>
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    Delete
                  </button>
                  <button
                    onClick={handleUpdatePost}
                    disabled={saving || !formContent.trim()}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    Save Draft
                  </button>
                  <button
                    onClick={() => handleApprove(true)}
                    disabled={saving || !formContent.trim()}
                    className="rounded-lg border border-indigo-200 dark:border-indigo-800 px-4 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-50"
                  >
                    Post Now
                  </button>
                  <button
                    onClick={() => handleApprove(false)}
                    disabled={saving || !formContent.trim() || !formScheduledAt}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving && (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    )}
                    Approve &amp; Schedule
                  </button>
                </>
              )}

              {/* SCHEDULED mode */}
              {modalMode === 'edit' && selectedPost?.status === 'SCHEDULED' && (
                <>
                  <button
                    onClick={async () => {
                      setSaving(true)
                      try {
                        const token = getToken()
                        await axios.patch(
                          `${API_URL}/social/posts/${selectedPost.id}`,
                          { status: 'DRAFT' },
                          { headers: { Authorization: `Bearer ${token}` } }
                        )
                        closeModal()
                        fetchPosts()
                      } catch (err: any) {
                        setError(err?.response?.data?.error || 'Failed to cancel schedule')
                        setSaving(false)
                      }
                    }}
                    disabled={saving}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    Cancel Schedule
                  </button>
                  <button
                    onClick={handleUpdatePost}
                    disabled={saving || !formContent.trim() || !formScheduledAt}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving && (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    )}
                    Reschedule
                  </button>
                </>
              )}

              {/* FAILED mode */}
              {modalMode === 'edit' && selectedPost?.status === 'FAILED' && (
                <>
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    Delete
                  </button>
                  <button
                    onClick={handlePublishNow}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving && (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    )}
                    Retry
                  </button>
                </>
              )}

              {/* PUBLISHED mode - just close */}
              {modalMode === 'edit' && selectedPost?.status === 'PUBLISHED' && (
                <button
                  onClick={closeModal}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                >
                  Close
                </button>
              )}

              {/* PUBLISHING mode - just close */}
              {modalMode === 'edit' && selectedPost?.status === 'PUBLISHING' && (
                <button
                  onClick={closeModal}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
