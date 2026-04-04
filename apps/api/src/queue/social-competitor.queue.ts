import Bull from 'bull'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'
import { randomUUID } from 'crypto'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const socialCompetitorQueue = new Bull('social-competitor', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 10,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 }
  }
})

socialCompetitorQueue.process(async () => {
  const competitors = await prisma.competitor.findMany({
    where: { isActive: true }
  })

  if (competitors.length === 0) return

  logger.info(`Fetching competitor data for ${competitors.length} competitors`)

  for (const competitor of competitors) {
    try {
      // For now, create a placeholder snapshot.
      // When automated fetching is enabled, this will call the competitor service
      // to scrape/API-fetch public profile data.
      //
      // Instagram: Use Business Discovery API
      //   GET /{igUserId}?fields=business_discovery.fields(followers_count,media_count,media{like_count,comments_count})&username={handle}
      // Facebook: Use public page data
      //   GET /{pageId}?fields=fan_count,talking_about_count
      // LinkedIn: Use Company API
      //   GET /organizations/{id}?fields=followerCount

      // Check if we already have a snapshot for today
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const existing = await prisma.competitorSnapshot.findFirst({
        where: {
          competitorId: competitor.id,
          fetchedAt: { gte: today }
        }
      })

      if (existing) {
        logger.debug('Competitor snapshot already exists for today', { competitorId: competitor.id })
        continue
      }

      // TODO: Replace with actual API calls when competitor.service.ts is integrated
      await prisma.competitorSnapshot.create({
        data: {
          id: randomUUID(),
          competitorId: competitor.id,
          fetchedAt: new Date()
        }
      })

      logger.info('Competitor snapshot created', {
        competitorId: competitor.id,
        name: competitor.name,
        platform: competitor.platform
      })
    } catch (err) {
      logger.error('Failed to fetch competitor data', { competitorId: competitor.id, error: err })
    }
  }
})

// Schedule daily at 3 AM UTC
export function startSocialCompetitorScheduler(): void {
  socialCompetitorQueue.add({}, {
    repeat: { cron: '0 3 * * *' }
  })
  logger.info('Social competitor scheduler started (daily at 3 AM UTC)')
}
