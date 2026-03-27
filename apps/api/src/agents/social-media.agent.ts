import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { socialService } from '../services/social.service'
import { createSocialMediaSheet } from '../services/sheets.service'
import { logger } from '../utils/logger'

export type SupportedPlatform = 'instagram' | 'facebook' | 'linkedin'

export interface SocialMediaAgentConfig {
  business_description: string
  tone: string
  posting_frequency: string           // e.g. "2x per day", "daily"
  platforms: SupportedPlatform[]
  content_pillars: string[]           // e.g. ["education", "social proof", "behind the scenes"]
  businessName: string
  locationId: string

  // Meta Graph API — direct Facebook page + Instagram Business posting
  meta_page_id?: string
  meta_access_token?: string
  instagram_user_id?: string         // Instagram Business account ID (from Meta)

  // LinkedIn direct posting
  linkedin_access_token?: string
  linkedin_person_id?: string
  linkedin_organization_id?: string  // future: requires Marketing Developer Platform
}

// Virality frameworks per platform
const PLATFORM_PROMPTS: Record<SupportedPlatform, string> = {
  instagram: `
PLATFORM: Instagram
FORMAT RULES:
- Line 1 must be a scroll-stopping hook (question, bold claim, or controversy) — this is the only line visible before "more"
- Body: 3-5 short punchy paragraphs (2-3 lines each) with line breaks between each
- Use storytelling structure: hook → problem → insight → proof → CTA
- End with a direct single-sentence CTA ("Save this post", "Tag someone who needs this", "Comment YES if you agree")
- Hashtags: 20-25 relevant hashtags on a new line at the end (mix broad, niche, and branded)
- Use emojis sparingly as visual bullet points, not decoration
VIRALITY LEVERS: Save-worthy lists, relatable pain points, "share with someone who..." CTAs`,

  facebook: `
PLATFORM: Facebook
FORMAT RULES:
- Line 1: emotional hook or controversial statement (drives comments)
- Keep to 100-200 words — Facebook rewards engagement over length
- Use "This is for you if..." framing to create identity resonance
- Ask a direct question at the end to drive comments (algorithm rewards comments heavily)
- One CTA maximum — never multiple asks
- Avoid links in the post body (add to first comment instead)
VIRALITY LEVERS: Debate-starting questions, relatable life moments, "agree or disagree?" prompts`,

  linkedin: `
PLATFORM: LinkedIn
FORMAT RULES:
- Line 1 hook: bold professional insight, surprising stat, or contrarian take (no "I'm excited to announce")
- Use a proven structure: Hook → Personal story or observation → Actionable insight → Invite discussion
- Short paragraphs: 1-2 sentences max, with blank lines between each (mobile reading)
- 150-300 words
- End with an open question that professionals will want to answer
- 3-5 hashtags maximum — place at very end
- Never use "Excited to share" or corporate filler phrases
VIRALITY LEVERS: Contrarian career takes, salary transparency, "unpopular opinion:", behind-the-scenes business numbers`
}

export class SocialMediaAgent extends BaseAgent {
  agentType = AgentType.SOCIAL_MEDIA

  generatePrompt(config: Partial<SocialMediaAgentConfig>, contactData?: Record<string, unknown>): string {
    const topic = (contactData?.topic as string) || 'a key insight about our business'
    const platform = ((contactData?.platform as SupportedPlatform) || 'instagram')
    const pillar = (contactData?.content_pillar as string) || (config.content_pillars?.[0] || 'education')

    const platformGuide = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS.instagram

    return `You are an elite social media content strategist for ${config.businessName || 'a business'}.
Your job is to create content that stops the scroll, drives engagement, and gets shared.

BUSINESS CONTEXT:
${config.business_description || ''}

BRAND TONE: ${config.tone || 'authentic, direct, and value-driven'}

CONTENT PILLAR: ${pillar}
(Rotate pillars to avoid being salesy: education → social proof → behind-the-scenes → entertainment → offer)

TOPIC FOR THIS POST: ${topic}

${platformGuide}

VIRALITY PRINCIPLES (apply to every post):
1. Every post must deliver ONE clear, specific insight — not a vague overview
2. Write like a person, not a brand — use "I" or "we", share real moments
3. The hook is 80% of the work — spend most creative energy on line 1
4. Specificity beats generality: "$47K in 30 days" beats "made money"
5. Never end with "DM us" as the only CTA — it's weak and overused

OUTPUT FORMAT:
Return a JSON object with:
{
  "platform": "${platform}",
  "hook_score": <1-10 rating of your own hook>,
  "content": "<the full post text, ready to copy-paste>",
  "caption": "<short caption if platform separates caption from script, else null>",
  "hashtags": ["<tag1>", "<tag2>", ...],
  "image_prompt": "<detailed prompt for an AI image generator that would pair perfectly with this post>",
  "best_posting_time": "<optimal day and time for this platform>",
  "predicted_engagement": "low|medium|high|viral"
}`
  }

