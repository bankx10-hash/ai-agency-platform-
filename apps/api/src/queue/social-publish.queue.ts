import Bull from 'bull'
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { socialService } from '../services/social.service'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const socialPublishQueue = new Bull('social-publish', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  }
})

socialPublishQueue.process(async (job) => {
  // Two modes:
  // 1. Specific postId in job data — immediate publish
  // 2. No postId — scheduled publish sweep

  if (job.data.postId) {
    await publishPost(job.data.postId)
    return
  }

  // Find all SCHEDULED posts whose scheduledAt has passed
  const duePosts = await prisma.scheduledPost.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: new Date() }
    },
    take: 10
  })

  if (duePosts.length === 0) return

  logger.info(`Publishing ${duePosts.length} scheduled posts`)

  for (const post of duePosts) {
    await publishPost(post.id)
  }
})

async function publishPost(postId: string): Promise<void> {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: postId },
    include: { client: true }
  })

  if (!post || (post.status !== 'SCHEDULED' && post.status !== 'PUBLISHING')) {
    logger.warn('Post not found or not in publishable state', { postId })
    return
  }

  // Mark as publishing
  await prisma.scheduledPost.update({
    where: { id: postId },
    data: { status: 'PUBLISHING' }
  })

  try {
    // Get credentials
    const creds = await prisma.clientCredential.findMany({
      where: { clientId: post.clientId }
    })
    const metaCred = creds.find(c => c.service === 'meta' || c.service === 'facebook')
    const instagramCred = creds.find(c => c.service === 'instagram')
    const linkedinCred = creds.find(c => c.service === 'linkedin')

    let externalPostId: string | undefined

    const fullText = buildPostText(post.content, post.hashtags as string[])

    logger.info('Publishing post', {
      postId,
      platform: post.platform,
      hasMetaCred: !!metaCred,
      hasInstagramCred: !!instagramCred,
      hasLinkedinCred: !!linkedinCred,
      metaService: metaCred?.service,
      imageUrl: post.imageUrl ? post.imageUrl.substring(0, 120) : 'EMPTY/NULL',
      imageUrlLength: post.imageUrl?.length ?? 0,
    })

    switch (post.platform) {
      case 'FACEBOOK': {
        if (!metaCred) throw new Error('No Meta credentials found')
        const metaConfig = decryptJSON<Record<string, string>>(metaCred.credentials)
        const result = await socialService.postToMeta({
          pageId: metaConfig.pageId || metaConfig.meta_page_id,
          message: fullText,
          accessToken: metaConfig.accessToken || metaConfig.meta_access_token,
          imageUrl: (post.imageUrl && post.imageUrl.trim() && !post.imageUrl.startsWith('data:')) ? post.imageUrl.trim() : undefined
        })
        externalPostId = result.id
        break
      }
      case 'INSTAGRAM': {
        // Instagram credentials are stored separately (service: 'instagram')
        const igCred = instagramCred || metaCred
        if (!igCred) throw new Error('No Instagram credentials found')
        const igConfig = decryptJSON<Record<string, string>>(igCred.credentials)

        // Instagram REQUIRES an image — reject data URLs and empty URLs
        const igImageUrl = (post.imageUrl && post.imageUrl.trim() && !post.imageUrl.startsWith('data:'))
          ? post.imageUrl.trim()
          : null
        if (!igImageUrl) {
          throw new Error('Instagram requires a publicly accessible image URL. The current image is either missing, empty, or a data URL. Please regenerate the image.')
        }

        logger.info('Publishing to Instagram', { postId, igUserId: igConfig.igUserId, imageUrl: igImageUrl.substring(0, 100) })

        const result = await socialService.postToInstagram({
          igUserId: igConfig.igUserId || igConfig.instagramUserId || igConfig.instagram_user_id,
          accessToken: igConfig.accessToken || igConfig.meta_access_token,
          caption: fullText,
          imageUrl: igImageUrl
        })
        externalPostId = result.id
        break
      }
      case 'LINKEDIN': {
        if (!linkedinCred) throw new Error('No LinkedIn credentials found')
        const liConfig = decryptJSON<Record<string, string>>(linkedinCred.credentials)
        const result = await socialService.postToLinkedIn({
          accessToken: liConfig.accessToken || liConfig.linkedin_access_token,
          personId: liConfig.personId || liConfig.linkedin_person_id,
          organizationId: liConfig.organizationId || liConfig.linkedin_organization_id,
          text: fullText
        })
        externalPostId = result.id
        break
      }
      default:
        throw new Error(`Unsupported platform: ${post.platform}`)
    }

    await prisma.scheduledPost.update({
      where: { id: postId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        externalPostId
      }
    })

    logger.info('Post published successfully', { postId, platform: post.platform, externalPostId })
  } catch (err: unknown) {
    // Capture detailed error from Meta/platform API
    let errorMessage = 'Unknown error'
    let errorDetail: unknown = undefined
    if (axios.isAxiosError(err)) {
      errorMessage = `${err.response?.status || 'network'}: ${JSON.stringify(err.response?.data) || err.message}`
      errorDetail = err.response?.data
    } else if (err instanceof Error) {
      errorMessage = err.message
    }
    await prisma.scheduledPost.update({
      where: { id: postId },
      data: { status: 'FAILED', errorMessage: errorMessage.substring(0, 500) }
    })
    logger.error('Failed to publish post', { postId, platform: post.platform, error: errorMessage, detail: errorDetail })
  }
}

function buildPostText(content: string, hashtags: string[]): string {
  if (!hashtags || !Array.isArray(hashtags) || hashtags.length === 0) return content
  const tags = hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')
  return `${content}\n\n${tags}`
}

// Schedule recurring check every 1 minute
export function startSocialPublishScheduler(): void {
  socialPublishQueue.add({}, {
    repeat: { every: 60 * 1000 }
  })
  logger.info('Social publish scheduler started (every 1 min)')
}
