import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { randomUUID } from 'crypto'
import axios from 'axios'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { socialService } from '../services/social.service'
import { SocialMediaAgent, SocialMediaAgentConfig } from '../agents/social-media.agent'
import { decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'
import { socialPublishQueue } from '../queue/social-publish.queue'
import { generateAdImage, ctaToDisplayText } from '../services/ad-image.service'

const router = Router()
router.use(authMiddleware)

const socialAgent = new SocialMediaAgent()

// Helper: get client's social credentials
async function getSocialConfig(clientId: string): Promise<Partial<SocialMediaAgentConfig>> {
  const client = await prisma.client.findUnique({ where: { id: clientId } })
  if (!client) throw new Error('Client not found')

  const creds = await prisma.clientCredential.findMany({ where: { clientId } })
  const metaCred = creds.find(c => c.service === 'meta' || c.service === 'facebook')
  const instagramCred = creds.find(c => c.service === 'instagram')
  const linkedinCred = creds.find(c => c.service === 'linkedin')

  let metaConfig: Record<string, string> = {}
  let igConfig: Record<string, string> = {}
  let linkedinConfig: Record<string, string> = {}

  if (metaCred) {
    try { metaConfig = decryptJSON(metaCred.credentials) } catch { /* skip */ }
  }
  if (instagramCred) {
    try { igConfig = decryptJSON(instagramCred.credentials) } catch { /* skip */ }
  }
  if (linkedinCred) {
    try { linkedinConfig = decryptJSON(linkedinCred.credentials) } catch { /* skip */ }
  }

  return {
    businessName: client.businessName,
    business_description: client.businessDescription || '',
    tone: 'urgent, direct, and results-focused',
    platforms: ['facebook', 'instagram', 'linkedin'],
    content_pillars: ['education', 'social proof', 'behind the scenes', 'offers'],
    posting_frequency: 'daily',
    locationId: '',
    meta_page_id: metaConfig.pageId || metaConfig.meta_page_id,
    meta_access_token: metaConfig.accessToken || metaConfig.meta_access_token,
    instagram_user_id: igConfig.igUserId || igConfig.instagramUserId || metaConfig.instagramUserId || metaConfig.instagram_user_id,
    linkedin_access_token: linkedinConfig.accessToken || linkedinConfig.linkedin_access_token,
    linkedin_person_id: linkedinConfig.personId || linkedinConfig.linkedin_person_id,
    linkedin_organization_id: linkedinConfig.organizationId || linkedinConfig.linkedin_organization_id,
  }
}

// ── Posts CRUD ─────────────────────────────────���───────────────────────────────

// List posts
router.get('/posts', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const { status, platform, source, limit = '50', cursor } = req.query

    const where: Record<string, unknown> = { clientId }
    if (status) where.status = status as string
    if (platform) where.platform = platform as string
    if (source) where.source = source as string

    const take = Math.min(parseInt(limit as string, 10) || 50, 100)
    const posts = await prisma.scheduledPost.findMany({
      where: where as never,
      include: { analytics: true },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor as string } } : {})
    })

    const draftCount = await prisma.scheduledPost.count({
      where: { clientId, status: 'DRAFT' }
    })

    res.json({ posts, draftCount })
  } catch (err) {
    logger.error('Failed to list posts', { err })
    res.status(500).json({ error: 'Failed to list posts' })
  }
})

// Get single post
router.get('/posts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId: req.clientId! },
      include: { analytics: true }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }
    res.json(post)
  } catch (err) {
    logger.error('Failed to get post', { err })
    res.status(500).json({ error: 'Failed to get post' })
  }
})

// Create manual post
router.post('/posts', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const { platform, content, imageUrl, imagePrompt, hashtags, contentPillar, scheduledAt, metadata } = req.body

    if (!platform || !content) {
      res.status(400).json({ error: 'platform and content are required' })
      return
    }

    const status = scheduledAt ? 'SCHEDULED' : 'DRAFT'
    const post = await prisma.scheduledPost.create({
      data: {
        id: randomUUID(),
        clientId,
        platform,
        status,
        source: 'MANUAL',
        content,
        imageUrl,
        imagePrompt,
        hashtags: hashtags || [],
        contentPillar,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        metadata,
      }
    })

    res.status(201).json(post)
  } catch (err) {
    logger.error('Failed to create post', { err })
    res.status(500).json({ error: 'Failed to create post' })
  }
})