  async generateContentCalendar(config: SocialMediaAgentConfig): Promise<string> {
    const platforms = config.platforms?.length ? config.platforms : ['facebook', 'instagram', 'linkedin']
    const contentPillars = config.content_pillars?.length ? config.content_pillars : ['education', 'social proof', 'behind the scenes', 'entertainment', 'offer']
    return this.callClaude(
      `Create a 4-week social media content calendar for: ${config.business_description}
Tone: ${config.tone}
Platforms: ${platforms.join(', ')}
Content pillars: ${contentPillars.join(', ')}
Posting frequency: ${config.posting_frequency}

For each post include: platform, content_pillar, topic, hook_idea, best_time.
Return valid JSON: { "week_1": [...], "week_2": [...], "week_3": [...], "week_4": [...] }
Each week is an array of post objects. Plan ${config.posting_frequency} per day.`,
      'You are a social media strategist who creates content calendars that drive viral growth. Be specific with topics — no vague filler.'
    )
  }

  // Generates and immediately posts/schedules content for a specific platform
  async generateAndPost(
    config: SocialMediaAgentConfig,
    platform: SupportedPlatform,
    topic: string,
    contentPillar: string,
    scheduleAt?: Date
  ): Promise<{ platform: string; content: string; postId?: string; scheduled?: boolean }> {
    // 1. Generate content
    const raw = await this.callClaude(
      this.generatePrompt(config, { platform, topic, content_pillar: contentPillar }),
      'You are an elite social media content creator. Return only valid JSON.'
    )

    let parsed: { content: string; hashtags?: string[]; image_prompt?: string } = { content: raw }
    try {
      parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
    } catch {
      // If Claude returns plain text instead of JSON, use it as-is
    }

    const postText = parsed.content
    const hashtags = parsed.hashtags || []
    const fullText = hashtags.length
      ? `${postText}\n\n${hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}`
      : postText

    // 2. Route to the correct posting method
    switch (platform) {
      case 'instagram':
        if (config.instagram_user_id && config.meta_access_token) {
          const igResult = await socialService.postToInstagram({
            igUserId: config.instagram_user_id,
            accessToken: config.meta_access_token,
            caption: fullText,
            scheduledTime: scheduleAt
          })
          return { platform, content: fullText, postId: igResult.id }
        }
        break

      case 'facebook':
        if (config.meta_page_id && config.meta_access_token) {
          const fbResult = await socialService.postToMeta({
            pageId: config.meta_page_id,
            message: fullText,
            accessToken: config.meta_access_token,
            scheduledTime: scheduleAt
          })
          return { platform, content: fullText, postId: fbResult.id }
        }
        break

      case 'linkedin':
        if (config.linkedin_access_token) {
          const liResult = await socialService.postToLinkedIn({
            accessToken: config.linkedin_access_token,
            personId: config.linkedin_person_id,
            organizationId: config.linkedin_organization_id,
            text: fullText
          })
          return { platform, content: fullText, postId: liResult.id }
        }
        break
    }

    return { platform, content: fullText }
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    const typedConfig = config as unknown as SocialMediaAgentConfig
    logger.info('Deploying Social Media Agent', { clientId })

    const contentCalendar = await this.generateContentCalendar(typedConfig)

    let workflowResult: { workflowId: string } | undefined
    try {
      workflowResult = await n8nService.deployWorkflow('social-media', {
        clientId,
        locationId: typedConfig.locationId,
        agentPrompt: contentCalendar,
        webhookUrl: `${process.env.API_BASE_URL}/webhooks/social/${clientId}`,
        businessName: typedConfig.businessName,
        platforms: Array.isArray(typedConfig.platforms) ? typedConfig.platforms.join(',') : typedConfig.platforms
      })
    } catch (error) {
      logger.warn('N8N workflow deployment failed, agent will run via direct API calls', { clientId, error })
    }

    // Create Google Sheet for post logging (non-blocking — fails silently if no Google creds)
    const spreadsheetId = await createSocialMediaSheet(clientId)
    if (spreadsheetId) {
      logger.info('Social media Google Sheet created', { clientId, spreadsheetId })
    }

    const deployment = await this.createDeploymentRecord(
      clientId,
      { ...typedConfig, generatedContentCalendar: contentCalendar, spreadsheetId },
      workflowResult?.workflowId
    )

    logger.info('Social Media Agent deployed', { clientId, deploymentId: deployment.id })
    return { id: deployment.id, n8nWorkflowId: workflowResult?.workflowId }
  }
}
