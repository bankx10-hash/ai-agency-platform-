'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Task {
  id: string
  title: string
  dueAt?: string
  status: string
  priority?: string
  contact?: { id: string; name?: string; email?: string }
}

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  MEDIUM: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
  LOW: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
}

function isOverdue(dueAt?: string) {
  if (!dueAt) return false
  return new Date(dueAt) < new Date()
}

export default function TasksPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'DONE' | 'OVERDUE'>('PENDING')
  const [completing, setCompleting] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchTasks = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/crm/tasks?status=ALL`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setTasks(res.data.tasks)
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  async function completeTask(taskId: string) {
    setCompleting(taskId)
    try {
      const token = localStorage.getItem('token') || ''
      await axios.patch(`${API_URL}/crm/tasks/${taskId}`, { status: 'DONE' }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'DONE' } : t))
    } catch (err) {
      console.error('Failed to complete task:', err)
    } finally {
      setCompleting(null)
    }
  }

  const filtered = tasks.filter(t => {
    if (filter === 'PENDING') return t.status === 'PENDING' || t.status === 'IN_PROGRESS'
    if (filter === 'DONE') return t.status === 'DONE'
    if (filter === 'OVERDUE') return (t.status === 'PENDING' || t.status === 'IN_PROGRESS') && isOverdue(t.dueAt)
    return true
  })

  const overdueCount = tasks.filter(t => (t.status === 'PENDING' || t.status === 'IN_PROGRESS') && isOverdue(t.dueAt)).length
  const pendingCount = tasks.filter(t => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length
  const doneCount = tasks.filter(t => t.status === 'DONE').length

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tasks</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {pendingCount} pending · {overdueCount > 0 && <span className="text-red-500 font-medium">{overdueCount} overdue · </span>}{doneCount} done
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['PENDING', 'OVERDUE', 'ALL', 'DONE'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            } ${f === 'OVERDUE' && overdueCount > 0 && filter !== 'OVERDUE' ? 'border-red-300 dark:border-red-800 text-red-600 dark:text-red-400' : ''}`}
          >
            {f === 'PENDING' ? 'Active' : f === 'DONE' ? 'Completed' : f.charAt(0) + f.slice(1).toLowerCase()}
            {f === 'OVERDUE' && overdueCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5">{overdueCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-16 text-center">
          <svg className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {filter === 'DONE' ? 'No completed tasks yet' : filter === 'OVERDUE' ? 'No overdue tasks' : 'No tasks — add them from a contact page'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
          {filtered.map(task => {
            const overdue = isOverdue(task.dueAt) && task.status !== 'DONE'
            const done = task.status === 'DONE'
            return (
              <div key={task.id} className={`flex items-start gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors ${overdue ? 'bg-red-50/30 dark:bg-red-900/5' : ''}`}>
                {/* Checkbox */}
                <button
                  onClick={() => !done && completeTask(task.id)}
                  disabled={done || completing === task.id}
                  className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 transition-colors ${
                    done
                      ? 'bg-green-500 border-green-500 text-white'
                      : completing === task.id
                      ? 'border-gray-300 animate-pulse'
                      : 'border-gray-300 dark:border-gray-600 hover:border-indigo-500 cursor-pointer'
                  }`}
                >
                  {done && (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${done ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                    {task.title}
                  </p>
                  {task.contact && (
                    <button
                      onClick={() => router.push(`/dashboard/crm/contacts/${task.contact!.id}`)}
                      className="text-xs text-indigo-500 dark:text-indigo-400 hover:underline mt-0.5 text-left"
                    >
                      {task.contact.name || task.contact.email || 'View contact'}
                    </button>
                  )}
                </div>

                {/* Meta */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  {task.priority && PRIORITY_COLORS[task.priority] && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority]}`}>
                      {task.priority}
                    </span>
                  )}
                  {task.dueAt && (
                    <span className={`text-xs ${overdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                      {overdue && !done ? 'Overdue · ' : ''}
                      {new Date(task.dueAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
