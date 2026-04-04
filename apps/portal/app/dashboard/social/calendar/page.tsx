'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Post {
  id: string
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN'
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED'
  source: 'MANUAL' | 'AI_GENERATED' | 'NEWS_INSPIRED'
  content: string
  scheduledAt?: string
  publishedAt?: string
  contentPillar?: string
  createdAt: string
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function platformInitial(p: Post['platform']): string {
  return p === 'FACEBOOK' ? 'F' : p === 'INSTAGRAM' ? 'I' : 'L'
}

function chipClasses(post: Post): string {
  if (post.status === 'FAILED') {
    return 'bg-red-500 text-white'
  }
  if (post.status === 'DRAFT') {
    return 'border border-dashed border-gray-400 bg-gray-50 text-gray-600 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400'
  }
  // SCHEDULED, PUBLISHING, PUBLISHED — use platform color
  const colors: Record<Post['platform'], string> = {
    FACEBOOK: 'bg-blue-500 text-white',
    INSTAGRAM: 'bg-pink-500 text-white',
    LINKEDIN: 'bg-sky-600 text-white',
  }
  return colors[post.platform]
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text
}

function toMonthStr(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startDayOfWeek = firstDay.getDay()
  const totalDays = lastDay.getDate()

  const days: Array<{ date: Date; inMonth: boolean }> = []

  // Previous month fill
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = new Date(year, month, -i)
    days.push({ date: d, inMonth: false })
  }

  // Current month
  for (let i = 1; i <= totalDays; i++) {
    days.push({ date: new Date(year, month, i), inMonth: true })
  }

  // Next month fill to complete the grid (always 6 rows)
  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i++) {
    days.push({ date: new Date(year, month + 1, i), inMonth: false })
  }

  return days
}

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isToday(d: Date): boolean {
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
}

