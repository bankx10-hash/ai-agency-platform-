import axios, { AxiosInstance } from 'axios'
import { logger } from '../utils/logger'

interface MetaPostOptions {
  pageId: string
  message: string
  accessToken: string
  imageUrl?: string
  link?: string
  scheduledTime?: Date
}

// Instagram Graph API — requires Instagram Business or Creator account linked to a Facebook Page
interface InstagramPostOptions {
  igUserId: string          // Instagram Business account ID
  accessToken: string       // Page access token (same as Meta, scoped to instagram_content_publish)
  caption: string
  imageUrl?: string         // Required for IMAGE posts
  scheduledTime?: Date
}

interface LinkedInPostOptions {
  accessToken: string
  personId?: string         // LinkedIn member URN (from OpenID sub)
  organizationId?: string   // LinkedIn organization URN (requires Marketing Developer Platform)
  text: string
  imageUrl?: string
}

export class SocialService {
  private metaBaseURL = process.env.META_GRAPH_API_URL || 'https://graph.facebook.com/v18.0'

  private getMetaClient(accessToken: string): AxiosInstance {
    return axios.create({
      baseURL: this.metaBaseURL,
      params: { access_token: accessToken }
    })
  }

  // ------------------------------------------------------------------
  // Facebook — Meta Graph API
  // ------------------------------------------------------------------

  async postToMeta(options: MetaPostOptions): Promise<{ id: string }> {
    const metaClient = this.getMetaClient(options.accessToken)

    let endpoint = `/${options.pageId}/feed`
    const postData: Record<string, unknown> = { message: options.message }

    if (options.imageUrl) {
      endpoint = `/${options.pageId}/photos`
      postData.url = options.imageUrl
      postData.caption = options.message
      delete postData.message
    }

    if (options.link) postData.link = options.link

    if (options.scheduledTime) {
      postData.scheduled_publish_time = Math.floor(options.scheduledTime.getTime() / 1000)
      postData.published = false
    }

    const response = await metaClient.post(endpoint, postData)
    logger.info('Post published to Facebook', { pageId: options.pageId, postId: response.data.id })
    return { id: response.data.id }
  }

  async getPageInsights(
    pageId: string,
    accessToken: string,
    metric: string,
    period = 'day'
  ): Promise<Array<{ value: number; end_time: string }>> {
    const metaClient = this.getMetaClient(accessToken)
    const response = await metaClient.get(`/${pageId}/insights`, { params: { metric, period } })
    return response.data.data?.[0]?.values || []
  }

  // ------------------------------------------------------------------
  // Instagram — Instagram Graph API (2-step: create container → publish)
  // Requires: Instagram Business/Creator account linked to a Facebook Page
  // Permissions: instagram_basic, instagram_content_publish, pages_read_engagement
  // ------------------------------------------------------------------

  async postToInstagram(options: InstagramPostOptions): Promise<{ id: string }> {
    const metaClient = this.getMetaClient(options.accessToken)

    const containerPayload: Record<string, unknown> = {
      caption: options.caption,
      media_type: 'IMAGE',
      image_url: options.imageUrl
    }

    if (options.scheduledTime) {
      containerPayload.published = false
      containerPayload.scheduled_publish_time = Math.floor(options.scheduledTime.getTime() / 1000)
    }

    const containerResponse = await metaClient.post(`/${options.igUserId}/media`, containerPayload)
    const containerId: string = containerResponse.data.id
    logger.info('Instagram media container created', { igUserId: options.igUserId, containerId })

    const publishResponse = await metaClient.post(`/${options.igUserId}/media_publish`, {
      creation_id: containerId
    })

    logger.info('Post published to Instagram', { igUserId: options.igUserId, postId: publishResponse.data.id })
    return { id: publishResponse.data.id }
  }

  async getInstagramInsights(
    igUserId: string,
    accessToken: string,
    metric: string,
    period = 'day'
  ): Promise<Array<{ value: number; end_time: string }>> {
    const metaClient = this.getMetaClient(accessToken)
    const response = await metaClient.get(`/${igUserId}/insights`, { params: { metric, period } })
    return response.data.data?.[0]?.values || []
  }

  // ------------------------------------------------------------------
  // LinkedIn — Direct posting via LinkedIn Marketing API
  // Requires: LinkedIn app with r_liteprofile + w_member_social or w_organization_social
  // ------------------------------------------------------------------

  async postToLinkedIn(options: LinkedInPostOptions): Promise<{ id: string }> {
    const author = options.organizationId
      ? `urn:li:organization:${options.organizationId}`
      : `urn:li:person:${options.personId}`

    const postBody: Record<string, unknown> = {
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: options.text },
          shareMediaCategory: options.imageUrl ? 'IMAGE' : 'NONE',
          ...(options.imageUrl && {
            media: [{
              status: 'READY',
              description: { text: '' },
              media: options.imageUrl,
              title: { text: '' }
            }]
          })
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    }

    const response = await axios.post('https://api.linkedin.com/v2/ugcPosts', postBody, {
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0'
      }
    })

    const postId: string = response.headers['x-restli-id'] || response.data.id || ''
    logger.info('Post published to LinkedIn', { organizationId: options.organizationId, postId })
    return { id: postId }
  }
}

export const socialService = new SocialService()
