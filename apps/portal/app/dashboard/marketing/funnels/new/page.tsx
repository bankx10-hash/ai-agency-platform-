'use client'

import { useState, useRef } from 'react'
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
  imageUrl: string
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

interface FunnelTemplate {
  id: string
  name: string
  description: string
  gradient: string
  gradientDark: string
  steps: Step[]
  funnelName: string
  funnelDescription: string
}

function makeStep(type: string, nameOverride?: string): Step {
  const typeInfo = STEP_TYPES.find(t => t.value === type)
  const defaults = DEFAULT_TEMPLATES[type] || {}
  return {
    name: nameOverride || typeInfo?.label || type,
    type,
    headline: defaults.headline || '',
    subheadline: defaults.subheadline || '',
    body: '',
    ctaText: defaults.ctaText || 'Continue →',
    imageUrl: '',
  }
}

const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  {
    id: 'lead-magnet',
    name: 'Lead Magnet',
    description: 'Capture leads with a free resource like a PDF guide, checklist, or ebook.',
    gradient: 'from-blue-500 to-blue-700',
    gradientDark: 'from-blue-600 to-blue-900',
    funnelName: 'Lead Magnet Funnel',
    funnelDescription: 'Capture leads with a free downloadable resource',
    steps: [
      makeStep('LANDING', 'Landing Page'),
      makeStep('OPT_IN', 'Opt-In Form'),
      makeStep('THANK_YOU', 'Thank You'),
    ],
  },
  {
    id: 'webinar',
    name: 'Webinar Registration',
    description: 'Drive signups for a live or recorded webinar presentation.',
    gradient: 'from-purple-500 to-purple-700',
    gradientDark: 'from-purple-600 to-purple-900',
    funnelName: 'Webinar Funnel',
    funnelDescription: 'Drive registrations for your webinar',
    steps: [
      makeStep('LANDING', 'Landing Page'),
      makeStep('WEBINAR', 'Webinar Page'),
      makeStep('OPT_IN', 'Registration Form'),
      makeStep('THANK_YOU', 'Confirmation'),
    ],
  },
  {
    id: 'product-launch',
    name: 'Product Launch',
    description: 'Full sales funnel with upsell and checkout for a product launch.',
    gradient: 'from-emerald-500 to-emerald-700',
    gradientDark: 'from-emerald-600 to-emerald-900',
    funnelName: 'Product Launch Funnel',
    funnelDescription: 'Launch your product with a full sales pipeline',
    steps: [
      makeStep('LANDING', 'Landing Page'),
      makeStep('SALES_PAGE', 'Sales Page'),
      makeStep('UPSELL', 'Upsell Offer'),
      makeStep('CHECKOUT', 'Checkout'),
      makeStep('THANK_YOU', 'Order Confirmation'),
    ],
  },
  {
    id: 'consultation',
    name: 'Free Consultation',
    description: 'Book free consultations and capture prospect info.',
    gradient: 'from-orange-400 to-orange-600',
    gradientDark: 'from-orange-500 to-orange-800',
    funnelName: 'Free Consultation Funnel',
    funnelDescription: 'Book free consultations with qualified leads',
    steps: [
      makeStep('LANDING', 'Landing Page'),
      makeStep('OPT_IN', 'Book Your Call'),
      makeStep('THANK_YOU', 'Booking Confirmed'),
    ],
  },
  {
    id: 'course-sales',
    name: 'Course Sales',
    description: 'Sell online courses with an upsell for premium content.',
    gradient: 'from-pink-500 to-pink-700',
    gradientDark: 'from-pink-600 to-pink-900',
    funnelName: 'Course Sales Funnel',
    funnelDescription: 'Sell your online course with upsell opportunities',
    steps: [
      makeStep('SALES_PAGE', 'Course Sales Page'),
      makeStep('UPSELL', 'Premium Bundle Offer'),
      makeStep('CHECKOUT', 'Checkout'),
      makeStep('THANK_YOU', 'Welcome & Access'),
    ],
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'Start from scratch and build your own custom funnel.',
    gradient: 'from-gray-400 to-gray-600',
    gradientDark: 'from-gray-500 to-gray-700',
    funnelName: '',
    funnelDescription: '',
    steps: [],
  },
]

