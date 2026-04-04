import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { n8nService } from '../services/n8n.service'
import { socialService } from '../services/social.service'
import { createSocialMediaSheet } from '../services/sheets.service'
import { logger } from '../utils/logger'
import { prisma } from '../lib/prisma'
import { randomUUID } from 'crypto'

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

// Platform-specific content frameworks
const PLATFORM_PROMPTS: Record<SupportedPlatform, string> = {
  instagram: `
PLATFORM: Instagram
FORMAT RULES:
- Line 1 MUST stop the scroll — use a bold insight, a surprising number, a provocative question, or a pattern interrupt. This is the ONLY line visible before "more" so it must create irresistible curiosity.
- Body: 3-5 short paragraphs (2-3 lines each) with blank lines between
- VARY your structure based on the content pillar:
  • EDUCATION: Lead with a counterintuitive insight → explain why conventional thinking is wrong → share the better approach with specifics → end with an actionable takeaway
  • SOCIAL PROOF: Open with a specific client result ("From 3 leads/week to 47") → tell the story of before vs after → reveal what changed → invite the reader to imagine the same for their business
  • BEHIND THE SCENES: Show the real process, the real numbers, the real work → be authentic and transparent → let people see the human side → builds trust over time
  • OFFERS: Lead with the transformation/result, not the feature → create genuine urgency with a reason (limited capacity, seasonal, launch window) → one clear CTA
  • THOUGHT LEADERSHIP: Take a contrarian stance backed by evidence → challenge industry norms → position yourself as someone who sees what others miss
- CTA STRATEGY (Instagram-specific): Instagram does NOT support clickable links in captions. Your CTA must drive DMs or comments:
  • DM TRIGGER: "DM me 'GROWTH' and I'll send you our free audit" / "DM 'AI' to get started" / "Send me 'READY' and I'll walk you through it"
  • COMMENT TRIGGER: "Comment 'YES' below and I'll DM you the details" / "Drop a 🔥 if you want me to send this to you"
  • SAVE CTA: "Save this for later — you'll need it" (boosts algorithm)
  • NEVER say "click the link" or "visit our website" — links don't work in IG captions
  • Pick ONE keyword for the DM trigger that's short, memorable, and relevant to the post topic
- Hashtags: 15-25 relevant hashtags on a new line (mix industry-specific, broad reach, and niche)
- Emojis: use sparingly as visual markers, never as decoration
- Write in first person ("I" or "we") — sound like a real person, not a brand
ENGAGEMENT DRIVERS: DM-triggering CTAs, save-worthy insights, relatable truths, specific numbers, "tag someone who needs this", comment triggers, controversial takes backed by data`,

  facebook: `
PLATFORM: Facebook
FORMAT RULES:
- Line 1: A bold statement, surprising stat, or direct question that earns the click. Not clickbait — deliver on the promise.
- 100-200 words — Facebook rewards engagement density over length
- VARY your approach:
  • VALUE POST: Teach something useful in 60 seconds of reading. Give away your best thinking for free — generosity builds authority.
  • STORY POST: "Last week a client called me and said..." — real stories from real businesses. People share stories, not pitches.
  • OPINION POST: Take a clear stance on something in your industry. "Unpopular opinion:" or "I stopped doing X and here's what happened" — drives comments.
  • RESULT POST: Share a specific win with numbers. Before/after. Timeline. What was done differently.
- CTA STRATEGY (Facebook-specific):
  • DM TRIGGER: "Send me a message with 'INFO' and I'll send you the details" — works on Facebook Messenger
  • COMMENT TRIGGER: "Comment 'ME' and I'll DM you" / "Drop a 👋 if you want in"
  • ENGAGEMENT QUESTION: End with a question that sparks real discussion — "What's been your biggest challenge with [topic]?"
  • No links in the post body (kills reach). Add link to first comment instead.
- One CTA maximum — never multiple asks
- Write conversationally — like you're talking to a smart friend over coffee
ENGAGEMENT DRIVERS: DM triggers, comment hooks, relatable pain points, "has this happened to you?", taggable content, debate-sparking opinions, genuine vulnerability about business challenges`,

  linkedin: `
PLATFORM: LinkedIn
FORMAT RULES:
- Line 1: A sharp insight, data point, or contrarian take that makes professionals stop scrolling. NO "I'm excited to announce" or corporate jargon.
- Short paragraphs: 1-2 sentences max, blank lines between each (optimised for mobile)
- 150-300 words
- VARY your framework:
  • INSIGHT POST: Share an observation from the trenches. What are you seeing that others aren't? What pattern have you noticed? Lead with the insight, then back it with evidence.
  • LESSON POST: "3 things I learned from [specific experience]" — numbered lists perform well but make each point genuinely valuable, not filler.
  • DATA POST: Lead with a specific number or stat → explain what it means → share why it matters for the reader's business → what to do about it.
  • NARRATIVE POST: Tell a professional story with a clear lesson. Setup → tension → resolution → takeaway. Keep it tight.
- End with a thought-provoking question OR a clear next step
- 3-5 hashtags maximum at the very end
- Sound like a senior leader sharing wisdom, not a brand selling
- No "Excited to share", no "Thrilled to announce", no empty corporate speak
ENGAGEMENT DRIVERS: Hard-won lessons, specific metrics, industry predictions, "agree or disagree?", frameworks people can apply immediately`
}

