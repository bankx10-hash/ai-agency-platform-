'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

// Sales pipeline (Starter, Growth, Agency)
const SALES_STAGES = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST']

// Service pipeline (AI Receptionist)
const SERVICE_STAGES = ['NEW_INQUIRY', 'APPOINTMENT_BOOKED', 'APPOINTMENT_COMPLETED', 'FOLLOW_UP_DUE', 'RECURRING_CLIENT', 'NO_SHOW', 'INACTIVE']

const STAGE_LABELS: Record<string, string> = {
  // Sales
  NEW_LEAD: 'New Lead',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  CLOSED_WON: 'Closed Won',
  CLOSED_LOST: 'Closed Lost',
  // Service
  NEW_INQUIRY: 'New Inquiry',
  APPOINTMENT_BOOKED: 'Booked',
  APPOINTMENT_COMPLETED: 'Completed',
  FOLLOW_UP_DUE: 'Follow-Up Due',
  RECURRING_CLIENT: 'Recurring',
  NO_SHOW: 'No Show',
  INACTIVE: 'Inactive',
}
const STAGE_COLORS: Record<string, { header: string; bg: string; badge: string }> = {
  // Sales stages
  NEW_LEAD: {
    header: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    bg: 'bg-blue-50/50 dark:bg-blue-900/10',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  },
  CONTACTED: {
    header: 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800',
    bg: 'bg-cyan-50/50 dark:bg-cyan-900/10',
    badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400',
  },
  QUALIFIED: {
    header: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800',
    bg: 'bg-violet-50/50 dark:bg-violet-900/10',
    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400',
  },
  PROPOSAL: {
    header: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800',
    bg: 'bg-indigo-50/50 dark:bg-indigo-900/10',
    badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400',
  },
  CLOSED_WON: {
    header: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    bg: 'bg-green-50/50 dark:bg-green-900/10',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  },
  CLOSED_LOST: {
    header: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    bg: 'bg-red-50/50 dark:bg-red-900/10',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  },
  // Service stages
  NEW_INQUIRY: {
    header: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    bg: 'bg-blue-50/50 dark:bg-blue-900/10',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  },
  APPOINTMENT_BOOKED: {
    header: 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800',
    bg: 'bg-cyan-50/50 dark:bg-cyan-900/10',
    badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400',
  },
  APPOINTMENT_COMPLETED: {
    header: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    bg: 'bg-green-50/50 dark:bg-green-900/10',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  },
  FOLLOW_UP_DUE: {
    header: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
    bg: 'bg-amber-50/50 dark:bg-amber-900/10',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  },
  RECURRING_CLIENT: {
    header: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
    bg: 'bg-emerald-50/50 dark:bg-emerald-900/10',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  },
  NO_SHOW: {
    header: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    bg: 'bg-red-50/50 dark:bg-red-900/10',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  },
  INACTIVE: {
    header: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700',
    bg: 'bg-gray-50/50 dark:bg-gray-800/30',
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  },
}

interface Contact {
  id: string
  name?: string
  email?: string
  phone?: string
  score?: number
  pipelineStage: string
  dealValue?: number
  dealCurrency?: string
  source?: string
  activities?: { createdAt: string; title: string }[]
}

