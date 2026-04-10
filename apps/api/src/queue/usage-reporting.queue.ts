/**
 * Usage Reporting Worker — runs daily, checks for billing periods that have
 * ended, and reports overage usage to Stripe for invoicing.
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

usageReportingQueue.process(async () => {
  // Find all active clients with Stripe subscriptions
  const clients = await prisma.client.findMany({
    where: { status: 'ACTIVE', stripeSubId: { not: null } },
    select: { id: true, plan: true, stripeSubId: true, stripeCustomerId: true }
  })

  if (clients.length === 0) return

  logger.info(`Usage reporting: checking ${clients.length} active clients`)

  for (const client of clients) {
    try {
      if (!client.stripeSubId) continue

      // Get the subscription's billing period
      const period = await stripeService.getSubscriptionPeriod(client.stripeSubId)
      if (!period) continue

      // Only report if the period has ended (or is about to end — within 1 hour)
      const now = new Date()
      const hourFromNow = new Date(now.getTime() + 60 * 60 * 1000)
      if (period.periodEnd > hourFromNow) continue

      // Get the usage summary for this client
      const summary = await getUsageSummary(client.id)
      if (!summary || summary.totalOverageCost <= 0) continue

      // Report each overage to Stripe
      // The overage subscription item IDs should be stored on the client
      // For now, log what would be reported — actual Stripe item IDs need
      // to be configured per client when overage metered prices are set up
      logger.info('Usage overage detected', {
        clientId: client.id,
        plan: client.plan,
        totalOverageCost: summary.totalOverageCost,
        items: summary.items.filter(i => i.overage > 0).map(i => ({
          type: i.type,
          used: i.used,
          limit: i.limit,
          overage: i.overage,
          cost: i.overageCost
        }))
      })

      // TODO: Once Stripe metered prices are created and item IDs are stored,
      // uncomment this to actually report usage:
      //
      // for (const item of summary.items) {
      //   if (item.overage <= 0) continue
      //   const subItemId = clientOverageItems[item.type]
      //   if (subItemId) {
      //     await stripeService.reportOverageUsage(subItemId, item.overage)
      //   }
      // }

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
