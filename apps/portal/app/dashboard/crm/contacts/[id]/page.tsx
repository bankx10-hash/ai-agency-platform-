'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const STAGES = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST']
const STAGE_COLORS: Record<string, string> = {
  NEW_LEAD: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  CONTACTED: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  QUALIFIED: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  PROPOSAL: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  CLOSED_WON: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  CLOSED_LOST: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const ACTIVITY_ICONS: Record<string, string> = {
  NOTE: '📝', CALL: '📞', EMAIL: '✉️', SMS: '💬',
  APPOINTMENT: '📅', STAGE_CHANGE: '➡️', SCORE_CHANGE: '📊',
  TASK_COMPLETED: '✅', AGENT_ACTION: '🤖'
}

interface Contact {
  id: string; name?: string; email?: string; phone?: string; source?: string
  score?: number; pipelineStage: string; dealValue?: number; dealCurrency?: string
  summary?: string; nextAction?: string; tags?: string[]; lastContactedAt?: string
  createdAt: string; updatedAt: string
  activities: Activity[]; notes: Note[]; tasks: Task[]; deals: Deal[]
}
interface Activity { id: string; type: string; title: string; body?: string; agentType?: string; createdAt: string }
interface Note { id: string; body: string; authorType: string; createdAt: string }
interface Task { id: string; title: string; body?: string; status: string; dueAt?: string }
interface Deal { id: string; title: string; value?: number; currency: string; stage: string; probability?: number }

export default function ContactDetailPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const contactId = params.id as string
  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'timeline' | 'tasks' | 'deals'>('timeline')
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', dueAt: '' })
  const [savingTask, setSavingTask] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Partial<Contact>>({})

  // Quick action modals
  const [emailModal, setEmailModal] = useState(false)
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' })
  const [sendingEmail, setSendingEmail] = useState(false)

  const [callModal, setCallModal] = useState(false)
  const [callNotes, setCallNotes] = useState('')
  const [loggingCall, setLoggingCall] = useState(false)

  const [taskModal, setTaskModal] = useState(false)
  const [quickTask, setQuickTask] = useState({ title: '', dueAt: '' })
  const [savingQuickTask, setSavingQuickTask] = useState(false)

  const [enrollModal, setEnrollModal] = useState(false)
  const [sequences, setSequences] = useState<{ id: string; name: string; steps: unknown[] }[]>([])
  const [enrolling, setEnrolling] = useState<string | null>(null)
  const [enrollSuccess, setEnrollSuccess] = useState('')

  useEffect(() => { if (status === 'unauthenticated') router.push('/login') }, [status, router])

  const fetchContact = useCallback(async () => {
    if (status !== 'authenticated') return
    setLoading(true)
    const token = localStorage.getItem('token') || ''
    try {
      const res = await axios.get(`${API_URL}/crm/contacts/${contactId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setContact(res.data.contact)
      setEditData(res.data.contact)
    } catch (err) {
      const msg = axios.isAxiosError(err) ? `API error ${err.response?.status}: ${JSON.stringify(err.response?.data)}` : String(err)
      setError(msg)
    } finally { setLoading(false) }
  }, [status, contactId])

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchContact()
  }, [status, fetchContact])

  async function saveNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    const token = localStorage.getItem('token') || ''
    try {
      await axios.post(`${API_URL}/crm/contacts/${contactId}/notes`, { body: noteText, authorType: 'human' }, { headers: { Authorization: `Bearer ${token}` } })
      setNoteText('')
      fetchContact()
    } finally { setSavingNote(false) }
  }

  async function saveTask() {
    if (!newTask.title.trim()) return
    setSavingTask(true)
    const token = localStorage.getItem('token') || ''
    try {
      await axios.post(`${API_URL}/crm/contacts/${contactId}/tasks`, newTask, { headers: { Authorization: `Bearer ${token}` } })
      setNewTask({ title: '', dueAt: '' })
      fetchContact()
    } finally { setSavingTask(false) }
  }

  async function completeTask(taskId: string) {
    const token = localStorage.getItem('token') || ''
    await axios.patch(`${API_URL}/crm/tasks/${taskId}`, { status: 'DONE' }, { headers: { Authorization: `Bearer ${token}` } })
    fetchContact()
  }

  async function updateStage(stage: string) {
    const token = localStorage.getItem('token') || ''
    await axios.patch(`${API_URL}/crm/pipeline/${contactId}/stage`, { stage }, { headers: { Authorization: `Bearer ${token}` } })
    fetchContact()
  }

  async function saveEdit() {
    const token = localStorage.getItem('token') || ''
    await axios.patch(`${API_URL}/crm/contacts/${contactId}`, editData, { headers: { Authorization: `Bearer ${token}` } })
    setEditing(false)
    fetchContact()
  }

  async function sendEmail() {
    if (!emailForm.to || !emailForm.subject || !emailForm.body) return
    setSendingEmail(true)
    const token = localStorage.getItem('token') || ''
    try {
      await axios.post(`${API_URL}/inbox/compose`, emailForm, { headers: { Authorization: `Bearer ${token}` } })
      await axios.post(`${API_URL}/crm/contacts/${contactId}/activities`,
        { type: 'EMAIL', title: `Email sent: ${emailForm.subject}`, body: emailForm.body.slice(0, 120) },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setEmailModal(false)
      setEmailForm({ to: '', subject: '', body: '' })
      fetchContact()
    } finally { setSendingEmail(false) }
  }

  async function logCall() {
    setLoggingCall(true)
    const token = localStorage.getItem('token') || ''
    try {
      await axios.post(`${API_URL}/crm/contacts/${contactId}/activities`,
        { type: 'CALL', title: 'Call logged', body: callNotes || undefined },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setCallModal(false)
      setCallNotes('')
      fetchContact()
    } finally { setLoggingCall(false) }
  }

  async function saveQuickTask() {
    if (!quickTask.title.trim()) return
    setSavingQuickTask(true)
    const token = localStorage.getItem('token') || ''
    try {
      await axios.post(`${API_URL}/crm/contacts/${contactId}/tasks`, quickTask, { headers: { Authorization: `Bearer ${token}` } })
      setTaskModal(false)
      setQuickTask({ title: '', dueAt: '' })
      fetchContact()
    } finally { setSavingQuickTask(false) }
  }

  async function openEnrollModal() {
    const token = localStorage.getItem('token') || ''
    try {
      const res = await axios.get(`${API_URL}/sequences`, { headers: { Authorization: `Bearer ${token}` } })
      setSequences(res.data.sequences.filter((s: { isActive: boolean }) => s.isActive))
    } catch { setSequences([]) }
    setEnrollSuccess('')
    setEnrollModal(true)
  }

  async function enrollInSequence(sequenceId: string) {
    setEnrolling(sequenceId)
    const token = localStorage.getItem('token') || ''
    try {
      await axios.post(`${API_URL}/sequences/${sequenceId}/enroll`, { contactId }, { headers: { Authorization: `Bearer ${token}` } })
      setEnrollSuccess('Enrolled successfully!')
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to enroll'
      setEnrollSuccess(msg || 'Failed to enroll')
    } finally { setEnrolling(null) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
      <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">Failed to load contact</p>
      <p className="text-xs text-red-600 dark:text-red-400 font-mono">{error}</p>
      <button onClick={() => { setError(''); fetchContact() }} className="mt-3 text-xs text-indigo-600 hover:underline">Retry</button>
    </div>
  )

  if (!contact) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-6">
        <Link href="/dashboard/crm/contacts" className="hover:text-gray-700 dark:hover:text-gray-200">Contacts</Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-white font-medium">{contact.name || 'Unnamed'}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — contact info */}
        <div className="space-y-4">
          {/* Profile card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/40 rounded-full flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-lg">
                {(contact.name || '?').charAt(0).toUpperCase()}
              </div>
              <button onClick={() => setEditing(!editing)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                {editing ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {editing ? (
              <div className="space-y-3">
                {[
                  { key: 'name', label: 'Name', type: 'text' },
                  { key: 'email', label: 'Email', type: 'email' },
                  { key: 'phone', label: 'Phone', type: 'text' },
                  { key: 'source', label: 'Source', type: 'text' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-400 mb-0.5">{f.label}</label>
                    <input
                      type={f.type}
                      value={(editData[f.key as keyof Contact] as string) || ''}
                      onChange={e => setEditData(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Deal Value ($)</label>
                  <input
                    type="number"
                    value={(editData.dealValue as number) || ''}
                    onChange={e => setEditData(p => ({ ...p, dealValue: parseFloat(e.target.value) || undefined }))}
                    className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button onClick={saveEdit} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg">Save</button>
              </div>
            ) : (
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{contact.name || 'Unnamed'}</h2>
                {contact.email && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{contact.email}</p>}
                {contact.phone && <p className="text-sm text-gray-500 dark:text-gray-400">{contact.phone}</p>}
                {contact.source && <p className="text-xs text-gray-400 mt-2 capitalize">Source: {contact.source}</p>}
                {contact.dealValue && (
                  <p className="text-sm font-semibold text-green-600 dark:text-green-400 mt-2">
                    ${Number(contact.dealValue).toLocaleString()} {contact.dealCurrency || 'AUD'}
                  </p>
                )}
                {contact.score !== undefined && contact.score !== null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">Lead Score</span>
                      <span className={`text-sm font-bold ${contact.score >= 70 ? 'text-green-600' : contact.score >= 40 ? 'text-amber-600' : 'text-gray-500'}`}>{contact.score}</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${contact.score >= 70 ? 'bg-green-500' : contact.score >= 40 ? 'bg-amber-500' : 'bg-gray-400'}`} style={{ width: `${contact.score}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pipeline stage */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Pipeline Stage</p>
            <div className="space-y-1.5">
              {STAGES.map(stage => (
                <button
                  key={stage}
                  onClick={() => updateStage(stage)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contact.pipelineStage === stage
                      ? STAGE_COLORS[stage]
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {contact.pipelineStage === stage && <span className="mr-2">●</span>}
                  {stage.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          {(contact.summary || contact.nextAction) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
              {contact.summary && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">AI Summary</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{contact.summary}</p>
                </div>
              )}
              {contact.nextAction && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Next Action</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{contact.nextAction}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column — tabs */}
        <div className="lg:col-span-2 space-y-4">
          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setEmailForm({ to: contact.email || '', subject: '', body: '' }); setEmailModal(true) }}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span>✉️</span> Send Email
            </button>
            <button
              onClick={() => setCallModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span>📞</span> Log Call
            </button>
            <button
              onClick={() => setTaskModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span>✅</span> Add Task
            </button>
            <button
              onClick={openEnrollModal}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span>🔗</span> Enroll
            </button>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-gray-100 dark:border-gray-800">
              {(['timeline', 'tasks', 'deals'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {tab}
                  {tab === 'tasks' && contact.tasks.length > 0 && (
                    <span className="ml-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs px-1.5 py-0.5 rounded-full">{contact.tasks.length}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* Timeline tab */}
              {activeTab === 'timeline' && (
                <div>
                  {/* Note composer */}
                  <div className="mb-6">
                    <textarea
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      placeholder="Add a note..."
                      rows={3}
                      className="w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={saveNote}
                        disabled={savingNote || !noteText.trim()}
                        className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium"
                      >
                        {savingNote ? 'Saving...' : 'Add Note'}
                      </button>
                    </div>
                  </div>

                  {/* Activity + Notes list — merged and sorted by date */}
                  <div className="space-y-3">
                    {contact.activities.length === 0 && contact.notes.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
                    ) : (
                      [
                        ...contact.activities.map(a => ({ ...a, _kind: 'activity' as const })),
                        ...contact.notes.map(n => ({ ...n, _kind: 'note' as const, title: 'Note', type: 'NOTE', agentType: n.authorType === 'ai' ? 'AI' : undefined }))
                      ]
                        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        .map(item => (
                          item._kind === 'note' ? (
                            <div key={`note-${item.id}`} className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm">📝</span>
                                <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">Note</span>
                                {item.agentType && (
                                  <span className="text-xs bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded">AI</span>
                                )}
                                <span className="text-xs text-gray-400 ml-auto">
                                  {new Date(item.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{item.body}</p>
                            </div>
                          ) : (
                            <div key={`act-${item.id}`} className="flex gap-3">
                              <div className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center text-sm flex-shrink-0">
                                {ACTIVITY_ICONS[item.type] || '•'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">{item.title}</span>
                                  {item.agentType && (
                                    <span className="text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">AI</span>
                                  )}
                                </div>
                                {item.body && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{item.body}</p>}
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {new Date(item.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            </div>
                          )
                        ))
                    )}
                  </div>
                </div>
              )}

              {/* Tasks tab */}
              {activeTab === 'tasks' && (
                <div>
                  {/* Add task */}
                  <div className="flex gap-2 mb-6">
                    <input
                      type="text"
                      value={newTask.title}
                      onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
                      placeholder="Add a task..."
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                      type="date"
                      value={newTask.dueAt}
                      onChange={e => setNewTask(p => ({ ...p, dueAt: e.target.value }))}
                      className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button onClick={saveTask} disabled={savingTask || !newTask.title.trim()} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-lg">Add</button>
                  </div>

                  {contact.tasks.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No open tasks</p>
                  ) : (
                    <div className="space-y-2">
                      {contact.tasks.map(task => {
                        const overdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status === 'PENDING'
                        return (
                          <div key={task.id} className={`flex items-start gap-3 p-3 rounded-xl border ${overdue ? 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10' : 'border-gray-100 dark:border-gray-800'}`}>
                            <button onClick={() => completeTask(task.id)} className="mt-0.5 w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 hover:border-green-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{task.title}</p>
                              {task.dueAt && (
                                <p className={`text-xs mt-0.5 ${overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                                  Due {new Date(task.dueAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                                  {overdue && ' — OVERDUE'}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Deals tab */}
              {activeTab === 'deals' && (
                <div>
                  {contact.deals.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No deals yet</p>
                  ) : (
                    <div className="space-y-3">
                      {contact.deals.map(deal => (
                        <div key={deal.id} className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-900 dark:text-white text-sm">{deal.title}</span>
                            <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                              {deal.value ? `$${Number(deal.value).toLocaleString()} ${deal.currency}` : '—'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">
                              {deal.stage.replace(/_/g, ' ')}
                            </span>
                            {deal.probability !== null && deal.probability !== undefined && (
                              <span className="text-xs text-gray-400">{deal.probability}% probability</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Send Email Modal */}
      {emailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Send Email</h2>
              <button onClick={() => setEmailModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">To</label>
                <input type="email" value={emailForm.to} onChange={e => setEmailForm(p => ({ ...p, to: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Subject</label>
                <input type="text" value={emailForm.subject} onChange={e => setEmailForm(p => ({ ...p, subject: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Message</label>
                <textarea value={emailForm.body} onChange={e => setEmailForm(p => ({ ...p, body: e.target.value }))} rows={6}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setEmailModal(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
                <button onClick={sendEmail} disabled={sendingEmail || !emailForm.to || !emailForm.subject || !emailForm.body}
                  className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium">
                  {sendingEmail ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Log Call Modal */}
      {callModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Log Call with {contact.name || contact.email}</h2>
              <button onClick={() => setCallModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Call Notes (optional)</label>
                <textarea value={callNotes} onChange={e => setCallNotes(e.target.value)} rows={4}
                  placeholder="What was discussed..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setCallModal(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
                <button onClick={logCall} disabled={loggingCall}
                  className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium">
                  {loggingCall ? 'Logging...' : 'Log Call'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Task Modal */}
      {taskModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Add Task for {contact.name || contact.email}</h2>
              <button onClick={() => setTaskModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Task</label>
                <input type="text" value={quickTask.title} onChange={e => setQuickTask(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Follow up on proposal"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Due Date (optional)</label>
                <input type="date" value={quickTask.dueAt} onChange={e => setQuickTask(p => ({ ...p, dueAt: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setTaskModal(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
                <button onClick={saveQuickTask} disabled={savingQuickTask || !quickTask.title.trim()}
                  className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium">
                  {savingQuickTask ? 'Adding...' : 'Add Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Enroll in Sequence Modal */}
      {enrollModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Enroll in Sequence</h2>
              <button onClick={() => setEnrollModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              {enrollSuccess && (
                <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${enrollSuccess.includes('success') ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                  {enrollSuccess}
                </div>
              )}
              {sequences.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">No active sequences. Create one in the Sequences tab first.</p>
              ) : (
                <div className="space-y-2">
                  {sequences.map(seq => (
                    <div key={seq.id} className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-xl">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{seq.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{seq.steps.length} step{seq.steps.length !== 1 ? 's' : ''}</p>
                      </div>
                      <button
                        onClick={() => enrollInSequence(seq.id)}
                        disabled={!!enrolling}
                        className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                      >
                        {enrolling === seq.id ? 'Enrolling...' : 'Enroll'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
              <button onClick={() => setEnrollModal(false)} className="w-full px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
