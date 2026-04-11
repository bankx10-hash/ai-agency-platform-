'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from '../theme'
import NotificationBell from '../../components/NotificationBell'
// ── Icon helpers ──────────────────────────────────────────────────────────────
function Icon({ d, d2 }: { d: string; d2?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] flex-shrink-0">
      <path d={d} />
      {d2 && <path d={d2} />}
    </svg>
  )
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

// ── Nav structure ─────────────────────────────────────────────────────────────
type NavItem =
  | { type: 'link';  href: string; label: string; exact?: boolean; icon: React.ReactNode }
  | { type: 'group'; href: string; label: string; icon: React.ReactNode; children: { href: string; label: string }[] }

// Sections hidden per plan — if a plan key is missing, nothing is hidden (show all)
const PLAN_HIDDEN_SECTIONS: Record<string, Set<string>> = {
  AI_RECEPTIONIST: new Set([
    '/dashboard/social',
    '/dashboard/marketing',
    '/dashboard/workflows',
    '/dashboard/voice/outbound',
  ]),
  STARTER: new Set([
    '/dashboard/social',
    '/dashboard/marketing',
    '/dashboard/workflows',
  ]),
  GROWTH: new Set([
    '/dashboard/workflows',
  ]),
  // AGENCY: nothing hidden — sees everything
}

const NAV: NavItem[] = [
  {
    type: 'link', exact: true,
    href: '/dashboard', label: 'Dashboard',
    icon: <Icon d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
  },
  {
    type: 'link',
    href: '/dashboard/agents', label: 'Agents',
    icon: <Icon d="M12 4a4 4 0 014 4v1h1a2 2 0 012 2v3a2 2 0 01-2 2h-1v1a4 4 0 01-8 0v-1H7a2 2 0 01-2-2V11a2 2 0 012-2h1V8a4 4 0 014-4z" />
  },
  {
    type: 'link',
    href: '/dashboard/analytics', label: 'Analytics',
    icon: <Icon d="M3 3v18h18" d2="M7 16l4-4 4 4 4-4" />
  },
  {
    type: 'group',
    href: '/dashboard/crm', label: 'CRM',
    icon: <Icon d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />,
    children: [
      { href: '/dashboard/crm/contacts',  label: 'Contacts'  },
      { href: '/dashboard/crm/pipeline',  label: 'Pipeline'  },
      { href: '/dashboard/crm/tasks',     label: 'Tasks'     },
      { href: '/dashboard/crm/sequences', label: 'Sequences' },
      { href: '/dashboard/crm/reports',   label: 'Reports'   },
    ]
  },
  {
    type: 'group',
    href: '/dashboard/voice', label: 'Voice',
    icon: <Icon d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />,
    children: [
      { href: '/dashboard/voice',          label: 'Overview' },
      { href: '/dashboard/voice/inbound',  label: 'Inbound'  },
      { href: '/dashboard/voice/outbound', label: 'Outbound' },
    ]
  },
  {
    type: 'group',
    href: '/dashboard/marketing', label: 'Marketing',
    icon: <Icon d="M22 12h-4l-3 9L9 3l-3 9H2" />,
    children: [
      { href: '/dashboard/marketing/campaigns', label: 'Campaigns' },
      { href: '/dashboard/marketing/funnels',   label: 'Funnels'   },
    ]
  },
  {
    type: 'group',
    href: '/dashboard/social', label: 'Social',
    icon: <Icon d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />,
    children: [
      { href: '/dashboard/social/posts',       label: 'Posts'       },
      { href: '/dashboard/social/calendar',    label: 'Calendar'    },
      { href: '/dashboard/social/analytics',   label: 'Analytics'   },
      { href: '/dashboard/social/competitors', label: 'Competitors' },
      { href: '/dashboard/social/news',        label: 'News'        },
    ]
  },
  {
    type: 'link',
    href: '/dashboard/workflows', label: 'Workflows',
    icon: <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" d2="M9 14l2 2 4-4" />
  },
  {
    type: 'link',
    href: '/dashboard/inbox', label: 'Inbox',
    icon: <Icon d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" d2="M22 6l-10 7L2 6" />
  },
  {
    type: 'link',
    href: '/dashboard/sms', label: 'SMS',
    icon: <Icon d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  },
  {
    type: 'link',
    href: '/dashboard/connections', label: 'Connections',
    icon: <Icon d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  },
  {
    type: 'link',
    href: '/dashboard/usage', label: 'Usage',
    icon: <Icon d="M16 8v8H8V8h8m2-2H6v12h12V6zM4 4v16h16V4H4zm14 18H6a2 2 0 01-2-2V4a2 2 0 012-2h12a2 2 0 012 2v16a2 2 0 01-2 2z" />
  },
  {
    type: 'link',
    href: '/dashboard/settings', label: 'Settings',
    icon: <Icon d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  },
]

// ── Nav link styles ───────────────────────────────────────────────────────────
function navItemStyle(active: boolean) {
  return {
    color:      active ? '#fff'                        : 'rgba(255,255,255,0.45)',
    background: active ? 'rgba(59,130,246,0.20)'       : 'transparent',
    borderLeft: active ? '3px solid #3b82f6'           : '3px solid transparent',
  }
}

