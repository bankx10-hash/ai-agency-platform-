import Bull from 'bull'
import { prisma } from '../lib/prisma'
import { socialService } from '../services/social.service'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'
import { randomUUID } from 'crypto'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const socialAnalyticsQueue = new Bull('social-analytics', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 10,
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 }
  }
})

socialAnalyticsQueue.process(async () => {
  // Find all clients with active SOCIAL_MEDIA agent deployments
  const deployments = await prisma.agentDeployment.findMany({
    where: { agentType: 'SOCIAL_MEDIA', status: 'ACTIVE' },
    select: { clientId: true }
  })

  const clientIds = [...new Set(deployments.map(d => d.clientId))]
  if (clientIds.length === 0) return

  logger.info(`Refreshing social analytics for ${clientIds.length} clients`)

  for (const clientId of clientIds) {
    try {
      await refreshClientAnalytics(clientId)
      // Stagger requests: 2-second delay between clients to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (err) {
      logger.error('Failed to refresh analytics for client', { clientId, error: err })
    }
  }
})

async function refreshClientAnalytics(clientId: string): Promise<void> {
  const creds = await prisma.clientCredential.findMany({ where: { clientId } })
  const metaCred = creds.find(c => c.service === 'meta' || c.service === 'facebook')
  const instagramCred = creds.find(c => c.service === 'instagram')

  if (metaCred) {
    try {
      const config = decryptJSON<Record<string, string>>(metaCred.credentials)
      const igConfig = instagramCred ? decryptJSON<Record<string, string>>(instagramCred.credentials) : config
      const pageId = config.pageId || config.meta_page_id
      const accessToken = config.accessToken || config.meta_access_token
      const igUserId = igConfig.igUserId || igConfig.instagramUserId || config.instagram_user_id

      if (pageId && accessToken) {
        // Facebook page insights
        const fbMetrics = ['page_impressions', 'page_engaged_users', 'page_fans']
        for (const metric of fbMetrics) {
          try {
            const values = await socialService.getPageInsights(pageId, accessToken, metric)
            for (const v of values) {
              await prisma.platformInsight.upsert({
                where: {
                  clientId_platform_metric_period_endTime: {
                    clientId,
                    platform: 'FACEBOOK',
                    metric,
                    period: 'day',
                    endTime: new Date(v.end_time)
                  }
                },
                create: {
                  id: randomUUID(),
                  clientId,
                  platform: 'FACEBOOK',
                  metric,
                  period: 'day',
                  value: v.value,
                  endTime: new Date(v.end_time),
                  fetchedAt: new Date()
                },
                update: {
                  value: v.value,
                  fetchedAt: new Date()
                }
              })
            }
          } catch (err) {
            logger.warn(`Failed to fetch FB metric ${metric}`, { clientId, error: err })
          }
        }

        // Instagram insights
        if (igUserId) {
          const igMetrics = ['impressions', 'reach', 'follower_count']
          for (const metric of igMetrics) {
            try {
              const values = await socialService.getInstagramInsights(igUserId, accessToken, metric)
              for (const v of values) {
                await prisma.platformInsight.upsert({
                  where: {
                    clientId_platform_metric_period_endTime: {
                      clientId,
                      platform: 'INSTAGRAM',
                      metric,
                      period: 'day',
                      endTime: new Date(v.end_time)
                    }
                  },
                  create: {
                    id: randomUUID(),
                    clientId,
                    platform: 'INSTAGRAM',
                    metric,
                    period: 'day',
                    value: v.value,
                    endTime: new Date(v.end_time),
                    fetchedAt: new Date()
                  },
                  update: {
                    value: v.value,
                    fetchedAt: new Date()
                  }
                })
              }
            } catch (err) {
              logger.warn(`Failed to fetch IG metric ${metric}`, { clientId, error: err })
            }
          }
        }
      }
    } catch (err) {
      logger.error('Failed to parse Meta credentials', { clientId, error: err })
    }
  }

  // Refresh per-post analytics for published posts less than 7 days old
  const recentPosts = await prisma.scheduledPost.findMany({
    where: {
      clientId,
      status: 'PUBLISHED',
      publishedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      externalPostId: { not: null }
    }
  })

  if (recentPosts.length > 0 && metaCred) {
    const config = decryptJSON<Record<string, string>>(metaCred.credentials)
    const accessToken = config.accessToken || config.meta_access_token

    for (const post of recentPosts) {
      try {
        await refreshPostAnalytics(post.id, post.externalPostId!, post.platform, accessToken)
      } catch (err) {
        logger.warn('Failed to refresh post analytics', { postId: post.id, error: err })
      }
    }
  }
}

async function refreshPostAnalytics(
  postId: string,
  externalPostId: string,
  platform: string,
  accessToken: string
): Promise<void> {
  // For Facebook/Instagram, fetch post insights via Graph API
  if (platform === 'FACEBOOK' || platform === 'INSTAGRAM') {
    const metaClient = socialService['getMetaClient'](accessToken)
    const metricParam = platform === 'FACEBOOK'
      ? 'post_impressions,post_engaged_users,post_clicks'
      : 'impressions,reach,engagement'

    try {
      const response = await metaClient.get(`/${externalPostId}/insights`, {
        params: { metric: metricParam }
      })

      const metricsData = response.data.data || []
      const analytics: Record<string, number> = {}
      for (const m of metricsData) {
        const value = m.values?.[0]?.value || 0
        analytics[m.name] = typeof value === 'object' ? Object.values(value).reduce((a: number, b: unknown) => a + (Number(b) || 0), 0) : value
      }

      await prisma.postAnalytics.upsert({
        where: { postId },
        create: {
          id: randomUUID(),
          postId,
          impressions: analytics.post_impressions || analytics.impressions || 0,
          reach: analytics.reach || 0,
          engagements: analytics.post_engaged_users || analytics.engagement || 0,
          rawData: response.data,
          fetchedAt: new Date()
        },
        update: {
          impressions: analytics.post_impressions || analytics.impressions || 0,
          reach: analytics.reach || 0,
          engagements: analytics.post_engaged_users || analytics.engagement || 0,
          rawData: response.data,
          fetchedAt: new Date()
        }
      })
    } catch (err) {
      logger.warn('Failed to fetch post insights from API', { postId, externalPostId, error: err })
    }
  }
}

// Schedule recurring refresh every 4 hours
export function startSocialAnalyticsScheduler(): void {
  socialAnalyticsQueue.add({}, {
    repeat: { every: 4 * 60 * 60 * 1000 }
  })
  logger.info('Social analytics scheduler started (every 4 hours)')
}
