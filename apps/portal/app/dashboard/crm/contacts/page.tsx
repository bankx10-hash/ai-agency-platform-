'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
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

interface Contact {
  id: string
  name?: string
  email?: string
  phone?: string
  source?: string
  score?: number
  pipelineStage: string
  dealValue?: number
  dealCurrency?: string
  createdAt: string
  updatedAt: string
  _count?: { activities: number; tasks: number }
  activities?: { createdAt: string; title: string }[]
}

export default function ContactsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', email: '', phone: '', source: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchContacts = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const clientId = (session.user as { clientId?: string })?.clientId
      const token = localStorage.getItem('token') || ''
      const params = new URLSearchParams({ limit: '100' })
      if (search) params.set('search', search)
      if (stageFilter) params.set('stage', stageFilter)
      const res = await axios.get(`${API_URL}/crm/contacts?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setContacts(res.data.contacts)
    } catch (err) {
      console.error('Failed to fetch contacts:', err)
    } finally {
      setLoading(false)
    }
  }, [session, search, stageFilter])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  async function addContact() {
    if (!session || !newContact.name) return
    setSaving(true)
    try {
      const token = localStorage.getItem('token') || ''
      await axios.post(`${API_URL}/crm/contacts`, newContact, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setNewContact({ name: '', email: '', phone: '', source: '' })
      setShowAdd(false)
      fetchContacts()
    } catch (err) {
      console.error('Failed to add contact:', err)
    } finally {
      setSaving(false)
    }
  }

  function scoreColor(score?: number) {
    if (!score) return 'text-gray-400'
    if (score >= 70) return 'text-green-600 dark:text-green-400'
    if (score >= 40) return 'text-amber-600 dark:text-amber-400'
    return 'text-gray-500 dark:text-gray-400'
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contacts</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{contacts.length} contacts</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Contact
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search name, email, phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {/* Add contact modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add Contact</h2>
            <div className="space-y-3">
              {[
                { key: 'name', label: 'Name', placeholder: 'Full name', required: true },
                { key: 'email', label: 'Email', placeholder: 'email@example.com' },
                { key: 'phone', label: 'Phone', placeholder: '+61 400 000 000' },
                { key: 'source', label: 'Source', placeholder: 'e.g. website, referral, ad' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{f.label}{f.required && ' *'}</label>
                  <input
                    type="text"
                    placeholder={f.placeholder}
                    value={newContact[f.key as keyof typeof newContact]}
                    onChange={e => setNewContact(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button onClick={addContact} disabled={saving || !newContact.name} className="flex-1 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium">
                {saving ? 'Saving...' : 'Add Contact'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 text-sm">No contacts yet — add one or wait for AI agents to bring leads in</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell">Source</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Stage</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden md:table-cell">Score</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden lg:table-cell">Last Activity</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden md:table-cell">Deal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {contacts.map(contact => (
                  <tr key={contact.id} onClick={() => router.push(`/dashboard/crm/contacts/${contact.id}`)} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900 dark:text-white text-sm">{contact.name || '—'}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{contact.email || contact.phone || '—'}</div>
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">{contact.source || '—'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[contact.pipelineStage] || 'bg-gray-100 text-gray-600'}`}>
                        {contact.pipelineStage.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className={`text-sm font-semibold ${scoreColor(contact.score)}`}>
                        {contact.score ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {contact.activities?.[0]
                          ? new Date(contact.activities[0].createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                          : '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {contact.dealValue ? `$${Number(contact.dealValue).toLocaleString()}` : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
