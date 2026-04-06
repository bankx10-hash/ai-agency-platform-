'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Notification {
  id: string
  type: string
  title: string
  body?: string
  link?: string
  isRead: boolean
  createdAt: string
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const TYPE_ICON: Record<string, string> = {
  NEW_LEAD: '👤',
  STAGE_CHANGE: '📊',
  TASK_DUE: '✅',
  EMAIL_RECEIVED: '✉️',
  AGENT_ERROR: '⚠️',
}

export default function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const token = () => localStorage.getItem('token') || ''

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/notifications`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      setNotifications(res.data.notifications || [])
      setUnreadCount(res.data.unreadCount || 0)
    } catch { /* silent — bell is non-critical */ }
  }, [])

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  async function markAllRead() {
    try {
      await axios.patch(`${API_URL}/notifications/read-all`, {}, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch { /* silent */ }
  }

  async function handleNotificationClick(n: Notification) {
    if (!n.isRead) {
      try {
        await axios.patch(`${API_URL}/notifications/${n.id}/read`, {}, {
          headers: { Authorization: `Bearer ${token()}` }
        })
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
        setUnreadCount(prev => Math.max(0, prev - 1))
      } catch { /* silent */ }
    }
    if (n.link) {
      setOpen(false)
      router.push(n.link)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="relative p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-start gap-3 ${
                    !n.isRead ? 'bg-indigo-50/40 dark:bg-indigo-900/10' : ''
                  }`}
                >
                  <span className="text-base flex-shrink-0 mt-0.5">{TYPE_ICON[n.type] || '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${
                      !n.isRead
                        ? 'font-semibold text-gray-900 dark:text-white'
                        : 'font-medium text-gray-700 dark:text-gray-300'
                    }`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{n.body}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.isRead && (
                    <div className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0 mt-2" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
