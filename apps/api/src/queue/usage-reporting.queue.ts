/**
 * Usage Reporting Worker — runs every 6 hours, checks for clients with
 * overage usage, and reports it to Stripe for metered billing.
 */

import Bull from 'bull'
import { prisma } from '../lib/prisma'
import { getUsageSummary } from '../services/usage.service'
import { stripeService } from '../services/stripe.service'
import { logger } from '../utils/logger'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const usageReportingQueue = new Bull('usage-reporting', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 10,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 }
  }
})

/** Map UsageType keys to the Stripe overage item keys from addOverageItems() */
const USAGE_TO_STRIPE_KEY: Record<string, string> = {
  VOICE_MINUTES: 'VOICE_MINUTES',
  AI_ACTIONS: 'AI_ACTIONS',
  SMS: 'SMS',
  EMAILS: 'EMAILS',
  SOCIAL_POSTS: 'SOCIAL_POSTS',
  APOLLO_PROSPECTS: 'APOLLO_PROSPECTS'
}

usageReportingQueue.process(async () => {
  const clients = await prisma.client.findMany({
    where: { status: 'ACTIVE', stripeSubId: { not: null } },
    select: { id: true, plan: true, stripeSubId: true, stripeCustomerId: true }
  })

  if (clients.length === 0) return

  logger.info(`Usage reporting: checking ${clients.length} active clients`)

  for (const client of clients) {
    try {
      if (!client.stripeSubId) continue

      // Get usage summary for this client
      const summary = await getUsageSummary(client.id)
      if (!summary || summary.totalOverageCost <= 0) continue

      // Load the Stripe overage subscription item IDs for this client
      const overageCred = await prisma.clientCredential.findFirst({
        where: { clientId: client.id, service: 'stripe-overage-items' }
      })
      if (!overageCred) {
        logger.warn('No overage items configured for client — skipping Stripe reporting', { clientId: client.id })

        // Try to add overage items now (may have been missed during checkout)
        try {
          const overageItems = await stripeService.addOverageItems(client.stripeSubId)
          if (Object.keys(overageItems).length > 0) {
            await prisma.clientCredential.upsert({
              where: { id: `stripe-overage-${client.id}` },
              update: { credentials: JSON.stringify(overageItems) },
              create: { id: `stripe-overage-${client.id}`, clientId: client.id, service: 'stripe-overage-items', credentials: JSON.stringify(overageItems) }
            })
            logger.info('Late-added overage items to subscription', { clientId: client.id })
          }
        } catch (addErr) {
          logger.warn('Failed to late-add overage items', { clientId: client.id, err: String(addErr) })
        }
        continue
      }

      let overageItemMap: Record<string, string> = {}
      try {
        overageItemMap = JSON.parse(overageCred.credentials)
      } catch {
        logger.warn('Invalid overage items JSON', { clientId: client.id })
        continue
      }

      // Report each overage to Stripe
      let reported = 0
      for (const item of summary.items) {
        if (item.overage <= 0) continue

        const stripeKey = USAGE_TO_STRIPE_KEY[item.type]
        const subItemId = stripeKey ? overageItemMap[stripeKey] : undefined

        if (!subItemId) {
          logger.warn('No Stripe subscription item for usage type', { clientId: client.id, type: item.type })
          continue
        }

        await stripeService.reportOverageUsage(subItemId, item.overage)
        reported++

        logger.info('Overage reported to Stripe', {
          clientId: client.id,
          type: item.type,
          overage: item.overage,
          cost: item.overageCost,
          subItemId
        })
      }

      if (reported > 0) {
        logger.info('Usage overage reported', {
          clientId: client.id,
          plan: client.plan,
          totalOverageCost: summary.totalOverageCost,
          itemsReported: reported
        })
      }

    } catch (err) {
      logger.error('Usage reporting failed for client', { clientId: client.id, err: String(err) })
    }
  }

  logger.info('Usage reporting run complete')
})

/**
 * Start the usage reporting scheduler. Runs every 6 hours.
 */
export function startUsageReportingScheduler(): void {
  usageReportingQueue.add({}, {
    repeat: { cron: '0 */6 * * *' },
    jobId: 'usage-reporting-cron'
  })
  logger.info('Usage reporting scheduler started (every 6 hours)')
}