// AI-generate single draft
router.post('/posts/generate', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const { platform = 'instagram', topic, contentPillar = 'education', customImagePrompt } = req.body

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) { res.status(404).json({ error: 'Client not found' }); return }

    const config = await getSocialConfig(clientId)
    const prompt = socialAgent.generatePrompt(config, { platform, topic, content_pillar: contentPillar })
    const raw = await socialAgent.callClaude(prompt, 'You are an elite social media content creator. Return only valid JSON.')

    let parsed: { content: string; hashtags?: string[]; image_prompt?: string; hook_score?: number; predicted_engagement?: string; best_posting_time?: string } = { content: raw }
    try {
      parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
    } catch { /* use raw text */ }

    const autoApprove = client.autoApprovePosts
    const status = autoApprove ? 'SCHEDULED' : 'DRAFT'

    // If auto-approve, schedule for optimal time tomorrow (default 10 AM local)
    let scheduledAt: Date | null = null
    if (autoApprove) {
      scheduledAt = new Date()
      scheduledAt.setDate(scheduledAt.getDate() + 1)
      scheduledAt.setHours(10, 0, 0, 0)
    }

    // Use custom image prompt if provided, otherwise use AI-generated one
    const imagePromptToUse = customImagePrompt || parsed.image_prompt

    // Auto-generate image via fal.ai if image_prompt exists
    let imageUrl: string | undefined
    if (imagePromptToUse && process.env.FAL_API_KEY) {
      try {
        const aspectRatio = platform.toUpperCase() === 'INSTAGRAM' ? '1:1' : '16:9'
        const styleGuide = customImagePrompt
          ? '' // Don't add style guide if client provided their own prompt — respect their vision
          : ', hyper-realistic cinematic DSLR photography, professionals in smart business attire as main subject, dark moody lighting with soft shadows and cool undertones, dramatic contrast, depth-of-field bokeh, crisp lens reflections, slightly darker tone, premium editorial aesthetic, modern sleek workplace, shot on 85mm f/1.4 lens, NO TEXT, NO WORDS, NO LETTERS, NO WRITING, NO LOGOS, NO WATERMARKS, NO OVERLAYS, no illustrations, no cartoons, no bright airy aesthetics'
        const styledPrompt = (imagePromptToUse.substring(0, 800) + styleGuide).substring(0, 1000)
        const falResponse = await axios.post(
          'https://fal.run/fal-ai/flux/dev',
          {
            prompt: styledPrompt,
            image_size: aspectRatio === '1:1' ? 'square_hd' : 'landscape_16_9',
            num_images: 1,
            enable_safety_checker: true
          },
          {
            headers: { Authorization: `Key ${process.env.FAL_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 60000
          }
        )
        imageUrl = falResponse.data.images[0].url
        logger.info('Auto-generated image for AI post', { platform, imageUrl: imageUrl?.substring(0, 80) })
      } catch (imgErr) {
        logger.warn('Image auto-generation failed, creating post without image', { error: imgErr })
      }
    }

    const post = await prisma.scheduledPost.create({
      data: {
        id: randomUUID(),
        clientId,
        platform: platform.toUpperCase() as never,
        status: status as never,
        source: 'AI_GENERATED' as never,
        content: parsed.content,
        imageUrl: imageUrl || null,
        imagePrompt: imagePromptToUse,
        hashtags: parsed.hashtags || [],
        contentPillar,
        scheduledAt,
        autoApproved: autoApprove,
        metadata: {
          hook_score: parsed.hook_score,
          predicted_engagement: parsed.predicted_engagement,
          best_posting_time: parsed.best_posting_time,
        },
      }
    })

    res.status(201).json(post)
  } catch (err) {
    logger.error('Failed to generate post', { err })
    res.status(500).json({ error: 'Failed to generate post' })
  }
})

// Batch generate a week of drafts
router.post('/posts/generate-batch', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const { days = 7 } = req.body

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) { res.status(404).json({ error: 'Client not found' }); return }

    const config = await getSocialConfig(clientId)
    const fullConfig = config as SocialMediaAgentConfig
    const calendarRaw = await socialAgent.generateContentCalendar(fullConfig)

    let calendar: Record<string, Array<{ platform: string; topic: string; content_pillar: string; hook_idea?: string; best_time?: string }>>
    try {
      calendar = JSON.parse(calendarRaw.replace(/```json\n?|\n?```/g, '').trim())
    } catch {
      res.status(500).json({ error: 'Failed to parse content calendar from AI' })
      return
    }

    const autoApprove = client.autoApprovePosts
    const posts: Array<Record<string, unknown>> = []
    let dayOffset = 1

    for (const [, weekPosts] of Object.entries(calendar)) {
      if (!Array.isArray(weekPosts)) continue
      for (const item of weekPosts) {
        if (dayOffset > days) break

        const scheduledAt = new Date()
        scheduledAt.setDate(scheduledAt.getDate() + dayOffset)
        scheduledAt.setHours(10, 0, 0, 0)

        const post = await prisma.scheduledPost.create({
          data: {
            id: randomUUID(),
            clientId,
            platform: (item.platform || 'INSTAGRAM').toUpperCase() as never,
            status: (autoApprove ? 'SCHEDULED' : 'DRAFT') as never,
            source: 'AI_GENERATED' as never,
            content: item.hook_idea || item.topic || 'AI-generated content pending',
            contentPillar: item.content_pillar,
            scheduledAt: autoApprove ? scheduledAt : scheduledAt,
            autoApproved: autoApprove,
            metadata: { from_calendar: true, best_time: item.best_time },
          }
        })
        posts.push(post)
        dayOffset++
      }
    }

    res.status(201).json({ posts, count: posts.length })
  } catch (err) {
    logger.error('Failed to batch generate posts', { err })
    res.status(500).json({ error: 'Failed to batch generate posts' })
  }
})

// Regenerate content for existing draft
router.post('/posts/:id/regenerate', async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }
    if (post.status !== 'DRAFT') {
      res.status(400).json({ error: 'Can only regenerate DRAFT posts' })
      return
    }

    const config = await getSocialConfig(req.clientId!)
    const platform = post.platform.toLowerCase()
    const prompt = socialAgent.generatePrompt(config, {
      platform,
      topic: post.contentPillar || 'a key insight about our business',
      content_pillar: post.contentPillar || 'education'
    })
    const raw = await socialAgent.callClaude(prompt, 'You are an elite social media content creator. Return only valid JSON.')

    let parsed: { content: string; hashtags?: string[]; image_prompt?: string; hook_score?: number } = { content: raw }
    try {
      parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
    } catch { /* use raw */ }

    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        content: parsed.content,
        hashtags: parsed.hashtags || [],
        imagePrompt: parsed.image_prompt,
        metadata: { ...((post.metadata as Record<string, unknown>) || {}), hook_score: parsed.hook_score, regeneratedAt: new Date().toISOString() },
      }
    })

    res.json(updated)
  } catch (err) {
    logger.error('Failed to regenerate post', { err })
    res.status(500).json({ error: 'Failed to regenerate post' })
  }
})

// Generate advert from an existing post
router.post('/posts/:id/generate-advert', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) { res.status(404).json({ error: 'Client not found' }); return }

    const { platform = post.platform.toLowerCase(), objective = 'conversions' } = req.body

    // Generate ad copy from the post content using Claude — agency-level ad creative
    const adPrompt = `You are a senior creative director at a top-tier performance marketing agency. You've managed $50M+ in Meta ad spend. Your job is to transform an organic social post into a PAID ADVERTISEMENT that looks, feels, and performs like it was created by a world-class agency — NOT like a boosted post.

BUSINESS: ${client.businessName}
${client.businessDescription ? `INDUSTRY/DESCRIPTION: ${client.businessDescription}` : ''}

ORIGINAL ORGANIC POST (use as source material ONLY — do NOT copy it):
${post.content}

PLATFORM: ${platform}
AD OBJECTIVE: ${objective}

═══════════════════════════════════════════
AGENCY AD CREATIVE RULES (FOLLOW ALL):
═══════════════════════════════════════════

RULE 1 — THIS IS AN AD, NOT A POST
- Organic posts educate. Ads SELL. Every word must drive toward one action.
- NO hashtags. NO emoji spam. NO "engagement bait". Those are organic tactics.
- The tone should be polished, direct, and authoritative — like a premium brand speaking to qualified buyers.

RULE 2 — HEADLINE (max 40 chars)
- Pattern-interrupt the scroll. Use a number, a provocative claim, or a direct benefit.
- Good: "47 Leads While You Slept" / "Cut Follow-Up Time by 90%" / "Your Competitors Know This"
- Bad: "Check This Out!" / "Amazing Opportunity" / generic curiosity bait

RULE 3 — PRIMARY TEXT (max 125 chars)
- This appears ABOVE the image. It's the first thing people read.
- One single, specific, measurable benefit + implied urgency.
- Good: "Businesses using AI follow-up close 3x more deals. Yours isn't one of them — yet."
- Bad: "We offer great services for your business needs."

RULE 4 — AD BODY COPY (ad_content)
- Structure: HOOK (1 line) → PROBLEM (2-3 lines) → SOLUTION with PROOF (2-3 lines) → OFFER + CTA (1-2 lines)
- Use the PAS framework (Problem-Agitate-Solve) or AIDA (Attention-Interest-Desire-Action)
- Include at least ONE specific number/stat (real or realistic for this industry)
- Include ONE element of social proof ("Join 200+ businesses" / "Rated 4.9/5" / "Used by leading [industry]")
- Include scarcity or urgency ("Limited spots" / "Offer ends Friday" / "Only accepting 5 new clients this month")
- End with ONE clear CTA. Not "learn more and also sign up and also call us". ONE action.
- MAX 4-5 short paragraphs. White space between each. Mobile-optimized.
- NO hashtags. NO emojis as bullet points. Clean, professional copy.

RULE 5 — CTA TYPE
- Must match the objective. Conversions → BOOK_NOW or GET_OFFER. Traffic → LEARN_MORE. Lead gen → SIGN_UP.

RULE 6 — IMAGE PROMPT (for AI image generation)
- Agency ads do NOT use stock photos. They use HERO IMAGERY — one powerful visual that tells a story.
- The image should show THE RESULT, not the process. Show the transformation the customer experiences.
- Composition: Single strong focal point. Clean negative space. Professional color grading.
- MATCH THE INDUSTRY — if dentist, show a confident patient with a perfect smile in a modern clinic. If trades, show a completed premium job. If agency, show a sleek dashboard with impressive metrics.
- Style: Shot by a $10,000/day commercial photographer. Hasselblad medium format feel. Controlled studio or on-location lighting. Editorial grade.
- Color: Bold, high-contrast. Deep shadows. One dominant brand-aligned color accent. NOT flat or bright.
- ABSOLUTELY NO TEXT, WORDS, LETTERS, NUMBERS, LOGOS, WATERMARKS, OR TYPOGRAPHY IN THE IMAGE. Zero. None. The ad platform adds text overlays — the image must be clean.

RULE 7 — TARGET AUDIENCE
- Define a specific Meta Ads audience. Include: demographics, interests, behaviors, lookalike suggestions.
- Be specific: "Business owners 30-55, interested in CRM software, digital marketing, with 2-50 employees" NOT "people who like business"

═══════════════════════════════════════════

Return valid JSON only:
{
  "headline": "...",
  "primary_text": "...",
  "description": "max 30 chars — appears below headline",
  "cta_type": "LEARN_MORE | SIGN_UP | BOOK_NOW | CONTACT_US | GET_OFFER | SHOP_NOW",
  "ad_content": "the full ad body copy following Rule 4",
  "image_prompt": "detailed image prompt following Rule 6",
  "target_audience": "specific Meta Ads targeting following Rule 7",
  "ad_format_notes": "brief note on recommended placement (Feed, Stories, Reels) and why"
}`

    const raw = await socialAgent.callClaude(adPrompt, 'You are a senior creative director at a performance marketing agency with $50M+ in managed ad spend. Return only valid JSON. No markdown, no explanation.')

    let parsed: {
      headline?: string; primary_text?: string; description?: string
      cta_type?: string; ad_content?: string; image_prompt?: string; target_audience?: string; ad_format_notes?: string
    } = {}
    try {
      parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
    } catch {
      res.status(500).json({ error: 'Failed to parse ad content from AI' })
      return
    }

    // Generate ad image via fal.ai
    let adImageUrl: string | undefined
    if (parsed.image_prompt && process.env.FAL_API_KEY) {
      try {
        const styleGuide = ', shot on Hasselblad X2D medium format, commercial advertising campaign photography, $10000 production value, single powerful hero subject, bold dramatic lighting with deep shadows, high-contrast editorial color grading, one dominant color accent against dark moody tones, controlled studio or premium on-location lighting, shallow depth-of-field with creamy bokeh, clean negative space for ad copy overlay, magazine cover quality, premium brand aesthetic, ABSOLUTELY NO TEXT NO WORDS NO LETTERS NO NUMBERS NO LOGOS NO WATERMARKS NO TYPOGRAPHY'
        const styledPrompt = (parsed.image_prompt.substring(0, 800) + styleGuide).substring(0, 1000)
        const falResponse = await axios.post(
          'https://fal.run/fal-ai/flux/dev',
          {
            prompt: styledPrompt,
            image_size: platform === 'instagram' ? 'square_hd' : 'landscape_16_9',
            num_images: 1,
            enable_safety_checker: true
          },
          {
            headers: { Authorization: `Key ${process.env.FAL_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 60000
          }
        )
        adImageUrl = falResponse.data.images[0].url
      } catch (imgErr) {
        logger.warn('Ad background image generation failed, using original post image', { error: imgErr })
        adImageUrl = post.imageUrl || undefined
      }
    }

    // Composite text overlay onto the ad image (viral ad style)
    let finalAdImageUrl = adImageUrl || post.imageUrl || undefined
    if (finalAdImageUrl && parsed.headline) {
      try {
        const adStyle = req.body.adStyle || 'bold'
        const composited = await generateAdImage({
          backgroundImageUrl: finalAdImageUrl,
          headline: parsed.headline,
          primaryText: parsed.primary_text,
          ctaText: ctaToDisplayText(parsed.cta_type || 'LEARN_MORE'),
          businessName: client.businessName,
          platform: platform.toUpperCase() as 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN',
          style: adStyle
        })

        // Upload composited image to fal.ai storage for a URL
        // For now, serve it as a data URL (base64) -- in production, upload to S3/Cloudinary
        const base64 = composited.toString('base64')
        finalAdImageUrl = `data:image/jpeg;base64,${base64}`

        logger.info('Ad image composited with text overlay', { platform, style: adStyle })
      } catch (compErr) {
        logger.warn('Ad image compositing failed, using plain image', { error: compErr })
        // Fall back to the plain image without text overlay
      }
    }

    // Create the advert as a new ScheduledPost
    const adPost = await prisma.scheduledPost.create({
      data: {
        id: randomUUID(),
        clientId,
        platform: platform.toUpperCase() as never,
        status: 'DRAFT' as never,
        source: 'AI_GENERATED' as never,
        content: parsed.ad_content || post.content,
        imageUrl: finalAdImageUrl || null,
        imagePrompt: parsed.image_prompt,
        hashtags: [],
        contentPillar: 'offer',
        autoApproved: false,
        metadata: {
          isAdvert: true,
          headline: parsed.headline,
          primaryText: parsed.primary_text,
          description: parsed.description,
          ctaType: parsed.cta_type,
          targetAudience: parsed.target_audience,
          adFormatNotes: parsed.ad_format_notes,
          objective,
          sourcePostId: post.id,
        },
      }
    })

    logger.info('Advert generated from post', { postId: post.id, adPostId: adPost.id, platform })
    res.status(201).json(adPost)
  } catch (err) {
    logger.error('Failed to generate advert', { err })
    res.status(500).json({ error: 'Failed to generate advert' })
  }
})

