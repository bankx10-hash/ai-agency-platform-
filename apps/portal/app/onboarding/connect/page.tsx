'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

type CrmType = 'gohighlevel' | 'hubspot' | 'salesforce' | 'zoho' | 'none'

function ConnectPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [crmType, setCrmType] = useState<CrmType>('none')
  const [form, setForm] = useState({
    businessDescription: '',
    icpDescription: '',
    greetingScript: '',
    faqKnowledgeBase: '',
    q1: '',
    q2: '',
    q3: '',
    escalationNumber: '',
    addressStreet: '',
    addressCity: '',
    addressState: '',
    addressPostcode: '',
    bookingLink: '',
    calcomApiKey: ''
  })
  const [connected, setConnected] = useState<Record<string, boolean>>({})

  // Dev rerun shortcut — visible when ?rerun=true
  const isRerun = searchParams.get('rerun') === 'true'
  const [rerunClientId, setRerunClientId] = useState(searchParams.get('clientId') || '')
  const [rerunLoading, setRerunLoading] = useState(false)
  const [rerunMsg, setRerunMsg] = useState('')

  async function handleRerun() {
    if (!rerunClientId.trim()) return
    setRerunLoading(true)
    setRerunMsg('')
    try {
      const res = await axios.post(
        `${API_URL}/admin/rerun/${rerunClientId.trim()}`,
        {},
        { headers: { 'x-admin-secret': process.env.NEXT_PUBLIC_ADMIN_SECRET || '' } }
      )
      setRerunMsg(`Rerun queued for "${res.data.businessName}". Redirecting...`)
      localStorage.setItem('clientId', rerunClientId.trim())
      setTimeout(() => router.push('/onboarding/complete'), 1500)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Rerun failed'
      setRerunMsg(`Error: ${msg}`)
    } finally {
      setRerunLoading(false)
    }
  }

  useEffect(() => {
    const clientId = getClientId()
    const token = getToken()
    if (clientId && token) {
      axios.get(`${API_URL}/onboarding/${clientId}/connections`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(res => {
        setConnected(res.data.connected || {})
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const justConnected = searchParams.get('connected')
    const oauthError = searchParams.get('error')
    if (justConnected) {
      setConnected(prev => ({ ...prev, [justConnected]: true }))
    }
    if (oauthError) {
      setError(`Connection failed: ${oauthError.replace(/_/g, ' ')}`)
    }
  }, [searchParams])

  function getToken() { return localStorage.getItem('token') || '' }
  function getClientId() { return localStorage.getItem('clientId') || '' }
  function mark(key: string) { setConnected(prev => ({ ...prev, [key]: true })) }

  async function disconnectPlatform(platform: string) {
    try {
      const clientId = getClientId()
      const token = getToken()
      await axios.delete(`${API_URL}/onboarding/disconnect/${platform}`, {
        params: { clientId },
        headers: { Authorization: `Bearer ${token}` }
      })
      // Remove from connected state (meta disconnects both facebook + instagram)
      if (platform === 'facebook' || platform === 'instagram') {
        setConnected(prev => ({ ...prev, facebook: false, instagram: false }))
      } else {
        setConnected(prev => ({ ...prev, [platform]: false }))
      }
    } catch {
      setError(`Failed to disconnect ${platform}. Please try again.`)
    }
  }

  async function oauthConnect(platform: string) {
    try {
      const token = getToken()
      const clientId = getClientId()
      const res = await axios.get(`${API_URL}/onboarding/oauth/${platform}/auth-url`, {
        params: { clientId },
        headers: { Authorization: `Bearer ${token}` }
      })
      window.location.href = res.data.url
    } catch {
      setError(`Failed to initiate ${platform} connection. Please try again.`)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const clientId = getClientId()
      const token = getToken()
      await axios.patch(`${API_URL}/clients/${clientId}`, {
        businessDescription: form.businessDescription,
        icpDescription: form.icpDescription,
        crmType: crmType !== 'none' ? crmType : null
      }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {})

      const qualificationQuestions = [form.q1, form.q2, form.q3].filter(q => q.trim())

      if (form.calcomApiKey.trim()) {
        await axios.post(`${API_URL}/onboarding/${clientId}/connect-calendar`, {
          provider: 'calcom',
          apiKey: form.calcomApiKey.trim(),
          bookingLink: form.bookingLink.trim() || undefined
        }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
      }

      await axios.post(`${API_URL}/onboarding/start`, {
        clientId,
        voiceConfig: {
          greetingScript: form.greetingScript.trim() || undefined,
          faqKnowledgeBase: form.faqKnowledgeBase.trim() || undefined,
          qualificationQuestions: qualificationQuestions.length ? qualificationQuestions : undefined,
          escalationNumber: form.escalationNumber.trim() || undefined,
          bookingLink: form.bookingLink.trim() || undefined,
          address: (form.addressStreet.trim() && form.addressCity.trim()) ? {
            street: form.addressStreet.trim(),
            city: form.addressCity.trim(),
            state: form.addressState.trim(),
            postcode: form.addressPostcode.trim()
          } : undefined
        }
      }, { headers: { Authorization: `Bearer ${token}` } })
      router.push('/onboarding/complete')
    } catch {
      setError('Setup failed. Please try again or contact support.')
    } finally {
      setLoading(false)
    }
  }

  const ConnectRow = ({ platform, connectButton }: { platform: string; connectButton: React.ReactNode }) => (
    <div className="flex items-center gap-2">
      {connected[platform] ? (
        <>
          <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 border border-green-300 px-3 py-1.5 rounded-lg">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
            </svg>
            Connected
          </span>
          <button
            type="button"
            onClick={() => disconnectPlatform(platform)}
            className="flex items-center gap-1 px-3 py-1.5 border border-red-200 text-xs font-medium text-red-600 rounded-lg hover:bg-red-50 transition"
          >
            Disconnect
          </button>
        </>
      ) : connectButton}
    </div>
  )

  const crmLabels: Record<string, string> = {
    gohighlevel: 'GoHighLevel',
    hubspot: 'HubSpot',
    salesforce: 'Salesforce',
    zoho: 'Zoho CRM'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">

        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-1.5 rounded-full text-sm font-medium mb-4">
            Step 2 of 3
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Connect your tools</h1>
          <p className="mt-2 text-gray-600">Connect your platforms so your AI agents can work across every channel.</p>
        </div>

        {/* ── DEV: Re-run existing client (visible when ?rerun=true) ── */}
        {isRerun && (
          <div className="mb-6 bg-amber-50 border border-amber-300 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              Dev shortcut — Re-run deployment for existing client
            </div>
            <p className="text-xs text-amber-700">Clears existing agent deployments and re-runs onboarding using stored credentials. No credential re-entry needed.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={rerunClientId}
                onChange={e => setRerunClientId(e.target.value)}
                placeholder="Client ID (e.g. cmn38f9m20000z1w2...)"
                className="flex-1 px-3 py-2 text-sm border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white font-mono"
              />
              <button
                type="button"
                onClick={handleRerun}
                disabled={rerunLoading || !rerunClientId.trim()}
                className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {rerunLoading ? 'Running...' : 'Re-run →'}
              </button>
            </div>
            {rerunMsg && (
              <p className={`text-xs font-medium ${rerunMsg.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
                {rerunMsg}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── SECTION: Email ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Email</p>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115z"/>
                  <path fill="#34A853" d="M16.04 18.013c-1.09.703-2.474 1.078-4.04 1.078a7.077 7.077 0 0 1-6.723-4.823l-4.04 3.067A11.965 11.965 0 0 0 12 24c2.933 0 5.735-1.043 7.834-3l-3.793-2.987z"/>
                  <path fill="#4A90E2" d="M19.834 21c2.195-2.048 3.62-5.096 3.62-9 0-.71-.109-1.473-.272-2.182H12v4.637h6.436c-.317 1.559-1.17 2.766-2.395 3.558L19.834 21z"/>
                  <path fill="#FBBC05" d="M5.277 14.268A7.12 7.12 0 0 1 4.909 12c0-.782.125-1.533.357-2.235L1.24 6.65A11.934 11.934 0 0 0 0 12c0 1.92.445 3.73 1.237 5.335l4.04-3.067z"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Gmail</p>
                <p className="text-xs text-gray-500">Send emails on your behalf</p>
              </div>
            </div>
            <ConnectRow platform="gmail" connectButton={
              <button type="button" onClick={() => oauthConnect('gmail')}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition shadow-sm">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" fill="#4285F4"/>
                  <path d="M17.64 12.2c0-.38-.034-.74-.096-1.1H12v2.08h3.16a2.7 2.7 0 01-1.17 1.77v1.47h1.9c1.1-1.01 1.74-2.5 1.74-4.24z" fill="#4285F4"/>
                  <path d="M12 18c1.58 0 2.91-.52 3.88-1.42l-1.9-1.47c-.53.35-1.2.56-1.98.56-1.52 0-2.81-1.03-3.27-2.4H6.77v1.52A5.997 5.997 0 0012 18z" fill="#34A853"/>
                  <path d="M8.73 13.27A3.6 3.6 0 018.54 12c0-.44.08-.87.19-1.27V9.21H6.77A6 6 0 006 12c0 .97.23 1.88.64 2.69l2.09-1.42z" fill="#FBBC05"/>
                  <path d="M12 8.38c.86 0 1.63.3 2.24.87l1.68-1.68A5.97 5.97 0 0012 6a5.997 5.997 0 00-5.23 3.21l2.09 1.42c.46-1.37 1.75-2.25 3.14-2.25z" fill="#EA4335"/>
                </svg>
                Connect with Google
              </button>
            } />
          </div>

          {/* ── SECTION: Social Media ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-4">Social Media</p>

          {/* Facebook */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#1877F2">
                  <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Facebook</p>
                <p className="text-xs text-gray-500">Post to your Facebook Page</p>
              </div>
            </div>
            <ConnectRow platform="facebook" connectButton={
              <button type="button" onClick={() => oauthConnect('facebook')}
                className="flex items-center gap-2 px-4 py-2 bg-[#1877F2] text-white text-sm font-medium rounded-lg hover:bg-[#166FE5] transition">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                </svg>
                Connect with Facebook
              </button>
            } />
          </div>

          {/* Instagram */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <defs>
                    <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#F58529"/>
                      <stop offset="50%" stopColor="#DD2A7B"/>
                      <stop offset="100%" stopColor="#8134AF"/>
                    </linearGradient>
                  </defs>
                  <path fill="url(#ig-grad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Instagram</p>
                <p className="text-xs text-gray-500">Post to your Instagram Business account</p>
              </div>
            </div>
            <ConnectRow platform="instagram" connectButton={
              <button type="button" onClick={() => oauthConnect('instagram')}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg hover:opacity-90 transition"
                style={{ background: 'linear-gradient(45deg, #F58529, #DD2A7B, #8134AF)' }}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
                Connect with Instagram
              </button>
            } />
          </div>

          {/* TikTok */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.79 1.52V6.82a4.85 4.85 0 01-1.02-.13z"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">TikTok</p>
                <p className="text-xs text-gray-500">Post videos to your TikTok account</p>
              </div>
            </div>
            <ConnectRow platform="tiktok" connectButton={
              <button type="button" onClick={() => oauthConnect('tiktok')}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.79 1.52V6.82a4.85 4.85 0 01-1.02-.13z"/>
                </svg>
                Connect with TikTok
              </button>
            } />
          </div>

          {/* Twitter / X */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Twitter / X</p>
                <p className="text-xs text-gray-500">Post to your Twitter/X account</p>
              </div>
            </div>
            <ConnectRow platform="twitter" connectButton={
              <button type="button" onClick={() => oauthConnect('twitter')}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                Connect with Twitter
              </button>
            } />
          </div>

          {/* LinkedIn */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#0A66C2">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">LinkedIn</p>
                <p className="text-xs text-gray-500">Outreach and connection automation</p>
              </div>
            </div>
            <ConnectRow platform="linkedin" connectButton={
              <button type="button" onClick={() => oauthConnect('linkedin')}
                className="flex items-center gap-2 px-4 py-2 bg-[#0A66C2] text-white text-sm font-medium rounded-lg hover:bg-[#004182] transition">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                Connect with LinkedIn
              </button>
            } />
          </div>

          {/* ── SECTION: CRM ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-4">CRM Integration</p>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Which CRM are you using?</label>
              <select value={crmType} onChange={e => setCrmType(e.target.value as CrmType)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-gray-900 bg-white transition">
                <option value="none">No existing CRM</option>
                <option value="gohighlevel">GoHighLevel</option>
                <option value="hubspot">HubSpot</option>
                <option value="salesforce">Salesforce</option>
                <option value="zoho">Zoho CRM</option>
              </select>
            </div>

            {crmType !== 'none' && (
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    Connect to {crmType === 'gohighlevel' ? 'GoHighLevel' : crmType.charAt(0).toUpperCase() + crmType.slice(1)}
                  </span>
                </div>
                <ConnectRow platform={crmType} connectButton={
                  <button type="button" onClick={() => oauthConnect(crmType)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                    </svg>
                    Connect {crmLabels[crmType]}
                  </button>
                } />
              </div>
            )}
          </div>

          {/* ── SECTION: Business Details ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-4">Business Details</p>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Business description</label>
              <textarea value={form.businessDescription}
                onChange={e => setForm(f => ({ ...f, businessDescription: e.target.value }))}
                rows={3} placeholder="Describe your business, what you do, and who you serve..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm resize-none"/>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Ideal customer profile (ICP)</label>
              <textarea value={form.icpDescription}
                onChange={e => setForm(f => ({ ...f, icpDescription: e.target.value }))}
                rows={4} placeholder="Describe your ideal customer: industry, company size, role, pain points, budget, location..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm resize-none"/>
              <p className="text-xs text-gray-400 mt-1">The more detail you provide, the better your AI agents will qualify leads.</p>
            </div>
          </div>

          {/* ── SECTION: Calendar ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-4">Calendar & Booking</p>
          <p className="text-xs text-gray-500 -mt-2">Connect your calendar so your AI voice agent can send callers a booking link after each call.</p>

          {/* Calendly */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#006BFF">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4a8 8 0 110 16A8 8 0 0112 4zm0 2a6 6 0 100 12A6 6 0 0012 6zm-1 3h2v4l3 1.5-.9 1.8L11 14.5V9z"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Calendly</p>
                <p className="text-xs text-gray-500">Connect your Calendly account</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {connected['calendly'] && <ConnectedBadge platform="calendly" />}
              <button type="button" onClick={() => oauthConnect('calendly')}
                className="flex items-center gap-2 px-4 py-2 bg-[#006BFF] text-white text-sm font-medium rounded-lg hover:bg-[#0055cc] transition">
                Connect Calendly
              </button>
            </div>
          </div>

          {/* Google Calendar */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M21 6H3a1 1 0 00-1 1v14a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1z"/>
                  <path fill="#fff" d="M3 10h18v2H3z"/>
                  <rect x="7" y="2" width="2" height="5" rx="1" fill="#4285F4"/>
                  <rect x="15" y="2" width="2" height="5" rx="1" fill="#4285F4"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Google Calendar</p>
                <p className="text-xs text-gray-500">Connect your Google Calendar</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {connected['google-calendar'] && <ConnectedBadge platform="google-calendar" />}
              <button type="button" onClick={() => oauthConnect('google-calendar')}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition shadow-sm">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" fill="#4285F4"/>
                  <path d="M17.64 12.2c0-.38-.034-.74-.096-1.1H12v2.08h3.16a2.7 2.7 0 01-1.17 1.77v1.47h1.9c1.1-1.01 1.74-2.5 1.74-4.24z" fill="#4285F4"/>
                </svg>
                Connect with Google
              </button>
            </div>
          </div>

          {/* Cal.com */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-xs">Cal</span>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Cal.com</p>
                <p className="text-xs text-gray-500">Enter your Cal.com API key</p>
              </div>
            </div>
            <input
              type="password"
              value={form.calcomApiKey}
              onChange={e => setForm(f => ({ ...f, calcomApiKey: e.target.value }))}
              placeholder="cal_live_xxxxxxxxxxxx"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm font-mono"
            />
            <p className="text-xs text-gray-400">Find your API key at cal.com/settings/developer/api-keys</p>
          </div>

          {/* Booking link fallback */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Booking link <span className="text-gray-400 font-normal">(optional fallback)</span>
              </label>
              <input
                type="url"
                value={form.bookingLink}
                onChange={e => setForm(f => ({ ...f, bookingLink: e.target.value }))}
                placeholder="https://calendly.com/yourbusiness or any booking URL"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">After every call where a caller wants to book, your AI agent will email them this link. Works with Calendly, Acuity, GHL, or any booking page.</p>
            </div>
          </div>

          {/* ── SECTION: Voice Agent Setup ── */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-4">Voice Agent Setup</p>
          <p className="text-xs text-gray-500 -mt-2">Used to personalise your AI phone receptionist. All fields are optional — we&apos;ll use smart defaults if left blank.</p>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-5">

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Greeting script</label>
              <input
                type="text"
                value={form.greetingScript}
                onChange={e => setForm(f => ({ ...f, greetingScript: e.target.value }))}
                placeholder={`Thank you for calling [your business]. How can I help you today?`}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">The first thing your AI receptionist says when someone calls.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">What does your business do?</label>
              <textarea
                value={form.faqKnowledgeBase}
                onChange={e => setForm(f => ({ ...f, faqKnowledgeBase: e.target.value }))}
                rows={4}
                placeholder="Describe your services, pricing, hours, location, and common questions callers ask. The more detail, the better your agent will handle real calls."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">This becomes your agent&apos;s knowledge base — it answers FAQs from this.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Qualification questions <span className="text-gray-400 font-normal">(up to 3)</span></label>
              <div className="space-y-2">
                {(['q1', 'q2', 'q3'] as const).map((key, i) => (
                  <input
                    key={key}
                    type="text"
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={[
                      'e.g. What brings you in today?',
                      'e.g. Have you worked with us before?',
                      'e.g. What is your timeline for this?'
                    ][i]}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                  />
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">Questions your agent will ask naturally during the call to qualify the caller.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Escalation phone number</label>
              <input
                type="tel"
                value={form.escalationNumber}
                onChange={e => setForm(f => ({ ...f, escalationNumber: e.target.value }))}
                placeholder="e.g. +61412345678"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">If a caller is upset or asks for a human, your agent will transfer to this number.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Business address <span className="text-indigo-600 font-normal">(required for your phone number)</span>
              </label>
              <div className="space-y-2">
                <input
                  type="text"
                  value={form.addressStreet}
                  onChange={e => setForm(f => ({ ...f, addressStreet: e.target.value }))}
                  placeholder="Street address"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                />
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={form.addressCity}
                    onChange={e => setForm(f => ({ ...f, addressCity: e.target.value }))}
                    placeholder="Suburb / City"
                    className="col-span-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                  />
                  <input
                    type="text"
                    value={form.addressState}
                    onChange={e => setForm(f => ({ ...f, addressState: e.target.value }))}
                    placeholder="State (e.g. NSW)"
                    className="col-span-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                  />
                  <input
                    type="text"
                    value={form.addressPostcode}
                    onChange={e => setForm(f => ({ ...f, addressPostcode: e.target.value }))}
                    placeholder="Postcode"
                    className="col-span-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1">Twilio requires a registered address to provision an Australian phone number.</p>
            </div>

          </div>

          {/* ── SUBMIT ── */}
          <button type="submit" disabled={loading}
            className="w-full py-4 px-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md text-lg">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Deploying your AI agents...
              </span>
            ) : 'Launch my AI agents →'}
          </button>

          <p className="text-center text-sm text-gray-500 pb-8">
            You can skip optional connections and update them later from your dashboard
          </p>

        </form>
      </div>
    </div>
  )
}

export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center"><div className="text-gray-500">Loading...</div></div>}>
      <ConnectPageInner />
    </Suspense>
  )
}