export default function PipelinePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const dragContact = useRef<Contact | null>(null)
  const clientPlan = (session?.user as { plan?: string })?.plan || (typeof window !== 'undefined' ? localStorage.getItem('clientPlan') : '') || ''
  const STAGES = clientPlan === 'AI_RECEPTIONIST' ? SERVICE_STAGES : SALES_STAGES

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchContacts = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/crm/contacts?limit=500`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setContacts(res.data.contacts)
    } catch (err) {
      console.error('Failed to fetch contacts:', err)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  async function moveContact(contactId: string, newStage: string) {
    const token = localStorage.getItem('token') || ''
    // Optimistic update
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, pipelineStage: newStage } : c))
    try {
      await axios.patch(`${API_URL}/crm/pipeline/${contactId}/stage`, { stage: newStage }, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (err) {
      console.error('Failed to move contact:', err)
      fetchContacts() // revert on error
    }
  }

  function onDragStart(contact: Contact) {
    dragContact.current = contact
    setDragging(contact.id)
  }

  function onDragEnd() {
    setDragging(null)
    setDragOver(null)
    dragContact.current = null
  }

  function onDragOver(e: React.DragEvent, stage: string) {
    e.preventDefault()
    setDragOver(stage)
  }

  function onDrop(e: React.DragEvent, stage: string) {
    e.preventDefault()
    if (dragContact.current && dragContact.current.pipelineStage !== stage) {
      moveContact(dragContact.current.id, stage)
    }
    setDragOver(null)
  }

  const grouped: Record<string, Contact[]> = {}
  for (const stage of STAGES) grouped[stage] = []
  for (const c of contacts) {
    if (grouped[c.pipelineStage]) grouped[c.pipelineStage].push(c)
  }

  const totalValue = contacts
    .filter(c => c.pipelineStage !== 'CLOSED_LOST' && c.dealValue)
    .reduce((sum, c) => sum + Number(c.dealValue || 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pipeline</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {contacts.length} contacts · Pipeline value: ${totalValue.toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/crm/contacts')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Contact
        </button>
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-max">
          {STAGES.map(stage => {
            const cols = STAGE_COLORS[stage]
            const stageContacts = grouped[stage]
            const stageValue = stageContacts.reduce((sum, c) => sum + Number(c.dealValue || 0), 0)
            const isDragTarget = dragOver === stage

            return (
              <div
                key={stage}
                className={`w-64 flex flex-col rounded-xl border transition-all ${isDragTarget ? 'ring-2 ring-indigo-400 scale-[1.01]' : 'border-gray-200 dark:border-gray-800'}`}
                onDragOver={e => onDragOver(e, stage)}
                onDrop={e => onDrop(e, stage)}
              >
                {/* Column header */}
                <div className={`px-3 py-2.5 rounded-t-xl border-b ${cols.header}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cols.badge}`}>
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {stageContacts.length}
                    </span>
                  </div>
                  {stageValue > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      ${stageValue.toLocaleString()}
                    </p>
                  )}
                </div>

                {/* Cards */}
                <div className={`flex-1 p-2 space-y-2 min-h-[200px] rounded-b-xl ${cols.bg}`}>
                  {stageContacts.map(contact => (
                    <div
                      key={contact.id}
                      draggable
                      onDragStart={() => onDragStart(contact)}
                      onDragEnd={onDragEnd}
                      onClick={() => router.push(`/dashboard/crm/contacts/${contact.id}`)}
                      className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 cursor-pointer hover:shadow-md transition-all select-none ${
                        dragging === contact.id ? 'opacity-40 rotate-1' : ''
                      }`}
                    >
                      {/* Avatar + name */}
                      <div className="flex items-start gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-700 dark:text-indigo-400 text-xs font-bold flex-shrink-0">
                          {(contact.name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                            {contact.name || 'Unknown'}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {contact.email || contact.phone || '—'}
                          </p>
                        </div>
                      </div>

                      {/* Deal value */}
                      {contact.dealValue && (
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-2">
                          ${Number(contact.dealValue).toLocaleString()}
                        </p>
                      )}

                      {/* Score + source */}
                      <div className="flex items-center justify-between mt-2">
                        {contact.score != null ? (
                          <span className={`text-xs font-medium ${
                            contact.score >= 70 ? 'text-green-600 dark:text-green-400' :
                            contact.score >= 40 ? 'text-amber-600 dark:text-amber-400' :
                            'text-gray-400'
                          }`}>
                            Score {contact.score}
                          </span>
                        ) : <span />}
                        {contact.source && (
                          <span className="text-xs text-gray-400 capitalize truncate ml-1">
                            {contact.source}
                          </span>
                        )}
                      </div>

                      {/* Last activity */}
                      {contact.activities?.[0] && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 truncate">
                          {new Date(contact.activities[0].createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                          {' · '}{contact.activities[0].title}
                        </p>
                      )}
                    </div>
                  ))}

                  {stageContacts.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-xs text-gray-400 dark:text-gray-600 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                      Drop here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