// Generate image for a post using fal.ai Flux
router.post('/posts/:id/generate-image', async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }

    const imagePrompt = req.body.imagePrompt || post.imagePrompt
    if (!imagePrompt) {
      res.status(400).json({ error: 'No image prompt available. Generate content first or provide an imagePrompt.' })
      return
    }

    const falApiKey = process.env.FAL_API_KEY
    if (!falApiKey) {
      res.status(500).json({ error: 'FAL_API_KEY not configured' })
      return
    }

    // Match platform aspect ratio (same logic as n8n-callbacks)
    const aspectRatio = post.platform === 'INSTAGRAM' ? '1:1' : '16:9'
    const styleGuide = ', hyper-realistic cinematic DSLR photography, professionals in smart business attire as main subject, dark moody lighting with soft shadows and cool undertones, dramatic contrast, depth-of-field bokeh, crisp lens reflections, slightly darker tone, premium editorial aesthetic, modern sleek workplace, shot on 85mm f/1.4 lens, NO TEXT, NO WORDS, NO LETTERS, NO WRITING, NO LOGOS, NO WATERMARKS, NO OVERLAYS, no illustrations, no cartoons, no bright airy aesthetics'
    const styledPrompt = (imagePrompt.substring(0, 800) + styleGuide).substring(0, 1000)

    const falResponse = await axios.post(
      'https://fal.run/fal-ai/flux/dev',
      {
        prompt: styledPrompt,
        image_size: aspectRatio === '1:1' ? 'square_hd' : 'landscape_16_9',
        num_images: 1,
        enable_safety_checker: true
      },
      {
        headers: {
          Authorization: `Key ${falApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    )

    const imageUrl = falResponse.data.images[0].url

    // Save image URL to the post
    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { imageUrl, imagePrompt }
    })

    logger.info('Image generated for social post', { postId: post.id, platform: post.platform })
    res.json({ imageUrl, post: updated })
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? `${err.response?.status} ${JSON.stringify(err.response?.data)}`
      : String(err)
    logger.error('Failed to generate image', { postId: req.params.id, error: detail })
    res.status(500).json({ error: 'Image generation failed', detail })
  }
})

// Update post
router.patch('/posts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }
    if (post.status === 'PUBLISHED' || post.status === 'PUBLISHING') {
      res.status(400).json({ error: 'Cannot edit a published or publishing post' })
      return
    }

    const { content, platform, imageUrl, imagePrompt, hashtags, contentPillar, scheduledAt, metadata } = req.body
    const data: Record<string, unknown> = {}
    if (content !== undefined) data.content = content
    if (platform !== undefined) data.platform = platform
    if (imageUrl !== undefined) data.imageUrl = imageUrl
    if (imagePrompt !== undefined) data.imagePrompt = imagePrompt
    if (hashtags !== undefined) data.hashtags = hashtags
    if (contentPillar !== undefined) data.contentPillar = contentPillar
    if (scheduledAt !== undefined) data.scheduledAt = scheduledAt ? new Date(scheduledAt) : null
    if (metadata !== undefined) data.metadata = metadata

    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: data as never
    })

    res.json(updated)
  } catch (err) {
    logger.error('Failed to update post', { err })
    res.status(500).json({ error: 'Failed to update post' })
  }
})

// Upload/save image for a post (accepts base64 data URL from canvas editor)
router.post('/posts/:id/upload-image', async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }

    const { imageDataUrl } = req.body
    if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
      res.status(400).json({ error: 'imageDataUrl is required (data:image/... format)' })
      return
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { imageUrl: imageDataUrl }
    })

    logger.info('Post image uploaded from editor', { postId: post.id })
    res.json({ imageUrl: updated.imageUrl })
  } catch (err) {
    logger.error('Failed to upload image', { err })
    res.status(500).json({ error: 'Failed to upload image' })
  }
})

// Delete post
router.delete('/posts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }
    if (post.status === 'PUBLISHING') {
      res.status(400).json({ error: 'Cannot delete a post that is currently publishing' })
      return
    }

    await prisma.scheduledPost.delete({ where: { id: post.id } })
    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to delete post', { err })
    res.status(500).json({ error: 'Failed to delete post' })
  }
})

// Approve draft
router.post('/posts/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }
    if (post.status !== 'DRAFT' && post.status !== 'FAILED') {
      res.status(400).json({ error: 'Can only approve DRAFT or FAILED posts' })
      return
    }

    const { scheduledAt, publishNow } = req.body

    if (publishNow) {
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'PUBLISHING' }
      })
      await socialPublishQueue.add({ postId: post.id }, { priority: 1 })
      res.json({ status: 'PUBLISHING', message: 'Post queued for immediate publish' })
      return
    }

    if (!scheduledAt) {
      res.status(400).json({ error: 'scheduledAt is required unless publishNow is true' })
      return
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: 'SCHEDULED', scheduledAt: new Date(scheduledAt) }
    })

    res.json(updated)
  } catch (err) {
    logger.error('Failed to approve post', { err })
    res.status(500).json({ error: 'Failed to approve post' })
  }
})

// Publish now
router.post('/posts/:id/publish', async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!post) { res.status(404).json({ error: 'Post not found' }); return }
    if (post.status !== 'DRAFT' && post.status !== 'SCHEDULED' && post.status !== 'FAILED') {
      res.status(400).json({ error: 'Can only publish DRAFT, SCHEDULED, or FAILED posts' })
      return
    }

    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: 'PUBLISHING' }
    })
    await socialPublishQueue.add({ postId: post.id }, { priority: 1 })

    res.json({ status: 'PUBLISHING', message: 'Post queued for immediate publish' })
  } catch (err) {
    logger.error('Failed to publish post', { err })
    res.status(500).json({ error: 'Failed to publish post' })
  }
})

// ── Auto-approve setting ──────────────────────────────────────────────────────

router.patch('/settings/auto-approve', async (req: AuthRequest, res: Response) => {
  try {
    const { enabled } = req.body
    const updated = await prisma.client.update({
      where: { id: req.clientId! },
      data: { autoApprovePosts: !!enabled },
      select: { autoApprovePosts: true }
    })
    res.json(updated)
  } catch (err) {
    logger.error('Failed to update auto-approve', { err })
    res.status(500).json({ error: 'Failed to update setting' })
  }
})

router.get('/settings/auto-approve', async (req: AuthRequest, res: Response) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.clientId! },
      select: { autoApprovePosts: true, postReviewLeadHours: true, postReminderHours: true }
    })
    res.json(client)
  } catch (err) {
    logger.error('Failed to get auto-approve', { err })
    res.status(500).json({ error: 'Failed to get setting' })
  }
})

// ── Calendar ────���──────────────────────────────��──────────────────────────────

router.get('/calendar', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const { month } = req.query // YYYY-MM

    if (!month || !/^\d{4}-\d{2}$/.test(month as string)) {
      res.status(400).json({ error: 'month query param required (YYYY-MM)' })
      return
    }

    const startDate = new Date(`${month}-01T00:00:00Z`)
    const endDate = new Date(startDate)
    endDate.setMonth(endDate.getMonth() + 1)

    const posts = await prisma.scheduledPost.findMany({
      where: {
        clientId,
        OR: [
          { scheduledAt: { gte: startDate, lt: endDate } },
          { publishedAt: { gte: startDate, lt: endDate } },
          { createdAt: { gte: startDate, lt: endDate }, scheduledAt: null }
        ]
      },
      include: { analytics: true },
      orderBy: { scheduledAt: 'asc' }
    })

    // Group by date
    const grouped: Record<string, typeof posts> = {}
    for (const post of posts) {
      const date = (post.scheduledAt || post.publishedAt || post.createdAt).toISOString().split('T')[0]
      if (!grouped[date]) grouped[date] = []
      grouped[date].push(post)
    }

    res.json({ month, posts: grouped })
  } catch (err) {
    logger.error('Failed to get calendar', { err })
    res.status(500).json({ error: 'Failed to get calendar' })
  }
})

// ── Analytics ───────────���─────────────────────────────────────────────────────

router.get('/analytics/overview', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const period = (req.query.period as string) || '30d'
    const days = parseInt(period) || 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const insights = await prisma.platformInsight.findMany({
      where: { clientId, fetchedAt: { gte: since } },
      orderBy: { endTime: 'asc' }
    })

    // Aggregate metrics
    const totals: Record<string, number> = {}
    for (const insight of insights) {
      totals[insight.metric] = (totals[insight.metric] || 0) + insight.value
    }

    // Post-level stats
    const publishedPosts = await prisma.scheduledPost.count({
      where: { clientId, status: 'PUBLISHED', publishedAt: { gte: since } }
    })

    const postAnalytics = await prisma.postAnalytics.findMany({
      where: { post: { clientId, publishedAt: { gte: since } } }
    })

    const totalEngagements = postAnalytics.reduce((sum, a) => sum + a.engagements, 0)
    const totalImpressions = postAnalytics.reduce((sum, a) => sum + a.impressions, 0)
    const totalReach = postAnalytics.reduce((sum, a) => sum + a.reach, 0)
    const avgEngagementRate = totalImpressions > 0
      ? (totalEngagements / totalImpressions * 100).toFixed(2)
      : '0.00'

    res.json({
      period,
      platformInsights: totals,
      timeSeries: insights,
      posts: {
        published: publishedPosts,
        totalEngagements,
        totalImpressions,
        totalReach,
        avgEngagementRate,
      }
    })
  } catch (err) {
    logger.error('Failed to get analytics overview', { err })
    res.status(500).json({ error: 'Failed to get analytics' })
  }
})

router.get('/analytics/posts', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const { platform, sortBy = 'engagements', limit = '10' } = req.query
    const take = Math.min(parseInt(limit as string, 10) || 10, 50)

    const where: Record<string, unknown> = { clientId, status: 'PUBLISHED' }
    if (platform) where.platform = (platform as string).toUpperCase()

    const posts = await prisma.scheduledPost.findMany({
      where: where as never,
      include: { analytics: true },
      take
    })

    // Sort by analytics field
    const sorted = posts
      .filter(p => p.analytics)
      .sort((a, b) => {
        const aAnalytics = a.analytics as unknown as Record<string, number> | null
        const bAnalytics = b.analytics as unknown as Record<string, number> | null
        const aVal = aAnalytics?.[sortBy as string] || 0
        const bVal = bAnalytics?.[sortBy as string] || 0
        return bVal - aVal
      })

    res.json(sorted)
  } catch (err) {
    logger.error('Failed to get post analytics', { err })
    res.status(500).json({ error: 'Failed to get post analytics' })
  }
})

router.get('/analytics/platforms/:platform', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const platform = req.params.platform.toUpperCase()
    const days = parseInt((req.query.period as string) || '30') || 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const insights = await prisma.platformInsight.findMany({
      where: { clientId, platform: platform as never, fetchedAt: { gte: since } },
      orderBy: { endTime: 'asc' }
    })

    res.json(insights)
  } catch (err) {
    logger.error('Failed to get platform analytics', { err })
    res.status(500).json({ error: 'Failed to get platform analytics' })
  }
})

// ── Competitors ──────────��────────────────────────────────────────────────────

router.get('/competitors', async (req: AuthRequest, res: Response) => {
  try {
    const competitors = await prisma.competitor.findMany({
      where: { clientId: req.clientId!, isActive: true },
      include: { snapshots: { take: 1, orderBy: { fetchedAt: 'desc' } } },
      orderBy: { createdAt: 'desc' }
    })
    res.json(competitors)
  } catch (err) {
    logger.error('Failed to list competitors', { err })
    res.status(500).json({ error: 'Failed to list competitors' })
  }
})

router.post('/competitors', async (req: AuthRequest, res: Response) => {
  try {
    const { name, platform, handle } = req.body
    if (!name || !platform || !handle) {
      res.status(400).json({ error: 'name, platform, and handle are required' })
      return
    }

    const competitor = await prisma.competitor.create({
      data: {
        id: randomUUID(),
        clientId: req.clientId!,
        name,
        platform: platform.toUpperCase(),
        handle
      }
    })

    res.status(201).json(competitor)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'Competitor already exists for this platform' })
      return
    }
    logger.error('Failed to add competitor', { err })
    res.status(500).json({ error: 'Failed to add competitor' })
  }
})

router.delete('/competitors/:id', async (req: AuthRequest, res: Response) => {
  try {
    const competitor = await prisma.competitor.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!competitor) { res.status(404).json({ error: 'Competitor not found' }); return }

    await prisma.competitor.delete({ where: { id: competitor.id } })
    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to delete competitor', { err })
    res.status(500).json({ error: 'Failed to delete competitor' })
  }
})

router.get('/competitors/:id/snapshots', async (req: AuthRequest, res: Response) => {
  try {
    const competitor = await prisma.competitor.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!competitor) { res.status(404).json({ error: 'Competitor not found' }); return }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 100)
    const snapshots = await prisma.competitorSnapshot.findMany({
      where: { competitorId: competitor.id },
      orderBy: { fetchedAt: 'desc' },
      take: limit
    })

    res.json(snapshots)
  } catch (err) {
    logger.error('Failed to get competitor snapshots', { err })
    res.status(500).json({ error: 'Failed to get snapshots' })
  }
})

// ── News ─────────���──────────────────────────────────���─────────────────────────

router.get('/news', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = req.clientId!
    const { category, limit = '30', saved } = req.query

    const where: Record<string, unknown> = { clientId }
    if (category) where.category = category as string
    if (saved === 'true') where.isSaved = true

    const take = Math.min(parseInt(limit as string, 10) || 30, 100)
    const items = await prisma.newsItem.findMany({
      where: where as never,
      orderBy: { publishedAt: 'desc' },
      take
    })

    res.json(items)
  } catch (err) {
    logger.error('Failed to list news', { err })
    res.status(500).json({ error: 'Failed to list news' })
  }
})

router.patch('/news/:id', async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.newsItem.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!item) { res.status(404).json({ error: 'News item not found' }); return }

    const { isRead, isSaved } = req.body
    const data: Record<string, unknown> = {}
    if (isRead !== undefined) data.isRead = !!isRead
    if (isSaved !== undefined) data.isSaved = !!isSaved

    const updated = await prisma.newsItem.update({
      where: { id: item.id },
      data: data as never
    })

    res.json(updated)
  } catch (err) {
    logger.error('Failed to update news item', { err })
    res.status(500).json({ error: 'Failed to update news item' })
  }
})

router.delete('/news/:id', async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.newsItem.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!item) { res.status(404).json({ error: 'News item not found' }); return }

    await prisma.newsItem.delete({ where: { id: item.id } })
    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to delete news item', { err })
    res.status(500).json({ error: 'Failed to delete news item' })
  }
})

// News sources config (stored in ClientCredential)
router.post('/news/sources', async (req: AuthRequest, res: Response) => {
  try {
    const { rssFeeds, keywords, newsApiKey } = req.body
    const data = JSON.stringify({ rssFeeds, keywords, newsApiKey })

    await prisma.clientCredential.upsert({
      where: { id: `news-sources-${req.clientId!}` },
      create: {
        id: `news-sources-${req.clientId!}`,
        clientId: req.clientId!,
        service: 'news-sources',
        credentials: data
      },
      update: { credentials: data }
    })

    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to save news sources', { err })
    res.status(500).json({ error: 'Failed to save news sources' })
  }
})

router.get('/news/sources', async (req: AuthRequest, res: Response) => {
  try {
    const cred = await prisma.clientCredential.findFirst({
      where: { clientId: req.clientId!, service: 'news-sources' }
    })
    if (!cred) { res.json({ rssFeeds: [], keywords: [] }); return }

    const data = JSON.parse(cred.credentials)
    res.json(data)
  } catch (err) {
    logger.error('Failed to get news sources', { err })
    res.status(500).json({ error: 'Failed to get news sources' })
  }
})

export default router
