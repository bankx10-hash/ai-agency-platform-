'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const STEP_TYPES = [
  { value: 'LANDING', label: 'Landing Page', icon: '🏠', desc: 'First page visitors see' },
  { value: 'OPT_IN', label: 'Opt-In Form', icon: '📋', desc: 'Capture name, email, phone' },
  { value: 'SALES_PAGE', label: 'Sales Page', icon: '🛒', desc: 'Present your offer' },
  { value: 'UPSELL', label: 'Upsell', icon: '💰', desc: 'Offer an upgrade' },
  { value: 'CHECKOUT', label: 'Checkout', icon: '💳', desc: 'Payment page' },
  { value: 'WEBINAR', label: 'Webinar', icon: '🎥', desc: 'Webinar registration' },
  { value: 'THANK_YOU', label: 'Thank You', icon: '🎉', desc: 'Confirmation page' },
]

interface Step {
  name: string
  type: string
  headline: string
  subheadline: string
  body: string
  ctaText: string
}

const DEFAULT_TEMPLATES: Record<string, Partial<Step>> = {
  LANDING: { headline: 'Welcome!', subheadline: 'Discover how we can help you grow', ctaText: 'Get Started →' },
  OPT_IN: { headline: 'Get Your Free Guide', subheadline: 'Enter your details below', ctaText: 'Send Me The Guide' },
  SALES_PAGE: { headline: 'Introducing Our Solution', subheadline: 'Everything you need to succeed', ctaText: 'Buy Now' },
  UPSELL: { headline: 'Wait — Special Offer!', subheadline: 'Upgrade today and save 50%', ctaText: 'Yes, Upgrade Me!' },
  CHECKOUT: { headline: 'Complete Your Order', ctaText: 'Complete Purchase' },
  WEBINAR: { headline: 'Join Our Free Webinar', subheadline: 'Reserve your spot now', ctaText: 'Register For Free' },
  THANK_YOU: { headline: 'Thank You!', subheadline: 'Your submission was received. We\'ll be in touch soon.', ctaText: '' },
}