// ── Single nav link ───────────────────────────────────────────────────────────
function NavLink({ href, label, icon, exact, collapsed, pathname }: {
  href: string; label: string; icon: React.ReactNode
  exact?: boolean; collapsed: boolean; pathname: string
}) {
  const active = exact ? pathname === href : pathname === href
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className="flex items-center gap-3 mx-2 mb-0.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150"
      style={navItemStyle(active)}
    >
      <span style={{ color: active ? '#3b82f6' : 'rgba(255,255,255,0.38)' }}>{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )
}

// ── Group (with dropdown) ─────────────────────────────────────────────────────
function NavGroup({ item, collapsed, pathname }: {
  item: Extract<NavItem, { type: 'group' }>
  collapsed: boolean
  pathname: string
}) {
  const anyChildActive = item.children.some(c => pathname.startsWith(c.href))
  const parentActive   = pathname === item.href
  const groupActive    = anyChildActive || parentActive

  // Auto-open if a child is active
  const [open, setOpen] = useState(anyChildActive)

  // Re-sync when pathname changes
  useEffect(() => {
    if (anyChildActive) setOpen(true)
  }, [anyChildActive])

  return (
    <div className="mx-2 mb-0.5">
      {/* Group header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150"
        style={navItemStyle(groupActive)}
      >
        <span style={{ color: groupActive ? '#3b82f6' : 'rgba(255,255,255,0.38)' }}>{item.icon}</span>
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{item.label}</span>
            <ChevronDown open={open} />
          </>
        )}
      </button>

      {/* Children */}
      {!collapsed && open && (
        <div className="mt-0.5 ml-4 pl-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
          {item.children.map(child => {
            const childActive = pathname.startsWith(child.href)
            return (
              <Link
                key={child.href}
                href={child.href}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 mb-0.5"
                style={{
                  color:      childActive ? '#fff'                  : 'rgba(255,255,255,0.38)',
                  background: childActive ? 'rgba(59,130,246,0.15)' : 'transparent',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: childActive ? '#3b82f6' : 'rgba(255,255,255,0.20)' }}
                />
                {child.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const { theme, toggle: toggleTheme } = useTheme()
  const [businessName, setBusinessName] = useState('')
  const [clientPlan, setClientPlan] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const token = (session as { accessToken?: string })?.accessToken
    if (token) localStorage.setItem('token', token)
    const name = (session?.user as { businessName?: string })?.businessName || session?.user?.name || ''
    setBusinessName(name)
    // Load plan from session or localStorage
    const plan = (session?.user as { plan?: string })?.plan || localStorage.getItem('clientPlan') || ''
    if (plan) {
      setClientPlan(plan)
      localStorage.setItem('clientPlan', plan)
    }
  }, [session])

  // Filter nav based on plan — hide sections the plan doesn't include
  const hiddenSections = PLAN_HIDDEN_SECTIONS[clientPlan] || new Set()
  const filteredNav = NAV.filter(item => {
    if (hiddenSections.has(item.href)) return false
    // For groups (e.g. Voice), filter out hidden children
    if (item.type === 'group' && 'children' in item) {
      item = { ...item, children: item.children.filter(c => !hiddenSections.has(c.href)) }
    }
    return true
  }).map(item => {
    // Re-filter group children (the filter above creates a shallow copy)
    if (item.type === 'group' && 'children' in item) {
      return { ...item, children: item.children.filter(c => !hiddenSections.has(c.href)) }
    }
    return item
  })

  const sidebarW = collapsed ? 64 : 224

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-page)' }}>

      {/* ── Sidebar ── */}
      <aside
        className="fixed top-0 left-0 bottom-0 z-40 flex flex-col transition-all duration-200"
        style={{ width: sidebarW, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-sidebar)' }}
      >
        {/* Logo + collapse */}
        <div className="flex items-center px-4 h-14 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-sidebar)' }}>
          <img src="/nodus-logo.jpeg" alt="Nodus" className="h-6 w-6 rounded object-cover flex-shrink-0" />
          {!collapsed && <span className="ml-2.5 text-sm font-bold text-white truncate">Nodus AI</span>}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="ml-auto p-1 rounded transition-colors flex-shrink-0"
            style={{ color: 'rgba(255,255,255,0.30)' }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#fff'; el.style.background = 'rgba(255,255,255,0.08)' }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'rgba(255,255,255,0.30)'; el.style.background = 'transparent' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              {collapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6"/>
                : <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6"/>
              }
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
          {filteredNav.map(item => {
            if (item.type === 'link') {
              return <NavLink key={item.href} {...item} collapsed={collapsed} pathname={pathname} />
            }
            return <NavGroup key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          })}
        </nav>

        {/* Footer: theme toggle + user */}
        <div className="px-3 py-3 flex-shrink-0 flex flex-col gap-2" style={{ borderTop: '1px solid var(--border-sidebar)' }}>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 w-full"
            style={{ color: 'rgba(255,255,255,0.45)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] flex-shrink-0">
              {theme === 'dark'
                ? <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                : <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              }
            </svg>
            {!collapsed && <span className="truncate">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>
          {/* User */}
          <div className="flex items-center gap-2.5 px-3">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: '#2563eb', color: '#fff' }}>
              {businessName.charAt(0).toUpperCase() || 'N'}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{businessName || 'My Business'}</p>
                <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.30)' }}>Admin</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-col flex-1 transition-all duration-200" style={{ marginLeft: sidebarW }}>

        {/* Top bar with notification bell */}
        <div className="flex items-center justify-end px-6 py-3" style={{ borderBottom: '1px solid var(--border-card, #e5e7eb)' }}>
          <NotificationBell />
        </div>

        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
