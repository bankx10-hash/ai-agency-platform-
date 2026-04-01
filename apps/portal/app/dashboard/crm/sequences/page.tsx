'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface Step {
  subject: string
  body: string
  delayDays: number
}

interface Sequence {
  id: string
  name: string
  description?: string
  steps: Step[]
  isActive: boolean
  activeEnrollments: number
  createdAt: string
}

const EMPTY_STEP: Step = { subject: '', body: '', delayDays: 0 }

export default function SequencesPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [steps, setSteps] = useState<Step[]>([{ ...EMPTY_STEP }])

  useEffect(() => { if (status === 'unauthenticated') router.push('/login') }, [status, router])

  const fetchSequences = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/sequences`, { headers: { Authorization: `Bearer ${token}` } })
      setSequences(res.data.sequences)
    } catch (err) {
      console.error('Failed to fetch sequences:', err)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetchSequences() }, [fetchSequences])

  async function createSequence() {
    if (!form.name.trim() || steps.some(s => !s.subject.trim() || !s.body.trim())) return
    setSaving(true)
    try {
      const token = localStorage.getItem('token') || ''
      await axios.post(`${API_URL}/sequences`, { ...form, steps }, { headers: { Authorization: `Bearer ${token}` } })
      setShowCreate(false)
      setForm({ name: '', description: '' })
      setSteps([{ ...EMPTY_STEP }])
      fetchSequences()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    const token = localStorage.getItem('token') || ''
    await axios.patch(`${API_URL}/sequences/${id}`, { isActive: !isActive }, { headers: { Authorization: `Bearer ${token}` } })
    fetchSequences()
  }

  async function deleteSequence(id: string) {
    if (!confirm('Delete this sequence? All active enrollments will be cancelled.')) return
    const token = localStorage.getItem('token') || ''
    await axios.delete(`${API_URL}/sequences/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    fetchSequences()
  }

  function updateStep(index: number, field: keyof Step, value: string | number) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  function addStep() {
    setSteps(prev => [...prev, { subject: '', body: '', delayDays: 3 }])
  }

  function removeStep(index: number) {
    if (steps.length === 1) return
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sequences</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Automated email follow-up sequences</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Sequence
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sequences.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="text-4xl mb-3">📧</div>
          <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">No sequences yet</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">Create a sequence to automate follow-up emails to your leads</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sequences.map(seq => (
            <div key={seq.id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{seq.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${seq.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                      {seq.isActive ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  {seq.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{seq.description}</p>}
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
                    <span>{seq.steps.length} step{seq.steps.length !== 1 ? 's' : ''}</span>
                    <span>{seq.activeEnrollments} active enrollment{seq.activeEnrollments !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {seq.steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="w-5 h-5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center font-medium text-xs flex-shrink-0">{i + 1}</span>
                        <span className="truncate">{step.subject}</span>
                        <span className="flex-shrink-0 text-gray-400">· {i === 0 ? (step.delayDays === 0 ? 'immediately' : `after ${step.delayDays}d`) : `+${step.delayDays}d`}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleActive(seq.id, seq.isActive)}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    {seq.isActive ? 'Pause' : 'Activate'}
                  </button>
                  <button
                    onClick={() => deleteSequence(seq.id)}
                    className="px-3 py-1.5 text-xs border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Sequence Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="font-semibold text-gray-900 dark:text-white">New Sequence</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Sequence Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. New Lead Follow-up"
                    value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    placeholder="What this sequence is for"
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Steps</label>
                  <p className="text-xs text-gray-400">Use {'{name}'}, {'{email}'}, {'{businessName}'} as merge tags</p>
                </div>
                <div className="space-y-4">
                  {steps.map((step, i) => (
                    <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Step {i + 1}</span>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <label className="text-xs text-gray-400">{i === 0 ? 'Send after (days from enroll)' : 'Send after (days from prev step)'}</label>
                            <input
                              type="number"
                              min={0}
                              value={step.delayDays}
                              onChange={e => updateStep(i, 'delayDays', parseInt(e.target.value) || 0)}
                              className="w-14 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-center focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <span className="text-xs text-gray-400">days</span>
                          </div>
                          {steps.length > 1 && (
                            <button onClick={() => removeStep(i)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Subject line"
                          value={step.subject}
                          onChange={e => updateStep(i, 'subject', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <textarea
                          placeholder="Email body..."
                          value={step.body}
                          onChange={e => updateStep(i, 'body', e.target.value)}
                          rows={4}
                          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {steps.length < 6 && (
                  <button
                    onClick={addStep}
                    className="mt-3 w-full py-2 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
                  >
                    + Add Step
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
              <button
                onClick={createSequence}
                disabled={saving || !form.name.trim() || steps.some(s => !s.subject.trim() || !s.body.trim())}
                className="flex-1 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {saving ? 'Creating...' : 'Create Sequence'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
