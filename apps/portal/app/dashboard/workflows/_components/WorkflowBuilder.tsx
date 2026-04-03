'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', color: 'bg-green-500', icon: 'WA' },
  { id: 'facebook', label: 'Facebook Messenger', color: 'bg-blue-600', icon: 'FB' },
  { id: 'instagram', label: 'Instagram DMs', color: 'bg-pink-500', icon: 'IG' },
]

const QUESTION_TYPES = [
  { value: 'TEXT', label: 'Text (data capture)' },
  { value: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
  { value: 'OPEN_ENDED', label: 'Open-Ended (AI scored)' },
  { value: 'YES_NO', label: 'Yes / No' },
]

const CRM_FIELDS = [
  { value: '', label: 'None' },
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'company', label: 'Company' },
  { value: 'jobTitle', label: 'Job Title' },
  { value: 'budget', label: 'Budget' },
]

interface QuestionOption {
  label: string
  value: string
  score: number
}

interface Question {
  id?: string
  questionText: string
  questionType: string
  options: QuestionOption[]
  scoreWeight: number
  crmField: string
  isRequired: boolean
}

const TRIGGER_TYPES = [
  { id: 'dm', label: 'Direct Messages', desc: 'Start when someone sends a DM' },
  { id: 'comment', label: 'Post Comments', desc: 'Start when someone comments on a post' },
  { id: 'story_reply', label: 'Story Replies', desc: 'Start when someone replies to a story' },
  { id: 'story_mention', label: 'Story Mentions', desc: 'Start when someone mentions you in their story' },
]

interface WorkflowData {
  name: string
  description: string
  channels: string[]
  qualifyThreshold: number
  welcomeMessage: string
  completionMessage: string
  disqualifyMessage: string
  triggerKeywords: string[]
  triggerOn: string[]
  commentReplyText: string
  questions: Question[]
}

