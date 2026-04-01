'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import NotificationBell from '../../components/NotificationBell'

const NAV = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    exact: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    )
  },
  {
    href: '/dashboard/agents',
    label: 'Agents',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M12 2a4 4 0 014 4v1h1a2 2 0 012 2v3a2 2 0 01-2 2h-1v1a4 4 0 01-8 0v-1H7a2 2 0 01-2-2V9a2 2 0 012-2h1V6a4 4 0 014-4z"/>
        <circle cx="9.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".5" fill="currentColor"/>
      </svg>
    )
  },
  {
    href: '/dashboard/analytics',
    label: 'Analytics',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-4"/>
      </svg>
    )
  },
  {
    href: '/dashboard/crm/contacts',
    label: 'CRM',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
      </svg>
    )
  },
  {
    href: '/dashboard/voice',
    label: 'Voice',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
      </svg>
    )
  },
  {
    href: '/dashboard/marketing/campaigns',
    label: 'Marketing',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
    )
  },
  {
    href: '/dashboard/inbox',
    label: 'Inbox',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
        <polyline points="22,6 12,13 2,6"/>
      </svg>
    )
  },
  {
    href: '/dashboard/sms',
    label: 'SMS',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    )
  },
  {
    href: '/dashboard/connections',
    label: 'Connections',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
      </svg>
    )
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    )
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [businessName, setBusinessName] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const token = (session as { accessToken?: string })?.accessToken
    if (token) localStorage.setItem('token', token)
    const name = (session?.user as { businessName?: string })?.businessName || session?.user?.name || ''
    setBusinessName(name)
  }, [session])

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  const sidebarW = collapsed ? 64 : 224

  return (
    <div className="flex min-h-screen" style={{ background: '#f1f5f9' }}>

      {/* ── Sidebar ── */}
      <aside
        className="fixed top-0 left-0 bottom-0 z-40 flex flex-col transition-all duration-200"
        style={{ width: sidebarW, background: '#0f172a', borderRight: '1px solid rgba(255,255,255,0.05)' }}
      >
        {/* Logo */}
        <div className="flex items-center px-4 h-16 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <img src="/nodus-logo.jpeg" alt="Nodus" className="h-7 w-7 rounded object-cover flex-shrink-0" />
          {!collapsed && (
            <span className="ml-2.5 text-sm font-bold text-white truncate">Nodus AI</span>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="ml-auto p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              {collapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6"/>
                : <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6"/>
              }
            </svg>
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          {NAV.map(({ href, label, icon, exact }) => {
            const active = isActive(href, exact)
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className="flex items-center gap-3 mx-2 mb-0.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150"
                style={{
                  color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                  background: active ? 'rgba(59,130,246,0.18)' : 'transparent',
                  borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
                }}
              >
                <span className="flex-shrink-0" style={{ color: active ? '#3b82f6' : 'rgba(255,255,255,0.40)' }}>
                  {icon}
                </span>
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* User footer */}
        {!collapsed && (
          <div className="px-4 py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: '#2563eb', color: '#fff' }}>
                {businessName.charAt(0).toUpperCase() || 'N'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{businessName || 'My Business'}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Admin</p>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-col flex-1 transition-all duration-200" style={{ marginLeft: sidebarW }}>

        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between px-6 h-14 bg-white"
          style={{ borderBottom: '1px solid #e2e8f0' }}>
          <div />
          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: '#2563eb', color: '#fff' }}>
              {businessName.charAt(0).toUpperCase() || 'N'}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
