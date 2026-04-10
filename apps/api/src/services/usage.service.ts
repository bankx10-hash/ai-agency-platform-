/**
 * Usage tracking service — records every billable action per client per
 * billing period and provides summaries for the dashboard and Stripe
 * overage billing.
 *
 * RULES:
 * - recordUsage() is fire-and-forget — it must never block the main action
 * - The @@unique(sourceId, sourceType, usageType) constraint prevents
 *   double-counting on retries / webhook replays
 * - Billing period = 1st of the current month to simplify queries
 *   (Stripe period alignment happens at reporting time)
 */

import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'

// ── Types ────────────────────────────────────────────────────────────────────

export type UsageType =
  | 'VOICE_MINUTES'
  | 'AI_ACTIONS'
  | 'SMS'
  | 'EMAILS'
  | 'SOCIAL_POSTS'
  | 'APOLLO_PROSPECTS'

export interface UsageLineItem {
  type: UsageType
  label: string
  used: number
  limit: number
  overage: number
  overageRate: number
  overageCost: number
  percentUsed: number
}

export interface UsageSummary {
  clientId: string
  plan: string
  periodStart: string
  periodEnd: string
  items: UsageLineItem[]
  totalOverageCost: number
}

// ── Overage rates (1.5x premium) ─────────────────────────────────────────────

export const OVERAGE_RATES: Record<UsageType, number> = {
  VOICE_MINUTES: 0.35,
  AI_ACTIONS: 0.05,
  SMS: 0.10,
  EMAILS: 0.02,
  SOCIAL_POSTS: 0.75,
  APOLLO_PROSPECTS: 0.15
}

const USAGE_LABELS: Record<UsageType, string> = {
  VOICE_MINUTES: 'Voice Minutes',
  AI_ACTIONS: 'AI Actions',
  SMS: 'SMS Messages',
  EMAILS: 'Emails',
  SOCIAL_POSTS: 'Social Posts',
  APOLLO_PROSPECTS: 'Apollo Prospects'
}

const ALL_USAGE_TYPES: UsageType[] = [
  'VOICE_MINUTES', 'AI_ACTIONS', 'SMS', 'EMAILS', 'SOCIAL_POSTS', 'APOLLO_PROSPECTS'
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the 1st of the current month at midnight UTC. */
function currentPeriodStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Returns the 1st of next month at midnight UTC. */
function currentPeriodEnd(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/** Get the plan limits for a client. */
async function getPlanLimits(clientId: string): Promise<{ plan: string; limits: Record<string, number> } | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { plan: true }
  })
  if (!client) return null

  // Import PLANS dynamically to avoid circular deps at module load
  const { PLANS } = await import('../../../../packages/shared/types/agent.types')
  const planConfig = (PLANS as Record<string, { limits?: Record<string, number> }>)[client.plan]
  if (!planConfig?.limits) return { plan: client.plan, limits: {} }

  // Map camelCase limit keys to UsageType enum keys
  const keyMap: Record<string, UsageType> = {
    voiceMinutes: 'VOICE_MINUTES',
    aiActions: 'AI_ACTIONS',
    sms: 'SMS',
    emails: 'EMAILS',
    socialPosts: 'SOCIAL_POSTS',
    apolloProspects: 'APOLLO_PROSPECTS'
  }
  const limits: Record<string, number> = {}
  for (const [camelKey, usageKey] of Object.entries(keyMap)) {
    limits[usageKey] = (planConfig.limits as Record<string, number>)[camelKey] ?? 0
  }
  return { plan: client.plan, limits }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a billable action. Fire-and-forget — callers should `.catch(() => {})`.
 * The @@unique constraint silently prevents double-counting if the same
 * sourceId+sourceType+usageType is recorded twice.
 */
export async function recordUsage(
  clientId: string,
  usageType: UsageType,
  quantity: number,
  sourceId?: string,
  sourceType?: string
): Promise<void> {
  if (quantity <= 0) return
  try {
    const periodStart = currentPeriodStart()
    await prisma.$executeRaw`
      INSERT INTO "UsageRecord" ("id", "clientId", "usageType", "quantity", "billingPeriodStart", "sourceId", "sourceType", "createdAt")
      VALUES (
        ${`ur_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`},
        ${clientId},
        ${usageType}::"UsageType",
        ${quantity}::decimal,
        ${periodStart},
        ${sourceId || null},
        ${sourceType || null},
        NOW()
      )
      ON CONFLICT ("sourceId", "sourceType", "usageType") DO NOTHING
    `
  } catch (err) {
    // Log but never throw — usage tracking must not block the main action
    logger.warn('Usage record failed (non-fatal)', { clientId, usageType, quantity, err: String(err) })
  }
}

/**
 * Get a full usage summary for the current billing period.
 * Returns each resource's used/limit/overage/cost.
 */
export async function getUsageSummary(clientId: string): Promise<UsageSummary | null> {
  const planData = await getPlanLimits(clientId)
  if (!planData) return null

  const periodStart = currentPeriodStart()
  const periodEnd = currentPeriodEnd()

  // Aggregate usage per type for the current period
  const rows = await prisma.$queryRaw<Array<{ usageType: string; total: Prisma.Decimal | null }>>`
    SELECT "usageType", SUM("quantity") as total
    FROM "UsageRecord"
    WHERE "clientId" = ${clientId}
      AND "billingPeriodStart" = ${periodStart}
    GROUP BY "usageType"
  `
  const usageMap: Record<string, number> = {}
  for (const row of rows) {
    usageMap[row.usageType] = Number(row.total || 0)
  }

  const items: UsageLineItem[] = ALL_USAGE_TYPES.map(type => {
    const used = Math.round((usageMap[type] || 0) * 100) / 100
    const limit = planData.limits[type] || 0
    const overage = Math.max(0, Math.round((used - limit) * 100) / 100)
    const overageRate = OVERAGE_RATES[type]
    const overageCost = Math.round(overage * overageRate * 100) / 100
    const percentUsed = limit > 0 ? Math.round((used / limit) * 100) : (used > 0 ? 100 : 0)

    return { type, label: USAGE_LABELS[type], used, limit, overage, overageRate, overageCost, percentUsed }
  })

  const totalOverageCost = Math.round(items.reduce((sum, i) => sum + i.overageCost, 0) * 100) / 100

  return {
    clientId,
    plan: planData.plan,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    items,
    totalOverageCost
  }
}

/**
 * Get usage summaries for past billing periods (for trend charts).
 */
export async function getUsageHistory(
  clientId: string,
  months: number = 3
): Promise<Array<{ periodStart: string; items: Array<{ type: string; used: number }> }>> {
  const periods: Array<{ periodStart: string; items: Array<{ type: string; used: number }> }> = []
  const now = new Date()

  for (let i = months; i >= 1; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const rows = await prisma.$queryRaw<Array<{ usageType: string; total: Prisma.Decimal | null }>>`
      SELECT "usageType", SUM("quantity") as total
      FROM "UsageRecord"
      WHERE "clientId" = ${clientId}
        AND "billingPeriodStart" = ${start}
      GROUP BY "usageType"
    `
    periods.push({
      periodStart: start.toISOString(),
      items: rows.map(r => ({ type: r.usageType, used: Number(r.total || 0) }))
    })
  }

  return periods
}
