'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'

/**
 * Dashboard layout — syncs the NextAuth session accessToken into localStorage
 * so all dashboard pages that read `localStorage.getItem('token')` work after
 * a normal login (not just after signup which is the only place the token was
 * previously written to localStorage).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()

  useEffect(() => {
    const token = (session as { accessToken?: string })?.accessToken
    if (token) {
      localStorage.setItem('token', token)
    }
  }, [session])

  return <>{children}</>
}
