import Bull from 'bull'
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'
import { randomUUID } from 'crypto'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const META_API = 'https://graph.facebook.com/v19.0'

export const socialCompetitorQueue = new Bull('social-competitor', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 10,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 }
  }
})

socialCompetitorQueue.process(async (job) => {
  // If specific competitorId passed, refresh just that one
  const specificId = job.data?.competitorId as string | undefined

  const competitors = specificId
    ? await prisma.competitor.findMany({ where: { id: specificId, isActive: true } })
    : await prisma.competitor.findMany({ where: { isActive: true } })

  if (competitors.length === 0) return

  logger.info(`Fetching competitor data for ${competitors.length} competitors`)

  for (const competitor of competitors) {
    try {
      // Check if we already have a snapshot for today (skip for manual refresh)
      if (!specificId) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const existing = await prisma.competitorSnapshot.findFirst({
          where: { competitorId: competitor.id, fetchedAt: { gte: today } }
        })
        if (existing) {
          logger.debug('Competitor snapshot already exists for today', { competitorId: competitor.id })
          continue
        }
      }

      // Get the client's Meta credentials (needed for Business Discovery API)
      const creds = await prisma.clientCredential.findMany({ where: { clientId: competitor.clientId } })
      const fbCred = creds.find(c => c.service === 'facebook')
      const igCred = creds.find(c => c.service === 'instagram')

      let snapshot: { followers?: number; posts?: number; avgLikes?: number; avgComments?: number; engagementRate?: number; recentPosts?: unknown[] } = {}

      if (competitor.platform === 'INSTAGRAM' && (igCred || fbCred)) {
        snapshot = await fetchInstagramCompetitor(competitor.handle, igCred || fbCred!)
      } else if (competitor.platform === 'FACEBOOK' && fbCred) {
        snapshot = await fetchFacebookCompetitor(competitor.handle, fbCred)
      } else {
        logger.warn('No credentials available for competitor fetch', {
          competitorId: competitor.id,
          platform: competitor.platform,
          hasIgCred: !!igCred,
          hasFbCred: !!fbCred
        })
      }

      await prisma.competitorSnapshot.create({
        data: {
          id: randomUUID(),
          competitorId: competitor.id,
          followers: snapshot.followers ?? null,
          posts: snapshot.posts ?? null,
          avgLikes: snapshot.avgLikes ?? null,
          avgComments: snapshot.avgComments ?? null,
          engagementRate: snapshot.engagementRate ?? null,
          recentPosts: snapshot.recentPosts ? JSON.parse(JSON.stringify(snapshot.recentPosts)) : null,
          fetchedAt: new Date()
        }
      })

      logger.info('Competitor snapshot created', {
        competitorId: competitor.id,
        name: competitor.name,
        platform: competitor.platform,
        followers: snapshot.followers
      })
    } catch (err) {
      logger.error('Failed to fetch competitor data', { competitorId: competitor.id, error: err })
    }
  }
})

async function fetchInstagramCompetitor(handle: string, cred: { credentials: string }): Promise<{
  followers?: number; posts?: number; avgLikes?: number; avgComments?: number; engagementRate?: number; recentPosts?: unknown[]
}> {
  const config = decryptJSON<Record<string, string>>(cred.credentials)
  const accessToken = config.accessToken || config.meta_access_token
  const igUserId = config.igUserId || config.instagramUserId || config.instagram_user_id

  if (!accessToken || !igUserId) {
    logger.warn('Missing Instagram credentials for competitor fetch')
    return {}
  }

  // Clean handle (remove @ if present)
  const username = handle.replace(/^@/, '')

  try {
    // Instagram Business Discovery API
    // Requires: instagram_basic permission on the client's IG account
    const response = await axios.get(`${META_API}/${igUserId}`, {
      params: {
        fields: `business_discovery.fields(followers_count,media_count,media.limit(12){like_count,comments_count,timestamp,caption,media_type}).username(${username})`,
        access_token: accessToken
      },
      timeout: 15000
    })

    const discovery = response.data.business_discovery
    if (!discovery) {
      logger.warn('No business_discovery data returned', { handle: username })
      return {}
    }

    const followers = discovery.followers_count || 0
    const mediaCount = discovery.media_count || 0
    const recentMedia = discovery.media?.data || []

    // Calculate average engagement
    let totalLikes = 0
    let totalComments = 0
    for (const post of recentMedia) {
      totalLikes += post.like_count || 0
      totalComments += post.comments_count || 0
    }
    const postCount = recentMedia.length || 1
    const avgLikes = Math.round(totalLikes / postCount)
    const avgComments = Math.round(totalComments / postCount)
    const engagementRate = followers > 0
      ? parseFloat(((totalLikes + totalComments) / postCount / followers).toFixed(4))
      : 0

    return {
      followers,
      posts: mediaCount,
      avgLikes,
      avgComments,
      engagementRate,
      recentPosts: recentMedia.slice(0, 6).map((p: Record<string, unknown>) => ({
        likes: p.like_count,
        comments: p.comments_count,
        timestamp: p.timestamp,
        type: p.media_type,
        caption: typeof p.caption === 'string' ? p.caption.substring(0, 100) : ''
      }))
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.error('Instagram Business Discovery API failed', {
        handle: username,
        status: err.response?.status,
        error: err.response?.data
      })
    }
    return {}
  }
}

async function fetchFacebookCompetitor(handle: string, cred: { credentials: string }): Promise<{
  followers?: number; posts?: number
}> {
  const config = decryptJSON<Record<string, string>>(cred.credentials)
  const accessToken = config.accessToken || config.meta_access_token

  if (!accessToken) return {}

  try {
    // Try to search for the page by name/handle
    const response = await axios.get(`${META_API}/${handle}`, {
      params: {
        fields: 'fan_count,talking_about_count,name',
        access_token: accessToken
      },
      timeout: 15000
    })

    return {
      followers: response.data.fan_count || 0,
      posts: response.data.talking_about_count || 0
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.error('Facebook page API failed', {
        handle,
        status: err.response?.status,
        error: err.response?.data
      })
    }
    return {}
  }
}

// Schedule daily at 3 AM UTC
export function startSocialCompetitorScheduler(): void {
  socialCompetitorQueue.add({}, {
    repeat: { cron: '0 3 * * *' }
  })
  logger.info('Social competitor scheduler started (daily at 3 AM UTC)')
}
