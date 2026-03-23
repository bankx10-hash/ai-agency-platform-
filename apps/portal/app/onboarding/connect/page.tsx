'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

type CrmType = 'gohighlevel' | 'hubspot' | 'salesforce' | 'zoho' | 'none'

interface ConnectedState {
  gmail: boolean
  facebook: boolean
  instagram: boolean
  tiktok: boolean
  linkedin: boolean
  twitter: boolean
  ghl: boolean
  hubspot: boolean
  salesforce: boolean
  zoho: boolean
}

export default function ConnectPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [connected, setConnected] = useState<ConnectedState>({
    gmail: false, facebook: false, instagram: false, tiktok: false,
    linkedin: false, twitter: false, ghl: false, hubspot: false, salesforce: false, zoho: false
  })

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState({
    crmType: 'none' as CrmType,
    crmApiKey: '',
    ghlLocationId: '',
    linkedinCookie: '',
    metaPageId: '',
    metaAccessToken: '',
    instagramUserId: '',
    bufferToken: '',
    businessDescription: '',
    icpDescription: ''
  })

  function u(key: string, value: string) { setForm(prev => ({ ...prev, [key]: value })) }
  function getToken() { return localStorage.getItem('token') || '' }
  function getClientId() { return localStorage.getItem('clientId') || '' }
  function toggle(key: string) { setExpanded(prev => ({ ...prev, [key]: !prev[key] })) }
  function mark(key: keyof ConnectedState) { setConnected(prev => ({ ...prev, [key]: true })) }

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
      setError(`Failed to connect ${platform}. Please try again.`)
    }
  }

  async function saveMeta() {
    if (!form.metaAccessToken || !form.metaPageId) return
    const token = getToken()
    const clientId = getClientId()
    await axios.post(`${API_URL}/onboarding/${clientId}/connect-social`, {
      platform: 'meta',
      metaAccessToken: form.metaAccessToken,
      metaPageId: form.metaPageId,
      instagramUserId: form.instagramUserId
    }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    mark('facebook')
    mark('instagram')
    toggle('meta')
  }

  async function saveLinkedIn() {
    if (!form.linkedinCookie) return
    const token = getToken()
    const clientId = getClientId()
    await axios.post(`${API_URL}/onboarding/${clientId}/connect-linkedin`, {
      sessionCookie: form.linkedinCookie
    }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    mark('linkedin')
    toggle('linkedin')
  }

  async function saveGHL() {
    if (!form.crmApiKey || !form.ghlLocationId) return
    const token = getToken()
    const clientId = getClientId()
    await axios.post(`${API_URL}/onboarding/${clientId}/connect-crm`, {
      crmType: 'gohighlevel',
      apiKey: form.crmApiKey,
      locationId: form.ghlLocationId
    }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    mark('ghl')
    toggle('ghl')
  }

  async function saveCRM(crmType: Exclude<CrmType, 'none' | 'gohighlevel'>) {
    if (!form.crmApiKey) return
    const token = getToken()
    const clientId = getClientId()
    await axios.post(`${API_URL}/onboarding/${clientId}/connect-crm`, {
      crmType,
      apiKey: form.crmApiKey
    }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    mark(crmType as keyof ConnectedState)
    toggle(crmType)
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
        icpDescription: form.icpDescription
      }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
      await axios.post(`${API_URL}/onboarding/start`, { clientId }, { headers: { Authorization: `Bearer ${token}` } })
      router.push('/onboarding/complete')
    } catch {
      setError('Setup failed. Please try again or contact support.')
    } finally {
      setLoading(false)
    }
  }

  const Badge = ({ ok }: { ok: boolean }) =>
    ok ? (
      <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
        Connected
      </span>
    ) : (
      <span className="text-xs text-gray-400 font-medium">Not connected</span>
    )

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">

        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-1.5 rounded-full text-sm font-medium mb-4">
            <span>Step 2 of 3</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Connect your tools</h1>
          <p className="mt-2 text-gray-600">Connect your platforms so your AI agents can work across every channel.</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── EMAIL ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
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
              <div className="flex items-center gap-3">
                <Badge ok={connected.gmail} />
                {!connected.gmail && (
                  <button type="button" onClick={() => oauthConnect('gmail')}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                    Connect
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── FACEBOOK ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#1877F2">
                    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Facebook</p>
                  <p className="text-xs text-gray-500">Post to your Facebook Page</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge ok={connected.facebook} />
                <button type="button" onClick={() => toggle('meta')}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                  {connected.facebook ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
            {expanded['meta'] && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Page Access Token</label>
                  <input type="password" value={form.metaAccessToken} onChange={e => u('metaAccessToken', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                    placeholder="EAABsbCS4..." />
                  <p className="text-xs text-gray-400 mt-1">Meta Business Suite → Settings → Page Access Tokens</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Facebook Page ID</label>
                  <input type="text" value={form.metaPageId} onChange={e => u('metaPageId', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                    placeholder="123456789012345" />
                </div>
                <button type="button" onClick={saveMeta}
                  className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition">
                  Save Facebook Connection
                </button>
              </div>
            )}
          </div>

          {/* ── INSTAGRAM ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center">
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <defs>
                      <linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#F58529"/>
                        <stop offset="50%" stopColor="#DD2A7B"/>
                        <stop offset="100%" stopColor="#8134AF"/>
                      </linearGradient>
                    </defs>
                    <path fill="url(#ig)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Instagram</p>
                  <p className="text-xs text-gray-500">Post to your Instagram Business account</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge ok={connected.instagram} />
                <button type="button" onClick={() => toggle('instagram')}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                  {connected.instagram ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
            {expanded['instagram'] && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs text-gray-500">Uses your Facebook Page Access Token above. Also needs your Instagram Business Account ID.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Instagram Business Account ID</label>
                  <input type="text" value={form.instagramUserId} onChange={e => u('instagramUserId', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                    placeholder="17841400000000000" />
                  <p className="text-xs text-gray-400 mt-1">GET /{'{page-id}'}?fields=instagram_business_account</p>
                </div>
                {!form.metaAccessToken && (
                  <p className="text-xs text-amber-600 font-medium">⚠ Connect Facebook first to provide the Page Access Token.</p>
                )}
                <button type="button" onClick={saveMeta}
                  className="w-full py-2.5 bg-pink-600 text-white text-sm font-semibold rounded-lg hover:bg-pink-700 transition">
                  Save Instagram Connection
                </button>
              </div>
            )}
          </div>

          {/* ── TIKTOK ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.79 1.52V6.82a4.85 4.85 0 01-1.02-.13z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">TikTok</p>
                  <p className="text-xs text-gray-500">Post videos to your TikTok account</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge ok={connected.tiktok} />
                {!connected.tiktok && (
                  <button type="button" onClick={() => oauthConnect('tiktok')}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                    Connect
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── TWITTER / X ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Twitter / X</p>
                  <p className="text-xs text-gray-500">Post to your Twitter/X account</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge ok={connected.twitter} />
                <button type="button" onClick={() => oauthConnect('twitter')}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                  {connected.twitter ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
          </div>

          {/* ── LINKEDIN ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#0A66C2">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">LinkedIn</p>
                  <p className="text-xs text-gray-500">Outreach and connection automation</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge ok={connected.linkedin} />
                <button type="button" onClick={() => toggle('linkedin')}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                  {connected.linkedin ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
            {expanded['linkedin'] && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn Session Cookie</label>
                  <input type="password" value={form.linkedinCookie} onChange={e => u('linkedinCookie', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                    placeholder="li_at=..." />
                  <p className="text-xs text-gray-400 mt-1">Browser → DevTools → Application → Cookies → linkedin.com → li_at</p>
                </div>
                <button type="button" onClick={saveLinkedIn}
                  className="w-full py-2.5 bg-blue-700 text-white text-sm font-semibold rounded-lg hover:bg-blue-800 transition">
                  Save LinkedIn Connection
                </button>
              </div>
            )}
          </div>

          {/* ── CRM SECTION ── */}
          <div className="mt-8 mb-2">
            <h2 className="text-lg font-semibold text-gray-900">CRM Integration</h2>
            <p className="text-sm text-gray-500">Connect your existing CRM to sync leads and contacts automatically.</p>
          </div>

          {/* GoHighLevel */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                  <span className="text-orange-600 font-bold text-sm">GHL</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">GoHighLevel</p>
                  <p className="text-xs text-gray-500">Sync leads to your GHL sub-account</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge ok={connected.ghl} />
                <button type="button" onClick={() => toggle('ghl')}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                  {connected.ghl ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
            {expanded['ghl'] && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location API Key</label>
                  <input type="password" value={form.crmApiKey} onChange={e => u('crmApiKey', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                    placeholder="GHL Location API Key..." />
                  <p className="text-xs text-gray-400 mt-1">Settings → API Keys → Location API Key</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location ID</label>
                  <input type="text" value={form.ghlLocationId} onChange={e => u('ghlLocationId', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                    placeholder="AbC12dEfGhIjKlMn" />
                  <p className="text-xs text-gray-400 mt-1">Settings → Business Info → Location ID</p>
                </div>
                <button type="button" onClick={saveGHL}
                  className="w-full py-2.5 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-700 transition">
                  Save GoHighLevel Connection
                </button>
              </div>
            )}
          </div>

          {/* HubSpot */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#FF7A59">
                    <path d="M18.164 7.93V5.084a2.198 2.198 0 001.269-1.978V3.07a2.2 2.2 0 00-2.199-2.2h-.036a2.2 2.2 0 00-2.198 2.2v.036a2.198 2.198 0 001.269 1.978V7.93a6.231 6.231 0 00-2.963 1.307L6.01 4.923a2.432 2.432 0 10-1.03 1.424l7.139 4.208a6.232 6.232 0 00.887 8.548 6.233 6.233 0 008.695-.884 6.235 6.235 0 00-3.537-10.289zm-.87 9.666a3.438 3.438 0 110-6.877 3.438 3.438 0 010 6.877z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">HubSpot</p>
                  <p className="text-xs text-gray-500">Sync contacts to HubSpot CRM</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge ok={connected.hubspot} />
                <button type="button" onClick={() => toggle('hubspot')}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                  {connected.hubspot ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
            {expanded['hubspot'] && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">HubSpot API Key / Private App Token</label>
                  <input type="password" value={form.crmApiKey} onChange={e => u('crmApiKey', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                    placeholder="pat-na1-..." />
                  <p className="text-xs text-gray-400 mt-1">Settings → Integrations → Private Apps → Create a private app</p>
                </div>
                <button type="button" onClick={() => saveCRM('hubspot')}
                  className="w-full py-2.5 bg-orange-500 text-white text-sm font-semibold rounded-lg hover:bg-orange-600 transition">
                  Save HubSpot Connection
                </button>
              </div>
            )}
          </div>

          {/* Salesforce */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#00A1E0">
                    <path d="M10.057 3.18A5.636 5.636 0 0113.67 2c1.988 0 3.733 1.02 4.737 2.567a5.074 5.074 0 012.044-.426c2.827 0 5.12 2.299 5.12 5.136 0 2.837-2.293 5.137-5.12 5.137a5.03 5.03 0 01-.82-.069A4.457 4.457 0 0115.37 16.3a4.487 4.487 0 01-1.82-.386 4.996 4.996 0 01-4.728 3.366c-1.604 0-3.033-.75-3.97-1.924A4.558 4.558 0 013.39 17.7C1.523 17.7 0 16.17 0 14.296c0-1.04.45-1.977 1.165-2.623A4.99 4.99 0 011 10.23c0-2.763 2.238-5.003 5-5.003.74 0 1.44.16 2.071.446A5.656 5.656 0 0110.057 3.18z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Salesforce</p>
                  <p className="text-xs text-gray-500">Sync leads and opportunities</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge ok={connected.salesforce} />
                <button type="button" onClick={() => toggle('salesforce')}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
                  {connected.salesforce ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
            {expanded['salesforce'] && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Salesforce API Key</label>
                  <input type="password" value={form.crmApiKey} onChange={e => u('crmApiKey', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm"
                    placeholder="Paste your Salesforce API key..." />
                </div>
                <button type="button" onClick={() => saveCRM('salesforce')}
                  className="w-full py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition">
                  Save Salesforce Connection
                </button>
              </div>
            )}
          </div>

          {/* ── BUSINESS DETAILS ── */}
          <div className="mt-8 mb-2">
            <h2 className="text-lg font-semibold text-gray-900">Business Details</h2>
            <p className="text-sm text-gray-500">Help your AI agents understand your business and target customers.</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Business description</label>
              <textarea value={form.businessDescription} onChange={e => u('businessDescription', e.target.value)}
                rows={3} placeholder="Describe your business, what you do, and who you serve..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm resize-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Ideal customer profile (ICP)</label>
              <textarea value={form.icpDescription} onChange={e => u('icpDescription', e.target.value)}
                rows={4} placeholder="Describe your ideal customer: industry, company size, role, pain points, budget, location..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 text-sm resize-none" />
              <p className="text-xs text-gray-400 mt-1">The more detail you provide, the better your AI agents will qualify leads.</p>
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
