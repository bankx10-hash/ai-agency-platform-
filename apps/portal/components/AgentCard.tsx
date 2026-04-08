'use client'

import { useState } from 'react'
import Link from 'next/link'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface AgentDeployment {
  id: string; agentType: string
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED' | 'ERROR'
  metrics?: { totalLeads?: number; leadsToday?: number; callsMade?: number; appointmentsBooked?: number; emailsSent?: number; appointmentsToday?: number }
  updatedAt: string
}

interface AgentCardProps {
  agent: AgentDeployment
  onStatusChange?: (agentId: string, newStatus: string) => void
  onDelete?: (agentId: string) => void
  showConfigure?: boolean
}

const STATUS_DOT: Record<string, string> = {
  ACTIVE: '#22c55e', PAUSED: '#f59e0b', ERROR: '#ef4444', INACTIVE: '#94a3b8'
}
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active', PAUSED: 'Paused', ERROR: 'Error', INACTIVE: 'Inactive'
}

const AGENTS: Record<string, { label: string; metricLabel: string; metricKey: string; color: string; iconPath: string }> = {
  LEAD_GENERATION:    { label: 'Lead Generation',    metricLabel: 'Leads today',    metricKey: 'leadsToday',        color: '#2563eb', iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  B2B_OUTREACH:       { label: 'B2B Outreach',       metricLabel: 'Prospects sent', metricKey: 'emailsSent',        color: '#0ea5e9', iconPath: 'M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  SOCIAL_MEDIA:       { label: 'Social Media',       metricLabel: 'Posts',          metricKey: 'postsPublished',    color: '#e1306c', iconPath: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  SOCIAL_ENGAGEMENT:  { label: 'Social Engagement',  metricLabel: 'Replies',        metricKey: 'repliesSent',       color: '#7c3aed', iconPath: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  ADVERTISING:        { label: 'Advertising',        metricLabel: 'Ads optimised',  metricKey: 'adsOptimised',      color: '#ea580c', iconPath: 'M3 3v18h18M7 16l4-4 4 4 4-4' },
  APPOINTMENT_SETTER: { label: 'Appointment Setter', metricLabel: 'Appointments',   metricKey: 'appointmentsToday', color: '#059669', iconPath: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  VOICE_INBOUND:      { label: 'Voice Inbound',      metricLabel: 'Calls answered', metricKey: 'callsAnswered',     color: '#2563eb', iconPath: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z' },
  VOICE_OUTBOUND:     { label: 'Voice Outbound',     metricLabel: 'Calls made',     metricKey: 'callsMade',         color: '#7c3aed', iconPath: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z' },
  VOICE_CLOSER:       { label: 'Voice Closer',       metricLabel: 'Deals closed',   metricKey: 'dealsClosed',       color: '#db2777', iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  CLIENT_SERVICES:    { label: 'Client Services',    metricLabel: 'Clients helped', metricKey: 'clientsHelped',     color: '#0d9488', iconPath: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
}

export default function AgentCard({ agent, onStatusChange, onDelete, showConfigure }: AgentCardProps) {
  const [toggling, setToggling] = useState(false)
  const cfg = AGENTS[agent.agentType] ?? { label: agent.agentType.replace(/_/g, ' '), metricLabel: 'Actions', metricKey: 'totalLeads', color: '#2563eb', iconPath: 'M12 12m-9 0a9 9 0 1018 0 9 9 0 01-18 0' }
  const metricValue = (agent.metrics as Record<string, number | undefined> | undefined)?.[cfg.metricKey] ?? 0

  async function handleToggle() {
    setToggling(true)
    const action = agent.status === 'ACTIVE' ? 'pause' : 'resume'
    try {
      await axios.post(`${API_URL}/agents/${agent.id}/${action}`, {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } })
      onStatusChange?.(agent.id, action === 'pause' ? 'PAUSED' : 'ACTIVE')
    } catch { /* silent */ } finally { setToggling(false) }
  }

  return (
    <div className="theme-card rounded-xl p-4">
      {/* Top row: icon + name + toggle */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${cfg.color}15`, color: cfg.color }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d={cfg.iconPath} />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{cfg.label}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[agent.status] }} />
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{STATUS_LABEL[agent.status]}</span>
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={toggling || agent.status === 'ERROR' || agent.status === 'INACTIVE'}
          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 flex-shrink-0"
          style={{ background: agent.status === 'ACTIVE' ? cfg.color : 'var(--border-card)' }}
        >
          <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
            style={{ transform: agent.status === 'ACTIVE' ? 'translateX(18px)' : 'translateX(3px)' }} />
        </button>
      </div>

      {/* Metric row */}
      <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-card)' }}>
        <div>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{cfg.metricLabel}</p>
          <p className="num text-lg font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{metricValue.toLocaleString()}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Total</p>
          <p className="num text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{(agent.metrics?.totalLeads ?? 0).toLocaleString()}</p>
        </div>
        {showConfigure && (
          <Link href={`/dashboard/agents/${agent.id}/configure`} className="text-xs font-medium" style={{ color: cfg.color }}>
            Configure →
          </Link>
        )}
      </div>

      {/* Delete button */}
      {onDelete && (
        <button
          onClick={() => {
            if (confirm(`Delete "${cfg.label}" agent? This cannot be undone.`)) {
              onDelete(agent.id)
            }
          }}
          className="w-full mt-3 pt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
          style={{ borderTop: '1px solid var(--border-card)' }}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          Delete
        </button>
      )}
    </div>
  )
}