export class SocialMediaAgent extends BaseAgent {
  agentType = AgentType.SOCIAL_MEDIA

  generatePrompt(config: Partial<SocialMediaAgentConfig>, contactData?: Record<string, unknown>): string {
    const topic = (contactData?.topic as string) || 'a key insight about our business'
    const platform = ((contactData?.platform as SupportedPlatform) || 'instagram')
    const pillar = (contactData?.content_pillar as string) || (config.content_pillars?.[0] || 'education')

    const platformGuide = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS.instagram

    return `You are the head of content at a world-class marketing agency that manages social media for industry-leading brands. Your content has generated millions in revenue across dozens of industries. You write for ${config.businessName || 'a business'} — adapt every word to THEIR specific industry, audience, and language.

BUSINESS CONTEXT:
${config.business_description || ''}

Read the business description carefully. MATCH THE INDUSTRY:
- If they're a dentist → speak to patients and dental professionals, use dental terminology
- If they're a tradie/plumber/electrician → speak to homeowners and property managers, use trade language
- If they're a real estate agent → speak to buyers/sellers, use property market language
- If they're a doctor/clinic → speak to patients, use healthcare language
- If they're an agency → speak to business owners, use marketing/growth language
- If they're a restaurant → speak to foodies and local community
- If they're a gym/PT → speak to fitness enthusiasts
- WHATEVER the business is, write AS IF you are deeply embedded in that industry. Never write generic "business" content.

BRAND TONE: ${config.tone || 'confident, authoritative, and approachable — like an industry leader who genuinely wants to help'}

CONTENT PILLAR: ${pillar}
Create content that fits this pillar naturally. Each pillar has a different energy:
- education → generous, insightful, "here's something you didn't know"
- social_proof → specific results, client stories, transformation
- behind_the_scenes → authentic, transparent, builds trust
- offers → transformation-focused, genuine urgency, clear value
- entertainment → relatable, shareable, personality-driven

TOPIC FOR THIS POST: ${topic}

${platformGuide}

CONTENT QUALITY STANDARDS — the difference between amateur and agency-level:

1. SPECIFICITY OVER GENERALITY: Never write "improve your business." Instead: "We helped a ${config.business_description ? 'similar business' : 'local business'} go from 12 enquiries/month to 89 in 6 weeks." Concrete beats vague every time.

2. LEAD WITH VALUE, NOT FEAR: The best content makes people think "I need to save this" or "I need to share this." Give genuinely useful insights. When people trust you, they buy. Fear-only content burns audiences.

3. AUTHORITY POSITIONING: Write like the recognised expert in this space. Reference real industry trends, cite believable numbers, share insider knowledge that only someone deep in this industry would know.

4. HUMAN VOICE: Write like a real person — someone the reader would want to have a conversation with. Use "I" and "we". Share opinions. Be direct. No corporate speak, no empty motivation quotes, no "leveraging synergies."

5. ONE CLEAR CTA: Every post should have ONE thing you want the reader to do. For Instagram and Facebook, this MUST be a DM trigger or comment trigger — NOT a link (links don't work in IG captions and kill reach on FB). Examples: "DM me 'GROWTH'" / "Comment 'YES' below" / "Send me 'READY' in a message". Pick a keyword that's short, memorable, and related to the post topic.

6. PATTERN VARIATION: Do NOT make every post sound the same. Vary your hooks, structure, length, and energy. Some posts should be punchy (3 lines). Others should tell a story. Others should teach. Mix it up.

OUTPUT FORMAT:
Return a JSON object with:
{
  "platform": "${platform}",
  "hook_score": <1-10 rating of your own hook — be honest, 8+ only if it's genuinely scroll-stopping>,
  "content": "<the full post text, ready to copy-paste. Must sound like it was written by a human who lives and breathes this industry, not an AI.>",
  "caption": "<short caption if platform separates caption from script, else null>",
  "hashtags": ["<tag1>", "<tag2>", ...],
  "image_prompt": "<A detailed prompt for an AI image generator. CREATE A PREMIUM, AGENCY-LEVEL VISUAL that matches the post's message and the client's SPECIFIC industry.

CRITICAL IMAGE RULES:
1. MATCH THE EXACT INDUSTRY: Read the business description. If dentist → show a real dental environment. If tradie → show a real job site. If restaurant → show the kitchen or dining room. If gym → show the training floor. NEVER default to generic office/tech imagery unless the business IS a tech company.
2. HERO COMPOSITION: One strong focal point. A real person in their element — confident, skilled, in control. The viewer should immediately understand what industry this is.
3. CINEMATIC QUALITY: Shot on a high-end camera (85mm f/1.4 or Hasselblad medium format feel). Shallow depth of field with creamy bokeh. The image should feel like it belongs in a premium industry magazine.
4. LIGHTING: Dramatic but natural. Golden hour warmth for lifestyle shots. Cool, controlled lighting for professional/clinical settings. Strong contrast with purposeful shadows. Never flat or overexposed.
5. COLOR PALETTE: Rich, intentional colours that match the industry mood. Warm earth tones for trades/hospitality. Cool blues/greens for healthcare/tech. Bold contrast for fitness/lifestyle. Desaturated elegance for luxury/professional services.
6. ENVIRONMENT: Show the REAL workspace for this industry in pristine, aspirational condition — the dental clinic looks world-class, the construction site is impressive in scale, the restaurant kitchen is buzzing with energy, the gym has premium equipment.
7. EMOTION: The image should make the viewer feel something — aspiration, trust, excitement, or curiosity. Not stock-photo sterile.
8. ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO NUMBERS, NO LOGOS, NO WATERMARKS, NO TYPOGRAPHY, NO CAPTIONS, NO LABELS of any kind in the image. Zero. The image must be completely clean.>",
  "dm_trigger_keyword": "<the exact keyword used in the CTA, e.g. 'GROWTH', 'AI', 'READY'. Must match what's in the post content. This keyword triggers the automated conversation workflow when someone DMs it.>",
  "best_posting_time": "<optimal day and time for this platform based on the industry's audience>",
  "predicted_engagement": "low|medium|high|viral"
}`
  }