export default function NewFunnelPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<Step[]>([
    { name: 'Landing Page', type: 'LANDING', headline: 'Welcome!', subheadline: 'Discover how we can help you grow', body: '', ctaText: 'Get Started →' },
    { name: 'Opt-In Form', type: 'OPT_IN', headline: 'Get Your Free Guide', subheadline: 'Enter your details below', body: '', ctaText: 'Send Me The Guide' },
    { name: 'Thank You', type: 'THANK_YOU', headline: 'Thank You!', subheadline: "You're all set. We'll be in touch shortly.", body: '', ctaText: '' },
  ])
  const [selectedStep, setSelectedStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function addStep(type: string) {
    const typeInfo = STEP_TYPES.find(t => t.value === type)
    const defaults = DEFAULT_TEMPLATES[type] || {}
    setSteps(prev => [...prev, {
      name: typeInfo?.label || type,
      type,
      headline: defaults.headline || '',
      subheadline: defaults.subheadline || '',
      body: '',
      ctaText: defaults.ctaText || 'Continue →',
    }])
    setSelectedStep(steps.length)
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return
    setSteps(prev => prev.filter((_, i) => i !== index))
    setSelectedStep(Math.max(0, index - 1))
  }

  function updateStep(index: number, field: keyof Step, value: string) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  function moveStep(index: number, direction: 'up' | 'down') {
    const newSteps = [...steps]
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= newSteps.length) return;
    [newSteps[index], newSteps[target]] = [newSteps[target], newSteps[index]]
    setSteps(newSteps)
    setSelectedStep(target)
  }

  async function handleSave(activate = false) {
    if (!name) { setError('Funnel name is required'); return }
    if (steps.length === 0) { setError('Add at least one step'); return }
    setError('')
    setSaving(true)
    try {
      const token = localStorage.getItem('token') || ''
      const res = await axios.post(`${API_URL}/marketing/funnels`, {
        name, description, steps,
      }, { headers: { Authorization: `Bearer ${token}` } })

      const funnelId = res.data.funnel.id
      if (activate) {
        await axios.patch(`${API_URL}/marketing/funnels/${funnelId}`, { status: 'ACTIVE' }, {
          headers: { Authorization: `Bearer ${token}` }
        })
      }
      router.push(`/dashboard/marketing/funnels/${funnelId}`)
    } catch {
      setError('Failed to save funnel')
    } finally {
      setSaving(false)
    }
  }

  const step = steps[selectedStep]

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/dashboard/marketing/funnels')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Build Funnel</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Funnel info + step list */}
        <div className="space-y-4">
          {/* Funnel details */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Funnel Details</h2>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Free Guide Funnel"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Description</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What is this funnel for?"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Steps list */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Steps</h2>
            <div className="space-y-2">
              {steps.map((s, i) => {
                const typeInfo = STEP_TYPES.find(t => t.value === s.type)
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedStep(i)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                      selectedStep === i
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                        : 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="text-sm flex-shrink-0">{typeInfo?.icon || '📄'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                      <p className="text-xs text-gray-400">{typeInfo?.label}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={e => { e.stopPropagation(); moveStep(i, 'up') }} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <button onClick={e => { e.stopPropagation(); moveStep(i, 'down') }} disabled={i === steps.length - 1} className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      <button onClick={e => { e.stopPropagation(); removeStep(i) }} className="p-0.5 text-red-400 hover:text-red-600">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Add step */}
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Add Step</p>
              <div className="grid grid-cols-2 gap-1.5">
                {STEP_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => addStep(t.value)}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                  >
                    <span>{t.icon}</span>
                    <span className="truncate">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Step editor */}
        <div className="lg:col-span-2">
          {step && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">{STEP_TYPES.find(t => t.value === step.type)?.icon || '📄'}</span>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Step {selectedStep + 1}: {STEP_TYPES.find(t => t.value === step.type)?.label}
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Step Name</label>
                  <input type="text" value={step.name} onChange={e => updateStep(selectedStep, 'name', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">CTA Button Text</label>
                  <input type="text" value={step.ctaText} onChange={e => updateStep(selectedStep, 'ctaText', e.target.value)}
                    placeholder="e.g. Get Started →"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Headline</label>
                <input type="text" value={step.headline} onChange={e => updateStep(selectedStep, 'headline', e.target.value)}
                  placeholder="Main headline text"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Subheadline</label>
                <input type="text" value={step.subheadline} onChange={e => updateStep(selectedStep, 'subheadline', e.target.value)}
                  placeholder="Supporting text below headline"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Body Content</label>
                <textarea value={step.body} onChange={e => updateStep(selectedStep, 'body', e.target.value)}
                  rows={4}
                  placeholder="Main body text, bullet points, features list..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
              </div>

              {/* Preview */}
              <div className="border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-5 bg-gray-50 dark:bg-gray-800">
                <p className="text-xs font-medium text-gray-400 mb-3">Preview</p>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{step.headline || 'Headline'}</h3>
                {step.subheadline && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{step.subheadline}</p>}
                {step.body && <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 whitespace-pre-wrap">{step.body}</p>}
                {step.ctaText && (
                  <div className="mt-4">
                    <span className="inline-block px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg">{step.ctaText}</span>
                  </div>
                )}
                {step.type === 'OPT_IN' && (
                  <div className="mt-4 space-y-2 max-w-xs">
                    <input disabled placeholder="Full Name" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-400" />
                    <input disabled placeholder="Email Address" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-400" />
                    <input disabled placeholder="Phone Number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-400" />
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <button onClick={() => handleSave(false)} disabled={saving}
              className="px-5 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium disabled:opacity-50">
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
            <button onClick={() => handleSave(true)} disabled={saving}
              className="px-5 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium">
              {saving ? 'Saving...' : 'Save & Activate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