export default function NewFunnelPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<Step[]>([
    { ...makeStep('LANDING', 'Landing Page'), subheadline: 'Discover how we can help you grow' },
    { ...makeStep('OPT_IN', 'Opt-In Form') },
    { ...makeStep('THANK_YOU', 'Thank You'), subheadline: "You're all set. We'll be in touch shortly." },
  ])
  const [selectedStep, setSelectedStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(true)

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  function applyTemplate(template: FunnelTemplate) {
    setSelectedTemplate(template.id)
    setName(template.funnelName)
    setDescription(template.funnelDescription)
    if (template.steps.length > 0) {
      setSteps(template.steps.map(s => ({ ...s })))
      setSelectedStep(0)
    } else {
      setSteps([])
      setSelectedStep(0)
    }
  }

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
      imageUrl: '',
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

  // Drag and drop handlers
  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  function handleDragLeave() {
    setDragOverIndex(null)
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const newSteps = [...steps]
    const [removed] = newSteps.splice(dragIndex, 1)
    newSteps.splice(dropIndex, 0, removed)
    setSteps(newSteps)
    setSelectedStep(dropIndex)
    setDragIndex(null)
    setDragOverIndex(null)
  }

  function handleDragEnd() {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const step = steps[selectedStep]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard/marketing/funnels')} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Build Funnel</h1>
            {selectedTemplate && selectedTemplate !== 'blank' && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5 font-medium">
                Selected: {FUNNEL_TEMPLATES.find(t => t.id === selectedTemplate)?.name}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {showTemplates ? 'Hide Templates' : 'Show Templates'}
        </button>
      </div>

      {/* Template Gallery */}
      {showTemplates && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Start with a Template</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {FUNNEL_TEMPLATES.map(template => (
              <button
                key={template.id}
                onClick={() => applyTemplate(template)}
                className={`group text-left rounded-xl border-2 overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                  selectedTemplate === template.id
                    ? 'border-indigo-500 shadow-md shadow-indigo-500/20 ring-2 ring-indigo-500/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {/* Gradient preview area */}
                <div className={`relative h-[200px] bg-gradient-to-br ${template.gradient} dark:${template.gradientDark} flex items-center justify-center overflow-hidden`}>
                  {/* Decorative mockup elements */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 opacity-30">
                    <div className="w-3/4 h-2 bg-white rounded mb-2" />
                    <div className="w-1/2 h-1.5 bg-white rounded mb-4" />
                    <div className="w-full h-12 bg-white/20 rounded-lg mb-2" />
                    <div className="w-2/3 h-6 bg-white rounded-full" />
                  </div>
                  {/* Template name overlay */}
                  <div className="relative z-10 text-center">
                    <p className="text-white font-bold text-sm drop-shadow-lg">{template.name}</p>
                  </div>
                  {/* Step count badge */}
                  <div className="absolute top-2 right-2 px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-white text-xs font-medium">
                    {template.steps.length === 0 ? 'Custom' : `${template.steps.length} steps`}
                  </div>
                  {/* Selected checkmark */}
                  {selectedTemplate === template.id && (
                    <div className="absolute top-2 left-2 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-md">
                      <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>
                {/* Description */}
                <div className="p-3 bg-white dark:bg-gray-900">
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">{template.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Builder */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Funnel info + step list */}
        <div className="lg:col-span-4 space-y-4">
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

          {/* Steps list with funnel flow */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Funnel Steps</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-0">
              {steps.map((s, i) => {
                const typeInfo = STEP_TYPES.find(t => t.value === s.type)
                const isDragging = dragIndex === i
                const isDragOver = dragOverIndex === i
                return (
                  <div key={i}>
                    {/* Drop indicator line above */}
                    {isDragOver && dragIndex !== null && dragIndex > i && (
                      <div className="h-0.5 bg-indigo-500 rounded-full mx-2 mb-1 animate-pulse" />
                    )}
                    <div
                      draggable
                      onDragStart={e => handleDragStart(e, i)}
                      onDragOver={e => handleDragOver(e, i)}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, i)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setSelectedStep(i)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer border transition-all ${
                        isDragging ? 'opacity-40 scale-95' : ''
                      } ${
                        selectedStep === i
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 shadow-sm'
                          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      {/* Drag handle */}
                      <div className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0" title="Drag to reorder">
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                          <circle cx="5" cy="3" r="1.2" />
                          <circle cx="11" cy="3" r="1.2" />
                          <circle cx="5" cy="8" r="1.2" />
                          <circle cx="11" cy="8" r="1.2" />
                          <circle cx="5" cy="13" r="1.2" />
                          <circle cx="11" cy="13" r="1.2" />
                        </svg>
                      </div>
                      {/* Step number circle */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        selectedStep === i
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                      }`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{typeInfo?.label}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={e => { e.stopPropagation(); moveStep(i, 'up') }} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 rounded transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                        </button>
                        <button onClick={e => { e.stopPropagation(); moveStep(i, 'down') }} disabled={i === steps.length - 1} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 rounded transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        <button onClick={e => { e.stopPropagation(); removeStep(i) }} className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                    {/* Drop indicator line below */}
                    {isDragOver && dragIndex !== null && dragIndex < i && (
                      <div className="h-0.5 bg-indigo-500 rounded-full mx-2 mt-1 animate-pulse" />
                    )}
                    {/* Connecting arrow between steps */}
                    {i < steps.length - 1 && (
                      <div className="flex justify-center py-0.5">
                        <div className="flex flex-col items-center">
                          <div className="w-px h-2 bg-gray-300 dark:bg-gray-600" />
                          <svg className="w-3 h-3 text-gray-300 dark:text-gray-600 -mt-0.5" fill="currentColor" viewBox="0 0 12 12">
                            <path d="M6 9L2 5h8L6 9z" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Add step */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Add Step</p>
              <div className="grid grid-cols-2 gap-1.5">
                {STEP_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => addStep(t.value)}
                    className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors text-left"
                  >
                    <span>{t.icon}</span>
                    <span className="truncate">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Step editor + preview */}
        <div className="lg:col-span-8 space-y-4">
          {step ? (
            <>
              {/* Step Editor */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                    <span className="text-lg">{STEP_TYPES.find(t => t.value === step.type)?.icon || '📄'}</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Step {selectedStep + 1}: {STEP_TYPES.find(t => t.value === step.type)?.label}
                    </h2>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {STEP_TYPES.find(t => t.value === step.type)?.desc}
                    </p>
                  </div>
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
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Image URL</label>
                  <input type="text" value={step.imageUrl} onChange={e => updateStep(selectedStep, 'imageUrl', e.target.value)}
                    placeholder="https://example.com/hero-image.jpg"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Body Content</label>
                  <textarea value={step.body} onChange={e => updateStep(selectedStep, 'body', e.target.value)}
                    rows={4}
                    placeholder="Main body text, bullet points, features list..."
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
                </div>
              </div>

              {/* Browser-frame preview */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center gap-4">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Preview</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                  </div>
                </div>
                {/* Browser address bar */}
                <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 max-w-md">
                    <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                    </svg>
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate">yoursite.com/{name ? name.toLowerCase().replace(/\s+/g, '-') : 'funnel'}/{step.name.toLowerCase().replace(/\s+/g, '-')}</span>
                  </div>
                </div>
                {/* Page preview content */}
                <div className="bg-white dark:bg-gray-950 p-8">
                  <div className="max-w-lg mx-auto">
                    {/* Hero image */}
                    {step.imageUrl ? (
                      <div className="mb-6 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800">
                        <img
                          src={step.imageUrl}
                          alt="Step hero"
                          className="w-full h-48 object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      </div>
                    ) : (
                      <div className="mb-6 h-32 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center border border-gray-200 dark:border-gray-800">
                        <div className="text-center">
                          <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-xs text-gray-400 dark:text-gray-500">Hero Image</span>
                        </div>
                      </div>
                    )}

                    {/* Content */}
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{step.headline || 'Your Headline Here'}</h3>
                    {(step.subheadline || !step.headline) && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{step.subheadline || 'Your subheadline will appear here'}</p>
                    )}
                    {step.body && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mb-5 whitespace-pre-wrap leading-relaxed">{step.body}</p>
                    )}

                    {/* Opt-in form preview */}
                    {step.type === 'OPT_IN' && (
                      <div className="space-y-2.5 mb-5 max-w-sm">
                        <input disabled placeholder="Full Name" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500" />
                        <input disabled placeholder="Email Address" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500" />
                        <input disabled placeholder="Phone Number" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500" />
                      </div>
                    )}

                    {/* Checkout form preview */}
                    {step.type === 'CHECKOUT' && (
                      <div className="space-y-2.5 mb-5 max-w-sm p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Payment Details</p>
                        <input disabled placeholder="Card Number" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500" />
                        <div className="grid grid-cols-2 gap-2">
                          <input disabled placeholder="MM / YY" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500" />
                          <input disabled placeholder="CVC" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500" />
                        </div>
                      </div>
                    )}

                    {/* CTA Button */}
                    {step.ctaText && (
                      <div>
                        <span className="inline-block px-8 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-lg shadow-lg shadow-indigo-500/25 cursor-default">
                          {step.ctaText}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400">Add a step to start building your funnel</p>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => handleSave(false)} disabled={saving}
              className="px-5 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
            <button onClick={() => handleSave(true)} disabled={saving}
              className="px-5 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium shadow-sm shadow-indigo-500/25 transition-colors">
              {saving ? 'Saving...' : 'Save & Activate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
