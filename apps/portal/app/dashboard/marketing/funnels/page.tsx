'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  ARCHIVED: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
}

const STEP_TYPE_ICONS: Record<string, string> = {
  LANDING: '🏠',
  OPT_IN: '📋',
  UPSELL: '💰',
  THANK_YOU: '🎉',
  SALES_PAGE: '🛒',
  WEBINAR: '🎥',
  CHECKOUT: '💳',
}

interface Funnel {
  id: string
  name: string
  description?: string
  status: string
  createdAt: string
  _count?: { steps: number; submissions: number }
  steps: { id: string; name: string; type: string; order: number }[]
}

export default function FunnelsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchFunnels = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/marketing/funnels`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setFunnels(res.data.funnels)
    } catch {
      console.error('Failed to fetch funnels')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetchFunnels() }, [fetchFunnels])

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funnels</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{funnels.length} funnels</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/marketing/funnels/new')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Funnel
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : funnels.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-16 text-center">
          <div className="text-5xl mb-4">🔻</div>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">No funnels yet — build your first lead capture or sales funnel</p>
          <button
            onClick={() => router.push('/dashboard/marketing/funnels/new')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
          >
            Build Funnel
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {funnels.map(funnel => (
            <div
              key={funnel.id}
              onClick={() => router.push(`/dashboard/marketing/funnels/${funnel.id}`)}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 cursor-pointer hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">{funnel.name}</h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-2 flex-shrink-0 ${STATUS_COLORS[funnel.status]}`}>
                  {funnel.status}
                </span>
              </div>

              {funnel.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{funnel.description}</p>
              )}

              {/* Step flow */}
              {funnel.steps.length > 0 && (
                <div className="flex items-center gap-1 mb-4 flex-wrap">
                  {funnel.steps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-1">
                      <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-800 rounded-lg px-2 py-1">
                        <span className="text-xs">{STEP_TYPE_ICONS[step.type] || '📄'}</span>
                        <span className="text-xs text-gray-600 dark:text-gray-300">{step.name}</span>
                      </div>
                      {i < funnel.steps.length - 1 && (
                        <svg className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{funnel._count?.steps || funnel.steps.length} steps</span>
                <span>{funnel._count?.submissions ?? 0} submissions</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