export default function WorkflowBuilder({ workflowId }: { workflowId?: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<'settings' | 'questions' | 'preview'>('settings')
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [workflowStatus, setWorkflowStatus] = useState('DRAFT')

  const [data, setData] = useState<WorkflowData>({
    name: '',
    description: '',
    channels: [],
    qualifyThreshold: 70,
    welcomeMessage: '',
    completionMessage: "Thank you! We'll be in touch shortly.",
    disqualifyMessage: 'Thank you for your time!',
    triggerKeywords: [],
    triggerOn: ['dm'],
    commentReplyText: '',
    questions: []
  })

  const [keywordInput, setKeywordInput] = useState('')

  const fetchWorkflow = useCallback(async () => {
    if (!workflowId) return
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.get(`${API_URL}/workflows/${workflowId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const w = res.data
      setData({
        name: w.name || '',
        description: w.description || '',
        channels: w.channels || [],
        qualifyThreshold: w.qualifyThreshold || 70,
        welcomeMessage: w.welcomeMessage || '',
        completionMessage: w.completionMessage || "Thank you! We'll be in touch shortly.",
        disqualifyMessage: w.disqualifyMessage || 'Thank you for your time!',
        triggerKeywords: w.triggerKeywords || [],
        triggerOn: w.triggerOn || ['dm'],
        commentReplyText: w.commentReplyText || '',
        questions: (w.questions || []).map((q: Record<string, unknown>) => ({
          id: q.id,
          questionText: q.questionText || '',
          questionType: q.questionType || 'TEXT',
          options: (q.options as QuestionOption[]) || [],
          scoreWeight: (q.scoreWeight as number) || 0,
          crmField: (q.crmField as string) || '',
          isRequired: q.isRequired !== false,
        }))
      })
      setWorkflowStatus(w.status)
    } catch {
      setError('Failed to load workflow')
    }
  }, [workflowId])

  useEffect(() => { fetchWorkflow() }, [fetchWorkflow])

  const handleSave = async () => {
    if (!data.name.trim()) { setError('Name is required'); return }
    if (data.channels.length === 0) { setError('Select at least one channel'); return }

    setSaving(true)
    setError('')
    try {
      const token = localStorage.getItem('token') || ''
      const headers = { Authorization: `Bearer ${token}` }

      if (workflowId) {
        await axios.put(`${API_URL}/workflows/${workflowId}`, {
          name: data.name, description: data.description, channels: data.channels,
          qualifyThreshold: data.qualifyThreshold, welcomeMessage: data.welcomeMessage,
          completionMessage: data.completionMessage, disqualifyMessage: data.disqualifyMessage,
          triggerKeywords: data.triggerKeywords, triggerOn: data.triggerOn,
          commentReplyText: data.commentReplyText
        }, { headers })

        // Save questions individually
        for (const q of data.questions) {
          const payload = {
            questionText: q.questionText, questionType: q.questionType,
            options: q.options.length > 0 ? q.options : null,
            scoreWeight: q.scoreWeight, crmField: q.crmField || null,
            isRequired: q.isRequired
          }
          if (q.id) {
            await axios.put(`${API_URL}/workflows/${workflowId}/questions/${q.id}`, payload, { headers })
          } else {
            const res = await axios.post(`${API_URL}/workflows/${workflowId}/questions`, payload, { headers })
            q.id = res.data.id
          }
        }

        // Reorder
        if (data.questions.length > 0) {
          await axios.post(`${API_URL}/workflows/${workflowId}/questions/reorder`, {
            questionIds: data.questions.filter(q => q.id).map(q => q.id)
          }, { headers })
        }

        setSuccess('Workflow saved')
      } else {
        const res = await axios.post(`${API_URL}/workflows`, {
          ...data,
          triggerKeywords: data.triggerKeywords,
          triggerOn: data.triggerOn,
          commentReplyText: data.commentReplyText,
          questions: data.questions.map(q => ({
            questionText: q.questionText, questionType: q.questionType,
            options: q.options.length > 0 ? q.options : null,
            scoreWeight: q.scoreWeight, crmField: q.crmField || null,
            isRequired: q.isRequired
          }))
        }, { headers })
        router.push(`/dashboard/workflows/${res.data.id}`)
        return
      }
    } catch (err) {
      setError('Failed to save workflow')
    } finally {
      setSaving(false)
      setTimeout(() => setSuccess(''), 3000)
    }
  }

  const handleActivate = async () => {
    if (!workflowId) return
    setActivating(true)
    setError('')
    try {
      const token = localStorage.getItem('token') || ''
      await axios.post(`${API_URL}/workflows/${workflowId}/activate`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setWorkflowStatus('ACTIVE')
      setSuccess('Workflow activated!')
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError('Failed to activate — ensure at least one question exists')
    } finally {
      setActivating(false)
    }
  }

  const handlePause = async () => {
    if (!workflowId) return
    try {
      const token = localStorage.getItem('token') || ''
      await axios.post(`${API_URL}/workflows/${workflowId}/pause`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setWorkflowStatus('PAUSED')
    } catch {
      setError('Failed to pause workflow')
    }
  }

  const toggleTrigger = (t: string) => {
    setData(d => ({
      ...d,
      triggerOn: d.triggerOn.includes(t) ? d.triggerOn.filter(x => x !== t) : [...d.triggerOn, t]
    }))
  }

  const toggleChannel = (ch: string) => {
    setData(d => ({
      ...d,
      channels: d.channels.includes(ch) ? d.channels.filter(c => c !== ch) : [...d.channels, ch]
    }))
  }

  const addQuestion = () => {
    setData(d => ({
      ...d,
      questions: [...d.questions, {
        questionText: '', questionType: 'TEXT', options: [],
        scoreWeight: 0, crmField: '', isRequired: true
      }]
    }))
  }

  const updateQuestion = (index: number, updates: Partial<Question>) => {
    setData(d => ({
      ...d,
      questions: d.questions.map((q, i) => i === index ? { ...q, ...updates } : q)
    }))
  }

  const removeQuestion = (index: number) => {
    setData(d => ({ ...d, questions: d.questions.filter((_, i) => i !== index) }))
  }

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= data.questions.length) return
    setData(d => {
      const qs = [...d.questions]
      ;[qs[index], qs[newIndex]] = [qs[newIndex], qs[index]]
      return { ...d, questions: qs }
    })
  }

  const addOption = (qIndex: number) => {
    updateQuestion(qIndex, {
      options: [...data.questions[qIndex].options, { label: '', value: '', score: 0 }]
    })
  }

  const updateOption = (qIndex: number, oIndex: number, updates: Partial<QuestionOption>) => {
    const opts = [...data.questions[qIndex].options]
    opts[oIndex] = { ...opts[oIndex], ...updates }
    updateQuestion(qIndex, { options: opts })
  }

  const removeOption = (qIndex: number, oIndex: number) => {
    updateQuestion(qIndex, {
      options: data.questions[qIndex].options.filter((_, i) => i !== oIndex)
    })
  }

  const addKeyword = () => {
    const kw = keywordInput.trim()
    if (kw && !data.triggerKeywords.includes(kw)) {
      setData(d => ({ ...d, triggerKeywords: [...d.triggerKeywords, kw] }))
      setKeywordInput('')
    }
  }

  const totalMaxScore = data.questions.reduce((sum, q) => {
    if (q.questionType === 'MULTIPLE_CHOICE') {
      const maxOpt = Math.max(0, ...q.options.map(o => o.score))
      return sum + maxOpt
    }
    return sum + q.scoreWeight
  }, 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button onClick={() => router.push('/dashboard/workflows')} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-1">
            &larr; Back to Workflows
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {workflowId ? data.name || 'Edit Workflow' : 'New Workflow'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {workflowId && workflowStatus === 'ACTIVE' && (
            <button onClick={handlePause} className="px-3 py-2 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 dark:text-amber-400 dark:bg-amber-900/30 rounded-lg transition-colors">
              Pause
            </button>
          )}
          {workflowId && workflowStatus !== 'ACTIVE' && data.questions.length > 0 && (
            <button onClick={handleActivate} disabled={activating} className="px-3 py-2 text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 dark:text-green-400 dark:bg-green-900/30 rounded-lg transition-colors disabled:opacity-50">
              {activating ? 'Activating...' : 'Activate'}
            </button>
          )}
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded-lg">{success}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
        {(['settings', 'questions', 'preview'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Settings Tab ────────────────────────────────────────────────────── */}
      {tab === 'settings' && (
        <div className="space-y-6 max-w-2xl">
          <div className="theme-card rounded-xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Workflow Name *</label>
              <input value={data.name} onChange={e => setData(d => ({ ...d, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea value={data.description} onChange={e => setData(d => ({ ...d, description: e.target.value }))} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Channels *</label>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map(ch => (
                  <button key={ch.id} onClick={() => toggleChannel(ch.id)}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      data.channels.includes(ch.id)
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                    }`}>
                    <span className={`${ch.color} text-white text-[9px] font-bold px-1.5 py-0.5 rounded`}>{ch.icon}</span>
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Trigger When *</label>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Choose what engagement types start this workflow. For comments/stories, the workflow auto-DMs the person to begin the conversation.</p>
              <div className="grid grid-cols-2 gap-2">
                {TRIGGER_TYPES.map(t => (
                  <button key={t.id} onClick={() => toggleTrigger(t.id)}
                    className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      data.triggerOn.includes(t.id)
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                    }`}>
                    <div className="font-medium">{t.label}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Comment auto-reply (shown when comment trigger is enabled) */}
            {data.triggerOn.includes('comment') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Comment Auto-Reply</label>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Optional public reply posted on the comment before sending the DM (e.g. &quot;Thanks! Check your DMs&quot;)</p>
                <input value={data.commentReplyText} onChange={e => setData(d => ({ ...d, commentReplyText: e.target.value }))}
                  placeholder="e.g. Thanks for your interest! Check your DMs 💬"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Qualification Threshold: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{data.qualifyThreshold}</span>
                {totalMaxScore > 0 && <span className="text-gray-400 font-normal"> / {totalMaxScore} max possible</span>}
              </label>
              <input type="range" min={0} max={Math.max(100, totalMaxScore)} value={data.qualifyThreshold}
                onChange={e => setData(d => ({ ...d, qualifyThreshold: Number(e.target.value) }))}
                className="w-full accent-indigo-600" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trigger Keywords</label>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">If set, workflow only starts when a message contains one of these words. Leave empty to start for every new DM.</p>
              <div className="flex gap-2 mb-2">
                <input value={keywordInput} onChange={e => setKeywordInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                  placeholder="e.g. interested, pricing, demo"
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                <button onClick={addKeyword} className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">Add</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.triggerKeywords.map((kw, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-md">
                    {kw}
                    <button onClick={() => setData(d => ({ ...d, triggerKeywords: d.triggerKeywords.filter((_, j) => j !== i) }))} className="text-gray-400 hover:text-red-500">&times;</button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="theme-card rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Messages</h3>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Welcome Message</label>
              <textarea value={data.welcomeMessage} onChange={e => setData(d => ({ ...d, welcomeMessage: e.target.value }))} rows={2} placeholder="Shown before the first question (optional)"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Qualified Message</label>
              <textarea value={data.completionMessage} onChange={e => setData(d => ({ ...d, completionMessage: e.target.value }))} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Disqualified Message</label>
              <textarea value={data.disqualifyMessage} onChange={e => setData(d => ({ ...d, disqualifyMessage: e.target.value }))} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
            </div>
          </div>
        </div>
      )}

      {/* ── Questions Tab ───────────────────────────────────────────────────── */}
      {tab === 'questions' && (
        <div className="space-y-4 max-w-3xl">
          {data.questions.map((q, qi) => (
            <div key={qi} className="theme-card rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 flex items-center justify-center bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-bold rounded-full">
                    {qi + 1}
                  </span>
                  <select value={q.questionType} onChange={e => updateQuestion(qi, { questionType: e.target.value, options: e.target.value === 'MULTIPLE_CHOICE' ? q.options : [] })}
                    className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs">
                    {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => moveQuestion(qi, -1)} disabled={qi === 0} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">&uarr;</button>
                  <button onClick={() => moveQuestion(qi, 1)} disabled={qi === data.questions.length - 1} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">&darr;</button>
                  <button onClick={() => removeQuestion(qi)} className="p-1 text-red-400 hover:text-red-600 ml-2">&times;</button>
                </div>
              </div>

              <textarea value={q.questionText} onChange={e => updateQuestion(qi, { questionText: e.target.value })}
                placeholder="Enter your question..." rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm mb-3" />

              {/* Multiple choice options */}
              {q.questionType === 'MULTIPLE_CHOICE' && (
                <div className="mb-3 space-y-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Options</label>
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input value={opt.label} onChange={e => updateOption(qi, oi, { label: e.target.value, value: e.target.value })}
                        placeholder="Option text" className="flex-1 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white" />
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-gray-400">Score:</span>
                        <input type="number" value={opt.score} onChange={e => updateOption(qi, oi, { score: Number(e.target.value) })}
                          className="w-14 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white text-center" />
                      </div>
                      <button onClick={() => removeOption(qi, oi)} className="text-red-400 hover:text-red-600 text-sm">&times;</button>
                    </div>
                  ))}
                  <button onClick={() => addOption(qi)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-medium">+ Add option</button>
                </div>
              )}

              {/* Score weight for non-MC types */}
              {q.questionType !== 'MULTIPLE_CHOICE' && q.questionType !== 'TEXT' && (
                <div className="mb-3">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Score Weight (max points for this question)</label>
                  <input type="number" value={q.scoreWeight} onChange={e => updateQuestion(qi, { scoreWeight: Number(e.target.value) })}
                    className="mt-1 w-24 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white" />
                </div>
              )}

              {/* CRM field mapping */}
              <div className="flex items-center gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Map to CRM field</label>
                  <select value={q.crmField} onChange={e => updateQuestion(qi, { crmField: e.target.value })}
                    className="mt-1 block px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300">
                    {CRM_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 mt-4 text-xs text-gray-500 dark:text-gray-400">
                  <input type="checkbox" checked={q.isRequired} onChange={e => updateQuestion(qi, { isRequired: e.target.checked })} className="rounded accent-indigo-600" />
                  Required
                </label>
              </div>
            </div>
          ))}

          <button onClick={addQuestion}
            className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
            + Add Question
          </button>

          {data.questions.length > 0 && (
            <div className="theme-card rounded-xl p-4 text-sm text-gray-600 dark:text-gray-400">
              <strong className="text-gray-900 dark:text-white">Score summary:</strong> Max possible score = <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{totalMaxScore}</span> | Threshold = <span className="font-mono font-bold text-green-600 dark:text-green-400">{data.qualifyThreshold}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Preview Tab ─────────────────────────────────────────────────────── */}
      {tab === 'preview' && (
        <div className="max-w-md mx-auto">
          <div className="theme-card rounded-2xl overflow-hidden">
            <div className="bg-indigo-600 px-4 py-3 text-white text-sm font-medium">
              Chat Preview
            </div>
            <div className="p-4 space-y-3 min-h-[400px] max-h-[600px] overflow-y-auto bg-gray-50 dark:bg-gray-900">
              {/* Welcome */}
              {data.welcomeMessage && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%] text-sm text-gray-900 dark:text-white shadow-sm">
                    {data.welcomeMessage}
                  </div>
                </div>
              )}

              {/* Questions */}
              {data.questions.map((q, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%] text-sm text-gray-900 dark:text-white shadow-sm">
                      {q.questionText || `Question ${i + 1}...`}
                    </div>
                  </div>

                  {/* Quick replies */}
                  {q.questionType === 'MULTIPLE_CHOICE' && q.options.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pl-2">
                      {q.options.map((opt, oi) => (
                        <span key={oi} className="px-3 py-1 border border-indigo-300 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 text-xs rounded-full">
                          {opt.label || `Option ${oi + 1}`}
                        </span>
                      ))}
                    </div>
                  )}
                  {q.questionType === 'YES_NO' && (
                    <div className="flex gap-1.5 pl-2">
                      <span className="px-3 py-1 border border-green-300 dark:border-green-600 text-green-600 dark:text-green-400 text-xs rounded-full">Yes</span>
                      <span className="px-3 py-1 border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 text-xs rounded-full">No</span>
                    </div>
                  )}

                  {/* Simulated user reply */}
                  <div className="flex justify-end">
                    <div className="bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-2 max-w-[80%] text-sm italic opacity-50">
                      {q.questionType === 'MULTIPLE_CHOICE' && q.options[0] ? q.options[0].label : q.questionType === 'YES_NO' ? 'Yes' : 'User reply...'}
                    </div>
                  </div>
                </div>
              ))}

              {/* Completion */}
              {data.questions.length > 0 && (
                <div className="flex justify-start">
                  <div className="bg-green-100 dark:bg-green-900/30 rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%] text-sm text-green-800 dark:text-green-300 shadow-sm">
                    {data.completionMessage}
                  </div>
                </div>
              )}

              {data.questions.length === 0 && (
                <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-12">
                  Add questions to see the preview
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
