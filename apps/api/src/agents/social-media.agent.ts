import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { socialService } from '../services/social.service'
import { createSocialMediaSheet } from '../services/sheets.service'
import { logger } from '../utils/logger'
import { prisma } from '../lib/prisma'

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
- Line 1 MUST be a gut-punch hook — make them stop mid-scroll. Use fear, shocking numbers, or a bold claim they've never heard. This is the only line visible before "more" — it must create unbearable curiosity.
- Body: 3-5 short punchy paragraphs (2-3 lines each) with line breaks between each
- Use storytelling structure: hook → painful problem they're ignoring → the brutal truth → proof/results → urgent CTA
- Build FEAR: make them feel the cost of inaction. Every day without this = lost leads, lost revenue, competitors winning.
- End with a URGENT single-sentence CTA that creates scarcity ("We only take 3 new clients per month — DM 'AI' NOW before spots fill", "Comment 'READY' and we'll reach out TODAY")
- Hashtags: 20-25 relevant hashtags on a new line at the end (mix broad, niche, and branded)
- Use emojis sparingly as visual bullet points, not decoration
VIRALITY LEVERS: Fear of falling behind, shocking competitor stats, "your competitors are already doing this", scarcity/urgency CTAs, "save this before you forget" hooks
URGENCY TRIGGERS: Limited spots, time-sensitive offers, "while you're reading this your competitor is...", real cost-of-delay numbers`,

  facebook: `
PLATFORM: Facebook
FORMAT RULES:
- Line 1: Fear-based or controversy-starting statement that makes business owners stop and panic slightly ("Your competitors are automating while you're still doing this manually.")
- Keep to 100-200 words — Facebook rewards engagement over length
- Use "This is for you if..." framing to create identity resonance with business owners feeling left behind
- Make them feel the URGENCY: every week without AI agents is a week of lost leads handed to competitors
- Ask a direct question at the end that forces self-reflection ("How many leads did you lose this week because no one followed up fast enough?")
- One CTA maximum — never multiple asks — make it urgent and specific
- Avoid links in the post body (add to first comment instead)
VIRALITY LEVERS: Business owner pain points, fear of irrelevance, "agree or disagree?", shocking AI adoption stats
URGENCY TRIGGERS: "Only X spots left this month", "businesses that act now vs those that wait 6 months", cost-of-delay framing`,

  linkedin: `
PLATFORM: LinkedIn
FORMAT RULES:
- Line 1 hook: A shocking stat, a brutal truth, or a contrarian take that makes business owners question everything they're doing. NO "I'm excited to announce."
- Use structure: Shocking hook → the painful reality → what winners are doing differently → what losers are doing → urgent takeaway
- Short paragraphs: 1-2 sentences max, blank lines between each (mobile reading)
- 150-300 words
- Create FOMO: name what businesses with AI are achieving vs those without. Make the gap feel terrifying and widening every day.
- End with an open question that forces painful self-reflection, then a direct CTA with scarcity
- 3-5 hashtags maximum — place at very end
- Never use "Excited to share" or corporate filler
VIRALITY LEVERS: ROI numbers, "businesses that adopted AI in 2024 vs those that didn't", behind-the-scenes automation results, "unpopular opinion:" takes
URGENCY TRIGGERS: "The window to get ahead is closing", "early movers capture 80% of the market", specific revenue/time savings from AI automation`
}

export class SocialMediaAgent extends BaseAgent {
  agentType = AgentType.SOCIAL_MEDIA

  generatePrompt(config: Partial<SocialMediaAgentConfig>, contactData?: Record<string, unknown>): string {
    const topic = (contactData?.topic as string) || 'a key insight about our business'
    const platform = ((contactData?.platform as SupportedPlatform) || 'instagram')
    const pillar = (contactData?.content_pillar as string) || (config.content_pillars?.[0] || 'education')

    const platformGuide = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS.instagram

    return `You are an elite social media content strategist and direct-response copywriter for ${config.businessName || 'a business'}.
Your ONLY job is to create content that stops the scroll, triggers genuine fear of missing out, and compels business owners to reach out TODAY — because every day they wait is another day their competitors are pulling ahead.

BUSINESS CONTEXT:
${config.business_description || ''}

BRAND TONE: ${config.tone || 'urgent, direct, and results-focused'}

CONTENT PILLAR: ${pillar}
(Rotate pillars to avoid being repetitive: education → fear/competitor threat → social proof/results → behind-the-scenes → urgent offer)

TOPIC FOR THIS POST: ${topic}

${platformGuide}

MANDATORY PRINCIPLES — every post must nail ALL of these:
1. FEAR OF INACTION: Make the reader feel in their gut what they're losing every single day without this. Lost leads, lost revenue, competitors stealing their customers right now.
2. COMPETITOR THREAT: Make them paranoid. "While you're reading this, your competitor just automated their entire follow-up sequence." They need to feel urgency NOW.
3. SPECIFICITY: Use concrete numbers that feel real. "23 leads followed up in under 2 minutes" beats "fast follow-up". Numbers build credibility and fear simultaneously.
4. SCARCITY & URGENCY: Every post must have a reason to act TODAY — limited spots, closing window of competitive advantage, early-mover advantage disappearing fast.
5. DIRECT CTA WITH CONSEQUENCE: Not "DM us". Instead: "DM 'AI' now — we only take 3 new clients per month and 2 spots are already gone this month."
6. Write like a person who genuinely cares, not a brand. Use "I" or "we". Be direct. Be urgent. Sound human.

OUTPUT FORMAT:
Return a JSON object with:
{
  "platform": "${platform}",
  "hook_score": <1-10 rating of your own hook>,
  "content": "<the full post text, ready to copy-paste>",
  "caption": "<short caption if platform separates caption from script, else null>",
  "hashtags": ["<tag1>", "<tag2>", ...],
  "image_prompt": "<detailed prompt for an AI image generator that would pair perfectly with this post. CRITICAL: the prompt must end with 'no text, no words, no letters, no typography, no captions, no labels' — AI image generators produce garbled misspelled text so never include text in the image>",
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

    // Create Google Sheet for post logging only if one doesn't already exist
    const existingSheetCred = await prisma.clientCredential.findUnique({
      where: { id: `google-sheets-social-${clientId}` }
    })
    let spreadsheetId: string | null = null
    if (!existingSheetCred) {
      spreadsheetId = await createSocialMediaSheet(clientId)
      if (spreadsheetId) {
        logger.info('Social media Google Sheet created', { clientId, spreadsheetId })
      }
    } else {
      logger.info('Google Sheet already exists — skipping creation', { clientId })
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
