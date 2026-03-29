'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import ThemeToggle from '../../../components/ThemeToggle'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
const RETURN_TO = '/dashboard/connections'

function ConnectionsPageInner() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [connected, setConnected] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  function getClientId() {
    return (session?.user as { clientId?: string })?.clientId || localStorage.getItem('clientId') || ''
  }
  function getToken() {
    return localStorage.getItem('token') || (session as { accessToken?: string })?.accessToken || ''
  }

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  // Load connected state from DB
  useEffect(() => {
    if (!session) return
    const clientId = getClientId()
    const token = getToken()
    if (!clientId) return
    axios.get(`${API_URL}/onboarding/${clientId}/connections`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      setConnected(res.data.connected || {})
    }).catch(() => {}).finally(() => setLoading(false))
  }, [session])

  // Handle OAuth redirect back — mark newly connected platform
  useEffect(() => {
    const justConnected = searchParams.get('connected')
    const oauthError = searchParams.get('error')
    if (justConnected) {
      justConnected.split(',').forEach(p => setConnected(prev => ({ ...prev, [p]: true })))
    }
    if (oauthError) setError(`Connection failed: ${oauthError.replace(/_/g, ' ')}`)
  }, [searchParams])

  async function oauthConnect(platform: string) {
    try {
      const clientId = getClientId()
      const token = getToken()
      const res = await axios.get(`${API_URL}/onboarding/oauth/${platform}/auth-url`, {
        params: { clientId, returnTo: RETURN_TO },
        headers: { Authorization: `Bearer ${token}` }
      })
      window.location.href = res.data.url
    } catch {
      setError(`Failed to initiate ${platform} connection. Please try again.`)
    }
  }

  async function disconnect(platform: string) {
    setDisconnecting(platform)
    try {
      const clientId = getClientId()
      const token = getToken()
      await axios.delete(`${API_URL}/onboarding/disconnect/${platform}`, {
        params: { clientId },
        headers: { Authorization: `Bearer ${token}` }
      })
      if (platform === 'facebook' || platform === 'instagram') {
        setConnected(prev => ({ ...prev, facebook: false, instagram: false }))
      } else {
        setConnected(prev => ({ ...prev, [platform]: false }))
      }
    } catch {
      setError(`Failed to disconnect ${platform}. Please try again.`)
    } finally {
      setDisconnecting(null)
    }
  }

  const ConnectRow = ({
    platform,
    label,
    description,
    connectButton
  }: {
    platform: string
    label: string
    description: string
    connectButton: React.ReactNode
  }) => (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div>
        <div className="font-medium text-gray-900 dark:text-white text-sm">{label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</div>
      </div>
      <div className="flex items-center gap-2 ml-4 shrink-0">
        {connected[platform] ? (
          <>
            <span className="flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-3 py-1.5 rounded-lg">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              Connected
            </span>
            <button
              type="button"
              onClick={() => disconnect(platform)}
              disabled={disconnecting === platform}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg hover:border-red-200 dark:hover:border-red-800 transition disabled:opacity-50"
            >
              {disconnecting === platform ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </>
        ) : (
          connectButton
        )}
      </div>
    </div>
  )

  if (loading || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Connected Accounts</h1>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Dashboard</Link>
            <Link href="/dashboard/agents" className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Agents</Link>
            <Link href="/dashboard/analytics" className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Analytics</Link>
            <Link href="/dashboard/connections" className="text-sm font-medium text-indigo-600 dark:text-indigo-400">Connections</Link>
            <Link href="/dashboard/settings" className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Settings</Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Social Media */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Social Media</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Used by the Social Media and Social Engagement agents to post content and reply to comments/DMs.</p>
          <ConnectRow
            platform="facebook"
            label="Facebook & Instagram"
            description="Pages posting, comment replies, and DM automation"
            connectButton={
              <button onClick={() => oauthConnect('facebook')} className="text-sm font-medium px-4 py-2 bg-[#1877F2] text-white rounded-lg hover:bg-[#166FE5] transition">
                Connect Facebook
              </button>
            }
          />
          <ConnectRow
            platform="linkedin"
            label="LinkedIn"
            description="Company page posting and outreach"
            connectButton={
              <button onClick={() => oauthConnect('linkedin')} className="text-sm font-medium px-4 py-2 bg-[#0A66C2] text-white rounded-lg hover:bg-[#095196] transition">
                Connect LinkedIn
              </button>
            }
          />
        </div>

        {/* Calendar & Booking */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Calendar & Booking</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Used by the Appointment Setter and Voice agents to check availability and book meetings.</p>
          <ConnectRow
            platform="calendly"
            label="Calendly"
            description="Auto-book appointments via your Calendly schedule"
            connectButton={
              <button onClick={() => oauthConnect('calendly')} className="text-sm font-medium px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
                Connect Calendly
              </button>
            }
          />
          <ConnectRow
            platform="google-calendar"
            label="Google Calendar"
            description="Check availability and create calendar events directly"
            connectButton={
              <button onClick={() => oauthConnect('google-calendar')} className="text-sm font-medium px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                Connect Google Calendar
              </button>
            }
          />
        </div>

        {/* Email */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Email</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Used to send emails on behalf of your business.</p>
          <ConnectRow
            platform="gmail"
            label="Gmail"
            description="Send emails from your Gmail account"
            connectButton={
              <button onClick={() => oauthConnect('gmail')} className="text-sm font-medium px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                Connect Gmail
              </button>
            }
          />
        </div>

        {/* CRM */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">CRM</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Sync leads and contacts to your CRM automatically.</p>
          <ConnectRow
            platform="hubspot"
            label="HubSpot"
            description="Sync contacts, leads, and deal pipelines"
            connectButton={
              <button onClick={() => oauthConnect('hubspot')} className="text-sm font-medium px-4 py-2 bg-[#FF7A59] text-white rounded-lg hover:bg-[#f26b4a] transition">
                Connect HubSpot
              </button>
            }
          />
          <ConnectRow
            platform="gohighlevel"
            label="GoHighLevel"
            description="Sync contacts and pipelines with GoHighLevel"
            connectButton={
              <button onClick={() => oauthConnect('gohighlevel')} className="text-sm font-medium px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition">
                Connect GoHighLevel
              </button>
            }
          />
          <ConnectRow
            platform="salesforce"
            label="Salesforce"
            description="Sync leads, contacts, and opportunities with Salesforce CRM"
            connectButton={
              <button onClick={() => oauthConnect('salesforce')} className="text-sm font-medium px-4 py-2 bg-[#00A1E0] text-white rounded-lg hover:bg-[#0090C8] transition">
                Connect Salesforce
              </button>
            }
          />
          <ConnectRow
            platform="zoho"
            label="Zoho CRM"
            description="Sync contacts and leads with Zoho CRM"
            connectButton={
              <button onClick={() => oauthConnect('zoho')} className="text-sm font-medium px-4 py-2 bg-[#E42527] text-white rounded-lg hover:bg-[#CC2022] transition">
                Connect Zoho CRM
              </button>
            }
          />
        </div>
      </main>
    </div>
  )
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <ConnectionsPageInner />
    </Suspense>
  )
}
