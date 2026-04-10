'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import ThemeToggle from '../../../components/ThemeToggle'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ businessName: '', phone: '', email: '' })
  const [copied, setCopied] = useState(false)
  const [clientId, setClientId] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  useEffect(() => {
    if (!session) return
    const fetchClient = async () => {
      try {
        const cid = (session.user as { clientId?: string })?.clientId || ''
        setClientId(cid)
        const token = localStorage.getItem('token') || ''
        const response = await axios.get(`${API_URL}/clients/${cid}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const client = response.data.client
        setForm({ businessName: client.businessName || '', phone: client.phone || '', email: client.email || '' })
      } catch (err) {
        console.error('Failed to fetch client:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchClient()
  }, [session])

  function update(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const clientId = (session?.user as { clientId?: string })?.clientId
      const token = localStorage.getItem('token') || ''
      await axios.patch(
        `${API_URL}/clients/${clientId}`,
        { businessName: form.businessName, phone: form.phone },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleBillingPortal() {
    try {
      const clientId = (session?.user as { clientId?: string })?.clientId
      const token = localStorage.getItem('token') || ''
      const response = await axios.post(
        `${API_URL}/billing/portal`,
        { returnUrl: window.location.href },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      window.location.href = response.data.url
    } catch {
      setError('Failed to open billing portal')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Business Information</h2>

          {error && (
            <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {saved && (
            <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-600 dark:text-green-400">
              Settings saved successfully!
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Business name</label>
              <input
                type="text"
                value={form.businessName}
                onChange={e => update('businessName', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition text-gray-900 dark:text-white bg-white dark:bg-gray-800"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email address</label>
              <input
                type="email"
                value={form.email}
                disabled
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-500 cursor-not-allowed"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Email cannot be changed. Contact support if needed.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone number</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => update('phone', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition text-gray-900 dark:text-white bg-white dark:bg-gray-800"
                placeholder="+1 555 000 0000"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </form>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Billing</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Manage your subscription, view invoices, and update payment methods through Stripe.
          </p>
          <button
            onClick={handleBillingPortal}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Open Billing Portal
          </button>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Appearance</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Toggle between light and dark interface.</p>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <span className="text-sm text-gray-600 dark:text-gray-300">Switch theme</span>
          </div>
        </div>

        {clientId && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Website Lead Capture</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Connect your website to start sending leads into your AI pipeline. Choose whichever option suits your setup — all three do the same thing.
            </p>

            {/* Option 1 — Embed form */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Option 1 — Add our ready-made form</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Paste this on your website. It adds a professional lead capture form automatically — no design or coding needed.
              </p>
              <div className="relative">
                <pre className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-all select-all">
{`<script src="${API_URL}/leads/${clientId}/embed.js"></script>`}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`<script src="${API_URL}/leads/${clientId}/embed.js"></script>`)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="absolute top-1.5 right-1.5 px-2.5 py-1 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 transition"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Option 2 — Listener script */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Option 2 — Keep your existing form</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Already have a contact form? Paste this on the same page. It silently captures every submission and sends it to your AI pipeline in the background — your form keeps working exactly as it does now.
              </p>
              <div className="relative">
                <pre className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-all select-all">
{`<script src="${API_URL}/leads/${clientId}/listener.js"></script>`}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`<script src="${API_URL}/leads/${clientId}/listener.js"></script>`)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="absolute top-1.5 right-1.5 px-2.5 py-1 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 transition"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Option 3 — Webhook URL */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Option 3 — Webhook URL (for form builders)</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Use WordPress (WPForms, Gravity Forms, Contact Form 7), Wix, Squarespace, Typeform, or Jotform? Paste this URL into your form builder{"'"}s webhook or integration settings. We automatically recognise the field names.
              </p>
              <div className="relative">
                <pre className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-all select-all">
{`${API_URL}/leads/${clientId}`}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${API_URL}/leads/${clientId}`)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="absolute top-1.5 right-1.5 px-2.5 py-1 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 transition"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Option 4 — Bio link */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Option 4 — Social media bio link</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                A mobile-friendly landing page for your Instagram bio, Facebook page, Stories, ads, QR codes, or anywhere else. Visitors fill out the form and leads flow straight into your AI pipeline.
              </p>
              <div className="relative">
                <pre className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-all select-all">
{`${API_URL}/leads/${clientId}/page`}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${API_URL}/leads/${clientId}/page`)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="absolute top-1.5 right-1.5 px-2.5 py-1 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 transition"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500">
              When someone submits, the lead is automatically scored by your AI, saved to your CRM, and routed to your appointment setter and outbound caller.
            </p>
          </div>
        )}

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Account</h2>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-2 px-4 py-2.5 border border-red-200 dark:border-red-800 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
    </div>
  )
}
