'use client'

import { useState } from 'react'
import Link from 'next/link'
import axios from 'axios'
import AgentStatusBadge from './AgentStatusBadge'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface AgentDeployment {
  id: string
  agentType: string
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED' | 'ERROR'
  metrics?: {
    totalLeads?: number
    leadsToday?: number
    callsMade?: number
    appointmentsBooked?: number
    emailsSent?: number
    appointmentsToday?: number
  }
  updatedAt: string
}

interface AgentCardProps {
  agent: AgentDeployment
  onStatusChange?: (agentId: string, newStatus: string) => void
  showConfigure?: boolean
}

const agentConfig: Record<string, {
  label: string
  icon: string
  metricLabel: string
  metricKey: string
  accent: string
  glow: string
}> = {
  LEAD_GENERATION:    { label: 'Lead Generation',    icon: '◎', metricLabel: 'Leads today',        metricKey: 'leadsToday',        accent: '#38bdf8', glow: 'rgba(56,189,248,0.15)' },
  LINKEDIN_OUTREACH:  { label: 'LinkedIn Outreach',  icon: '⟡', metricLabel: 'Connections sent',   metricKey: 'connectionsSent',   accent: '#6366f1', glow: 'rgba(99,102,241,0.15)' },
  SOCIAL_MEDIA:       { label: 'Social Media',       icon: '◈', metricLabel: 'Posts published',    metricKey: 'postsPublished',    accent: '#f472b6', glow: 'rgba(244,114,182,0.15)' },
  SOCIAL_ENGAGEMENT:  { label: 'Social Engagement',  icon: '◇', metricLabel: 'Replies sent',       metricKey: 'repliesSent',       accent: '#c084fc', glow: 'rgba(192,132,252,0.15)' },
  ADVERTISING:        { label: 'Advertising',        icon: '▲', metricLabel: 'Ads optimised',      metricKey: 'adsOptimised',      accent: '#fb923c', glow: 'rgba(251,146,60,0.15)'  },
  APPOINTMENT_SETTER: { label: 'Appointment Setter', icon: '◻', metricLabel: 'Appointments today', metricKey: 'appointmentsToday', accent: '#34d399', glow: 'rgba(52,211,153,0.15)'  },
  VOICE_INBOUND:      { label: 'Voice Inbound',      icon: '⊙', metricLabel: 'Calls answered',     metricKey: 'callsAnswered',     accent: '#818cf8', glow: 'rgba(129,140,248,0.15)' },
  VOICE_OUTBOUND:     { label: 'Voice Outbound',     icon: '⊚', metricLabel: 'Calls made',         metricKey: 'callsMade',         accent: '#a78bfa', glow: 'rgba(167,139,250,0.15)' },
  VOICE_CLOSER:       { label: 'Voice Closer',       icon: '◆', metricLabel: 'Deals closed',       metricKey: 'dealsClosed',       accent: '#e879f9', glow: 'rgba(232,121,249,0.15)' },
  CLIENT_SERVICES:    { label: 'Client Services',    icon: '◉', metricLabel: 'Clients helped',     metricKey: 'clientsHelped',     accent: '#2dd4bf', glow: 'rgba(45,212,191,0.15)'  }
}

export default function AgentCard({ agent, onStatusChange, showConfigure }: AgentCardProps) {
  const [toggling, setToggling] = useState(false)
  const config = agentConfig[agent.agentType] || {
    label: agent.agentType.replace(/_/g, ' '),
    icon: '◌',
    metricLabel: 'Actions',
    metricKey: 'totalLeads',
    accent: '#6366f1',
    glow: 'rgba(99,102,241,0.15)'
  }

  const metricValue = (agent.metrics as Record<string, number | undefined> | undefined)?.[config.metricKey] || 0

  async function handleToggle() {
    setToggling(true)
    const token = localStorage.getItem('token') || ''
    const action = agent.status === 'ACTIVE' ? 'pause' : 'resume'
    try {
      await axios.post(`${API_URL}/agents/${agent.id}/${action}`, {}, { headers: { Authorization: `Bearer ${token}` } })
      const newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE'
      onStatusChange?.(agent.id, newStatus)
    } catch (err) {
      console.error('Failed to toggle agent:', err)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div
      className="relative rounded-2xl overflow-hidden transition-all duration-300 group cursor-default"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.10)`
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'
      }}
    >
      {/* Colored accent line at top */}
      <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, ${config.accent}, transparent)` }} />

      {/* Ambient glow */}
      <div
        className="absolute top-0 left-0 right-0 h-24 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `radial-gradient(ellipse 70% 60% at 20% 0%, ${config.glow} 0%, transparent 70%)` }}
      />

      <div className="relative p-5">
        {/* Header row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0"
              style={{ background: `${config.accent}18`, border: `1px solid ${config.accent}28`, color: config.accent }}
            >
              {config.icon}
            </div>
            <AgentStatusBadge status={agent.status} size="sm" />
          </div>

          {/* Toggle switch */}
          <button
            onClick={handleToggle}
            disabled={toggling || agent.status === 'ERROR' || agent.status === 'INACTIVE'}
            className="relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-200 focus:outline-none disabled:opacity-40"
            style={{
              background: agent.status === 'ACTIVE' ? config.accent : 'rgba(255,255,255,0.10)',
              boxShadow: agent.status === 'ACTIVE' ? `0 0 10px ${config.glow}` : 'none'
            }}
            title={agent.status === 'ACTIVE' ? 'Pause agent' : 'Resume agent'}
          >
            <span
              className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: agent.status === 'ACTIVE' ? 'translateX(18px)' : 'translateX(3px)' }}
            />
          </button>
        </div>

        {/* Agent name */}
        <h3 className="text-sm font-semibold text-white mb-4">{config.label} Agent</h3>

        {/* Metrics */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.30)' }}>
              {config.metricLabel}
            </p>
            <p className="num text-2xl font-bold text-white" style={{ letterSpacing: '-0.02em' }}>
              {metricValue.toLocaleString()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.25)' }}>Total leads</p>
            <p className="num text-base font-semibold" style={{ color: 'rgba(255,255,255,0.65)' }}>
              {(agent.metrics?.totalLeads || 0).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.22)' }}>
            {new Date(agent.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
          </p>
          {showConfigure && (
            <Link
              href={`/dashboard/agents/${agent.id}/configure`}
              className="text-xs font-medium transition-colors"
              style={{ color: config.accent }}
            >
              Configure →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