  async generateContentCalendar(config: SocialMediaAgentConfig): Promise<string> {
    const platforms = config.platforms?.length ? config.platforms : ['facebook', 'instagram', 'linkedin']
    const contentPillars = config.content_pillars?.length ? config.content_pillars : ['education', 'social proof', 'behind the scenes', 'entertainment', 'offer']
    return this.callClaude(
      `Create a 4-week social media content calendar for: ${config.business_description}
Business name: ${config.businessName || 'the business'}
Tone: ${config.tone}
Platforms: ${platforms.join(', ')}
Content pillars: ${contentPillars.join(', ')}
Posting frequency: ${config.posting_frequency}

IMPORTANT: Read the business description and create topics that are SPECIFIC to that industry. Not generic "business growth" topics — real, useful, industry-specific content that this business's actual customers would care about.

For each post include:
- platform: which platform
- content_pillar: which pillar this post serves
- topic: a SPECIFIC, detailed topic (not "business tips" — instead "Why 73% of dental patients choose their dentist based on online reviews" or "The 3 trades certifications that instantly boost your quote acceptance rate")
- hook_idea: the opening line / hook concept
- best_time: optimal posting time for this platform and industry

Return valid JSON: { "week_1": [...], "week_2": [...], "week_3": [...], "week_4": [...] }
Each week is an array of post objects. Plan ${config.posting_frequency} per day.

Vary the content pillars across the week. Never have two education posts back to back. Mix value, stories, proof, and offers naturally.`,
      'You are the head of content strategy at a premium marketing agency. You create content calendars that position businesses as the undisputed authority in their industry. Every topic must be specific, relevant, and genuinely valuable to the target audience. No filler, no generic posts.'
    )
  }

  // Generates content and saves as a reviewable draft (or auto-scheduled if client has autoApprovePosts)
  async generateDraft(
    clientId: string,
    config: SocialMediaAgentConfig,
    platform: SupportedPlatform,
    topic: string,
    contentPillar: string
  ): Promise<{ id: string; status: string; content: string }> {
    const prompt = this.generatePrompt(config, { platform, topic, content_pillar: contentPillar })
    const raw = await this.callClaude(prompt, 'You are an elite social media content creator. Return only valid JSON.')

    let parsed: { content: string; hashtags?: string[]; image_prompt?: string; hook_score?: number; predicted_engagement?: string; best_posting_time?: string } = { content: raw }
    try {
      parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
    } catch { /* use raw text */ }

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    const autoApprove = client?.autoApprovePosts ?? false

    // Schedule for tomorrow at 10 AM by default
    const scheduledAt = new Date()
    scheduledAt.setDate(scheduledAt.getDate() + 1)
    scheduledAt.setHours(10, 0, 0, 0)

    const status = autoApprove ? 'SCHEDULED' : 'DRAFT'

    const post = await prisma.scheduledPost.create({
      data: {
        id: randomUUID(),
        clientId,
        platform: platform.toUpperCase() as never,
        status: status as never,
        source: 'AI_GENERATED' as never,
        content: parsed.content,
        imagePrompt: parsed.image_prompt,
        hashtags: parsed.hashtags || [],
        contentPillar,
        scheduledAt,
        autoApproved: autoApprove,
        metadata: {
          hook_score: parsed.hook_score,
          predicted_engagement: parsed.predicted_engagement,
          best_posting_time: parsed.best_posting_time,
        }
      }
    })

    logger.info('Social media draft created', { clientId, postId: post.id, platform, status })
    return { id: post.id, status, content: parsed.content }
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
