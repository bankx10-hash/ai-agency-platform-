'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface NewsItem {
  id: string
  title: string
  source: string
  url: string
  imageUrl: string | null
  summary: string
  category: string
  publishedAt: string
  isRead: boolean
  isSaved: boolean
}

interface SourcesConfig {
  rssFeeds: string[]
  keywords: string[]
}

type FilterTab = 'all' | 'industry' | 'trending' | 'saved'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function NewsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')

  // Sources modal
  const [showSources, setShowSources] = useState(false)
  const [rssText, setRssText] = useState('')
  const [keywordsText, setKeywordsText] = useState('')
  const [savingSources, setSavingSources] = useState(false)
  const [loadingSources, setLoadingSources] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem('token') || (session as any)?.accessToken || ''
    return { Authorization: `Bearer ${token}` }
  }, [session])

  const fetchNews = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const params: Record<string, string> = { limit: '30' }
      if (activeTab === 'industry') params.category = 'industry'
      if (activeTab === 'trending') params.category = 'trending'
      if (activeTab === 'saved') params.saved = 'true'

      const res = await axios.get(`${API_URL}/social/news`, { params, headers: authHeaders() })
      setNews(res.data || [])
    } catch (err) {
      console.error('Failed to load news:', err)
    } finally {
      setLoading(false)
    }
  }, [session, activeTab, authHeaders])

  useEffect(() => { fetchNews() }, [fetchNews])

  async function toggleSaved(item: NewsItem) {
    try {
      await axios.patch(`${API_URL}/social/news/${item.id}`, { isSaved: !item.isSaved }, { headers: authHeaders() })
      setNews(prev => prev.map(n => n.id === item.id ? { ...n, isSaved: !n.isSaved } : n))
    } catch (err) {
      console.error('Failed to update news item:', err)
    }
  }

  async function markRead(item: NewsItem) {
    if (item.isRead) return
    try {
      await axios.patch(`${API_URL}/social/news/${item.id}`, { isRead: true }, { headers: authHeaders() })
      setNews(prev => prev.map(n => n.id === item.id ? { ...n, isRead: true } : n))
    } catch (err) {
      console.error('Failed to mark as read:', err)
    }
  }

  async function openSourcesModal() {
    setShowSources(true)
    setLoadingSources(true)
    try {
      const res = await axios.get(`${API_URL}/social/news/sources`, { headers: authHeaders() })
      const data: SourcesConfig = res.data
      setRssText((data.rssFeeds || []).join('\n'))
      setKeywordsText((data.keywords || []).join(', '))
    } catch (err) {
      console.error('Failed to load sources:', err)
    } finally {
      setLoadingSources(false)
    }
  }

  async function saveSources() {
    setSavingSources(true)
    try {
      const rssFeeds = rssText.split('\n').map(l => l.trim()).filter(Boolean)
      const keywords = keywordsText.split(',').map(k => k.trim()).filter(Boolean)
      await axios.post(`${API_URL}/social/news/sources`, { rssFeeds, keywords }, { headers: authHeaders() })
      setShowSources(false)
      fetchNews()
    } catch (err) {
      console.error('Failed to save sources:', err)
    } finally {
      setSavingSources(false)
    }
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'industry', label: 'Industry' },
    { key: 'trending', label: 'Trending' },
    { key: 'saved', label: 'Saved' },
  ]

  if (status === 'loading' || (status === 'authenticated' && loading)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">News Feed</h1>
        <button
          onClick={openSourcesModal}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          title="Configure sources"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              activeTab === t.key
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sources Modal */}
      {showSources && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 w-full max-w-lg shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Configure News Sources</h2>
            {loadingSources ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">RSS Feeds (one URL per line)</label>
                  <textarea
                    value={rssText}
                    onChange={e => setRssText(e.target.value)}
                    rows={5}
                    placeholder="https://example.com/feed.xml"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Keywords (comma separated)</label>
                  <textarea
                    value={keywordsText}
                    onChange={e => setKeywordsText(e.target.value)}
                    rows={3}
                    placeholder="AI, marketing, SaaS"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowSources(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveSources}
                disabled={savingSources || loadingSources}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {savingSources ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {news.length === 0 && !loading && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            No news items yet. Configure your RSS feeds and keywords to start receiving industry news.
          </p>
        </div>
      )}

      {/* News List */}
      {news.length > 0 && (
        <div className="space-y-3">
          {news.map(item => (
            <div
              key={item.id}
              className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex gap-4 transition ${
                !item.isRead ? 'ring-1 ring-indigo-200 dark:ring-indigo-900/50' : ''
              }`}
            >
              {/* Thumbnail */}
              <div className="flex-shrink-0">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="w-20 h-20 rounded-lg object-cover bg-gray-100 dark:bg-gray-800"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6V7.5z" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => markRead(item)}
                  className={`block text-sm hover:text-indigo-600 dark:hover:text-indigo-400 transition ${
                    item.isRead
                      ? 'font-medium text-gray-700 dark:text-gray-300'
                      : 'font-bold text-gray-900 dark:text-white'
                  }`}
                >
                  {item.title}
                </a>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{item.source}</span>
                  <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{timeAgo(item.publishedAt)}</span>
                </div>
                {item.summary && (
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                    {item.summary}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => toggleSaved(item)}
                    className={`p-1.5 rounded-lg transition ${
                      item.isSaved
                        ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    title={item.isSaved ? 'Remove bookmark' : 'Bookmark'}
                  >
                    <svg className="w-4 h-4" fill={item.isSaved ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => router.push(`/dashboard/social/posts?topic=${encodeURIComponent(item.title)}`)}
                    className="px-3 py-1 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition"
                  >
                    Create Post
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