export default function SocialCalendarPage() {
  const { status } = useSession()
  const router = useRouter()

  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [posts, setPosts] = useState<Record<string, Post[]>>({})
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const fetchCalendar = useCallback(async (y: number, m: number) => {
    try {
      setLoading(true)
      setError('')
      const token = localStorage.getItem('token')
      const { data } = await axios.get(`${API_URL}/social/calendar`, {
        params: { month: toMonthStr(y, m) },
        headers: { Authorization: `Bearer ${token}` },
      })
      setPosts(data.posts ?? {})
    } catch (err: unknown) {
      console.error('Failed to load calendar', err)
      setError('Failed to load calendar data')
      setPosts({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }
    if (status === 'authenticated') {
      fetchCalendar(year, month)
    }
  }, [status, year, month, router, fetchCalendar])

  const handlePrev = () => {
    if (month === 0) {
      setMonth(11)
      setYear(y => y - 1)
    } else {
      setMonth(m => m - 1)
    }
  }

  const handleNext = () => {
    if (month === 11) {
      setMonth(0)
      setYear(y => y + 1)
    } else {
      setMonth(m => m + 1)
    }
  }

  const handleGenerateWeek = async () => {
    try {
      setGenerating(true)
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/social/posts/generate-batch`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      })
      await fetchCalendar(year, month)
    } catch (err: unknown) {
      console.error('Failed to generate posts', err)
      setError('Failed to generate posts')
    } finally {
      setGenerating(false)
    }
  }

  const handleChipClick = (postId: string) => {
    router.push(`/dashboard/social/posts?highlight=${postId}`)
  }

  const handleDayClick = (d: Date, dayPosts: Post[]) => {
    if (dayPosts.length === 0) {
      router.push(`/dashboard/social/posts?create=true&date=${dateKey(d)}`)
    }
  }

  const calendarDays = getCalendarDays(year, month)
  const totalPostCount = Object.values(posts).reduce((sum, arr) => sum + arr.length, 0)

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Content Calendar</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Plan and schedule your social media content
          </p>
        </div>
        <button
          onClick={handleGenerateWeek}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generating ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
              Generate Week
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Month Navigation */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={handlePrev}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
          aria-label="Previous month"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white min-w-[180px] text-center">
          {MONTH_NAMES[month]} {year}
        </h2>
        <button
          onClick={handleNext}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
          aria-label="Next month"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : totalPostCount === 0 && !error ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
            No posts scheduled this month
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-sm">
            Get started by generating AI-powered content for the upcoming week.
          </p>
          <button
            onClick={handleGenerateWeek}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            Generate Week
          </button>
        </div>
      ) : (
        <>
          {/* Desktop: Calendar Grid */}
          <div className="hidden md:block">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
              {/* Day-of-week header */}
              <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                {DAYS_OF_WEEK.map(day => (
                  <div key={day} className="py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar cells */}
              <div className="grid grid-cols-7">
                {calendarDays.map((cell, idx) => {
                  const key = dateKey(cell.date)
                  const dayPosts = posts[key] || []
                  const today = isToday(cell.date)

                  return (
                    <div
                      key={idx}
                      onClick={() => handleDayClick(cell.date, dayPosts)}
                      className={`
                        min-h-[100px] border-b border-r border-gray-100 dark:border-gray-800 p-1.5
                        ${!cell.inMonth ? 'bg-gray-50/50 dark:bg-gray-950/50' : 'bg-white dark:bg-gray-900'}
                        ${today ? 'ring-2 ring-inset ring-blue-500' : ''}
                        ${dayPosts.length === 0 ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : ''}
                        transition-colors
                      `}
                    >
                      <div className={`text-xs font-medium mb-1 ${
                        !cell.inMonth
                          ? 'text-gray-300 dark:text-gray-700'
                          : today
                            ? 'text-blue-600 dark:text-blue-400 font-bold'
                            : 'text-gray-700 dark:text-gray-300'
                      }`}>
                        {cell.date.getDate()}
                      </div>
                      <div className="space-y-0.5">
                        {dayPosts.slice(0, 3).map(post => (
                          <button
                            key={post.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleChipClick(post.id)
                            }}
                            className={`
                              w-full text-left rounded px-1.5 py-0.5 text-[10px] leading-tight truncate flex items-center gap-1
                              ${chipClasses(post)}
                              hover:opacity-80 transition-opacity cursor-pointer
                            `}
                            title={`${post.platform} - ${post.status}: ${post.content}`}
                          >
                            <span className="font-bold flex-shrink-0">{platformInitial(post.platform)}</span>
                            <span className="truncate">{truncate(post.content, 20)}</span>
                            {post.status === 'PUBLISHED' && (
                              <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            )}
                          </button>
                        ))}
                        {dayPosts.length > 3 && (
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 pl-1">
                            +{dayPosts.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Mobile: List View */}
          <div className="md:hidden space-y-2">
            {calendarDays
              .filter(cell => cell.inMonth && (posts[dateKey(cell.date)] || []).length > 0)
              .map((cell, idx) => {
                const key = dateKey(cell.date)
                const dayPosts = posts[key] || []
                const today = isToday(cell.date)

                return (
                  <div
                    key={idx}
                    className={`rounded-lg border p-3 ${
                      today
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                    }`}
                  >
                    <div className={`text-sm font-medium mb-2 ${
                      today ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                    }`}>
                      {cell.date.toLocaleDateString('en-AU', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </div>
                    <div className="space-y-1">
                      {dayPosts.map(post => (
                        <button
                          key={post.id}
                          onClick={() => handleChipClick(post.id)}
                          className={`
                            w-full text-left rounded-md px-2 py-1.5 text-xs flex items-center gap-2
                            ${chipClasses(post)}
                            hover:opacity-80 transition-opacity
                          `}
                        >
                          <span className="font-bold flex-shrink-0">{platformInitial(post.platform)}</span>
                          <span className="truncate">{truncate(post.content, 40)}</span>
                          {post.status === 'PUBLISHED' && (
                            <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            {calendarDays.filter(c => c.inMonth && (posts[dateKey(c.date)] || []).length > 0).length === 0 && (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
                No posts scheduled this month
              </p>
            )}
          </div>
        </>
      )}

      {/* Legend */}
      {totalPostCount > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400 pt-2">
          <span className="font-medium">Platform:</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500" /> Facebook</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-pink-500" /> Instagram</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-600" /> LinkedIn</span>
          <span className="mx-2 border-l border-gray-300 dark:border-gray-600 h-4" />
          <span className="font-medium">Status:</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border border-dashed border-gray-400" /> Draft</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-400" /> Scheduled</span>
          <span className="inline-flex items-center gap-1">
            <svg className="h-3 w-3 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Published
          </span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> Failed</span>
        </div>
      )}
    </div>
  )
}
