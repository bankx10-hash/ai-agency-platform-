import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { onboardingQueue } from '../queue/onboarding.queue'
import { encryptJSON } from '../utils/encrypt'
import { emailService } from '../services/email.service'
import { google } from 'googleapis'
import { logger } from '../utils/logger'
import { z } from 'zod'

const router = Router()
const prisma = new PrismaClient()

const startOnboardingSchema = z.object({
  clientId: z.string(),
  stripeSessionId: z.string().optional(),
  voiceConfig: z.object({
    greetingScript: z.string().optional(),
    faqKnowledgeBase: z.string().optional(),
    qualificationQuestions: z.array(z.string()).optional(),
    escalationNumber: z.string().optional(),
    bookingLink: z.string().optional(),
    address: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string().optional(),
      postcode: z.string().optional()
    }).optional()
  }).optional()
})

const connectCRMSchema = z.object({
  crmType: z.enum(['gohighlevel', 'hubspot', 'salesforce', 'zoho', 'none']),
  apiKey: z.string().optional(),
  locationId: z.string().optional()   // GHL-specific: sub-account location ID
})

const connectGmailSchema = z.object({
  code: z.string()
})

router.post('/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = startOnboardingSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.errors })
      return
    }

    const { clientId, voiceConfig } = parsed.data

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      res.status(404).json({ error: 'Client not found' })
      return
    }

    const existingOnboarding = await prisma.onboarding.findUnique({ where: { clientId } })
    if (!existingOnboarding) {
      await prisma.onboarding.create({
        data: {
          clientId,
          step: 1,
          status: 'IN_PROGRESS',
          data: { startedAt: new Date().toISOString(), ...(voiceConfig && { voiceConfig }) }
        }
      })
    } else {
      // Reset so a retry can run cleanly
      await prisma.onboarding.update({
        where: { clientId },
        data: {
          step: 1,
          status: 'IN_PROGRESS',
          completedAt: null,
          data: { startedAt: new Date().toISOString(), ...(voiceConfig && { voiceConfig }) }
        }
      })
    }

    // Remove any existing stale job with this ID so Bull accepts the new one
    try {
      const existingJob = await onboardingQueue.getJob(`onboarding-${clientId}`)
      if (existingJob) {
        await existingJob.remove()
      }
    } catch {
      // Ignore — job may already be gone
    }

    await onboardingQueue.add(
      { clientId },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        jobId: `onboarding-${clientId}`
      }
    )

    logger.info('Onboarding job queued', { clientId })

    res.json({ message: 'Onboarding started', clientId })
  } catch (error) {
    logger.error('Error starting onboarding', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:clientId/reset', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params
    if (req.clientId !== clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    await prisma.onboarding.update({
      where: { clientId },
      data: { step: 1, status: 'IN_PROGRESS', completedAt: null, data: { startedAt: new Date().toISOString() } }
    })

    try {
      const existingJob = await onboardingQueue.getJob(`onboarding-${clientId}`)
      if (existingJob) await existingJob.remove()
    } catch { /* ignore */ }

    await onboardingQueue.add(
      { clientId },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, jobId: `onboarding-${clientId}` }
    )

    logger.info('Onboarding reset and re-queued', { clientId })
    res.json({ message: 'Onboarding reset successfully' })
  } catch (error) {
    logger.error('Error resetting onboarding', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:clientId/status', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params

    if (req.clientId !== clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const onboarding = await prisma.onboarding.findUnique({
      where: { clientId }
    })

    if (!onboarding) {
      res.status(404).json({ error: 'Onboarding not found' })
      return
    }

    const agents = await prisma.agentDeployment.findMany({
      where: { clientId },
      select: { agentType: true, status: true }
    })

    res.json({
      onboarding: {
        step: onboarding.step,
        status: onboarding.status,
        data: onboarding.data,
        completedAt: onboarding.completedAt
      },
      agents
    })
  } catch (error) {
    logger.error('Error fetching onboarding status', { error, clientId: req.params.clientId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:clientId/connect-calendar', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params
    if (req.clientId !== clientId) { res.status(403).json({ error: 'Forbidden' }); return }

    const { provider, apiKey, bookingLink } = req.body as { provider: string; apiKey?: string; bookingLink?: string }

    if (provider === 'calcom' && apiKey) {
      const encrypted = encryptJSON({ apiKey, provider: 'calcom' })
      await prisma.clientCredential.upsert({
        where: { id: `calcom-${clientId}` },
        update: { credentials: encrypted, service: 'calcom' },
        create: { id: `calcom-${clientId}`, clientId, service: 'calcom', credentials: encrypted }
      })
    }

    if (bookingLink) {
      await prisma.onboarding.updateMany({
        where: { clientId },
        data: { data: { bookingLink } as never }
      })
    }

    logger.info('Calendar connected', { clientId, provider })
    res.json({ message: 'Calendar connected', provider })
  } catch (error) {
    logger.error('Error connecting calendar', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:clientId/connect-crm', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params

    if (req.clientId !== clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const parsed = connectCRMSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.errors })
      return
    }

    const { crmType, apiKey, locationId } = parsed.data

    if (crmType !== 'none' && apiKey) {
      const credPayload: Record<string, string> = { crmType, apiKey }

      // GHL requires a locationId to scope all API calls to the correct sub-account
      if (crmType === 'gohighlevel') {
        if (!locationId) {
          res.status(400).json({ error: 'GoHighLevel requires a Location ID' })
          return
        }
        credPayload.locationId = locationId

        // locationId stored in ClientCredential below — no separate Client column needed
      }

      const encryptedCreds = encryptJSON(credPayload)

      await prisma.clientCredential.upsert({
        where: { id: `crm-${clientId}` },
        update: { credentials: encryptedCreds, service: crmType },
        create: {
          id: `crm-${clientId}`,
          clientId,
          service: crmType,
          credentials: encryptedCreds
        }
      })
    }

    await prisma.onboarding.update({
      where: { clientId },
      data: {
        data: {
          crmConnected: true,
          crmType
        }
      }
    })

    logger.info('CRM connected', { clientId, crmType })

    res.json({ message: 'CRM connected successfully', crmType })
  } catch (error) {
    logger.error('Error connecting CRM', { error, clientId: req.params.clientId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:clientId/connect-gmail', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params

    if (req.clientId !== clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const parsed = connectGmailSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.errors })
      return
    }

    const { code } = parsed.data

    const tokens = await emailService.exchangeCodeForTokens(code)

    const encryptedCreds = encryptJSON({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      email: tokens.email
    })

    await prisma.clientCredential.upsert({
      where: { id: `gmail-${clientId}` },
      update: { credentials: encryptedCreds },
      create: {
        id: `gmail-${clientId}`,
        clientId,
        service: 'gmail',
        credentials: encryptedCreds
      }
    })

    await prisma.onboarding.update({
      where: { clientId },
      data: {
        data: {
          emailConnected: true,
          gmailEmail: tokens.email
        }
      }
    })

    logger.info('Gmail connected', { clientId, gmailEmail: tokens.email })

    res.json({ message: 'Gmail connected successfully', email: tokens.email })
  } catch (error) {
    logger.error('Error connecting Gmail', { error, clientId: req.params.clientId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/gmail/auth-url', (req: Request, res: Response): void => {
  try {
    const authUrl = emailService.getGmailAuthUrl()
    res.json({ url: authUrl })
  } catch (error) {
    logger.error('Error generating Gmail auth URL', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Generic OAuth auth-url endpoint for all platforms
router.get('/oauth/:platform/auth-url', (req: Request, res: Response): void => {
  const { platform } = req.params
  const { clientId } = req.query as { clientId?: string }
  const apiBase = process.env.API_BASE_URL || 'http://localhost:4000'
  const portalBase = process.env.PORTAL_BASE_URL || 'http://localhost:3000'

  try {
    let url: string

    switch (platform) {
      case 'gmail': {
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = emailService.getGmailAuthUrl(state)
        break
      }
      case 'facebook':
      case 'instagram': {
        const metaClientId = process.env.META_APP_ID
        if (!metaClientId) { res.status(500).json({ error: 'META_APP_ID not configured' }); return }
        const scope = platform === 'instagram'
          ? 'instagram_basic,instagram_content_publish,pages_read_engagement,pages_manage_posts'
          : 'pages_manage_posts,pages_read_engagement,pages_show_list'
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/meta/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId, platform }))
        url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${metaClientId}&redirect_uri=${redirect}&scope=${scope}&state=${state}&response_type=code`
        break
      }
      case 'tiktok': {
        const tiktokKey = process.env.TIKTOK_CLIENT_KEY
        if (!tiktokKey) { res.status(500).json({ error: 'TIKTOK_CLIENT_KEY not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/tiktok/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = `https://www.tiktok.com/v2/auth/authorize?client_key=${tiktokKey}&redirect_uri=${redirect}&scope=user.info.basic,video.upload,video.publish&response_type=code&state=${state}`
        break
      }
      case 'twitter': {
        const twitterClientId = process.env.TWITTER_CLIENT_ID
        if (!twitterClientId) { res.status(500).json({ error: 'TWITTER_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/twitter/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${twitterClientId}&redirect_uri=${redirect}&scope=tweet.read%20tweet.write%20users.read%20offline.access&state=${state}&code_challenge=challenge&code_challenge_method=plain`
        break
      }
      case 'linkedin': {
        const linkedinClientId = process.env.LINKEDIN_CLIENT_ID
        if (!linkedinClientId) { res.status(500).json({ error: 'LINKEDIN_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/linkedin/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${linkedinClientId}&redirect_uri=${redirect}&scope=openid%20profile%20email%20w_member_social&state=${state}`
        break
      }
      case 'gohighlevel': {
        const ghlClientId = process.env.GHL_OAUTH_CLIENT_ID
        if (!ghlClientId) { res.status(500).json({ error: 'GHL_OAUTH_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/gohighlevel/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${ghlClientId}&redirect_uri=${redirect}&scope=contacts.readonly%20contacts.write%20opportunities.readonly%20opportunities.write&state=${state}`
        break
      }
      case 'calendly': {
        const calendlyClientId = process.env.CALENDLY_CLIENT_ID
        if (!calendlyClientId) { res.status(500).json({ error: 'CALENDLY_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/calendly/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = `https://auth.calendly.com/oauth/authorize?client_id=${calendlyClientId}&redirect_uri=${redirect}&response_type=code&state=${state}`
        break
      }
      case 'google-calendar': {
        const gcalClientId = process.env.GMAIL_CLIENT_ID
        const gcalClientSecret = process.env.GMAIL_CLIENT_SECRET
        if (!gcalClientId || !gcalClientSecret) { res.status(500).json({ error: 'Google credentials not configured' }); return }
        const redirectUri = `${apiBase}/onboarding/oauth/google-calendar/callback`
        const oauth2Client = new google.auth.OAuth2(gcalClientId, gcalClientSecret, redirectUri)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
          prompt: 'consent',
          state
        })
        break
      }
      case 'hubspot': {
        const hubspotClientId = process.env.HUBSPOT_CLIENT_ID
        if (!hubspotClientId) { res.status(500).json({ error: 'HUBSPOT_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/hubspot/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = `https://app.hubspot.com/oauth/authorize?client_id=${hubspotClientId}&redirect_uri=${redirect}&scope=crm.objects.contacts.read%20crm.objects.contacts.write%20crm.objects.deals.read%20crm.objects.deals.write&state=${state}`
        break
      }
      case 'salesforce': {
        const sfClientId = process.env.SALESFORCE_CLIENT_ID
        if (!sfClientId) { res.status(500).json({ error: 'SALESFORCE_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/salesforce/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = `https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=${sfClientId}&redirect_uri=${redirect}&state=${state}`
        break
      }
      case 'zoho': {
        const zohoClientId = process.env.ZOHO_CLIENT_ID
        if (!zohoClientId) { res.status(500).json({ error: 'ZOHO_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/zoho/callback`)
        const state = encodeURIComponent(JSON.stringify({ clientId }))
        url = `https://accounts.zoho.com/oauth/v2/auth?scope=ZohoCRM.modules.contacts.ALL,ZohoCRM.modules.leads.ALL&client_id=${zohoClientId}&response_type=code&access_type=offline&redirect_uri=${redirect}&state=${state}`
        break
      }
      default:
        res.status(400).json({ error: `Unknown platform: ${platform}` })
        return
    }

    logger.info('OAuth auth URL generated', { platform, clientId })
    res.json({ url })
  } catch (error) {
    logger.error('Error generating OAuth auth URL', { error, platform })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// OAuth callback — exchanges code for tokens and stores encrypted credentials
router.get('/oauth/:platform/callback', async (req: Request, res: Response): Promise<void> => {
  const { platform } = req.params
  const { code, state, error: oauthError } = req.query as Record<string, string>
  const portalBase = process.env.PORTAL_BASE_URL || 'http://localhost:3000'
  const apiBase = process.env.API_BASE_URL || 'http://localhost:4000'

  if (oauthError) {
    res.redirect(`${portalBase}/onboarding/connect?error=${encodeURIComponent(oauthError)}`)
    return
  }

  let clientId = ''
  let statePlatform = platform
  try {
    const parsed = JSON.parse(decodeURIComponent(state || '{}'))
    clientId = parsed.clientId || ''
    if (parsed.platform) statePlatform = parsed.platform
  } catch {
    res.redirect(`${portalBase}/onboarding/connect?error=invalid_state`)
    return
  }

  if (!clientId) {
    res.redirect(`${portalBase}/onboarding/connect?error=missing_client`)
    return
  }

  try {
    let credentials: Record<string, string> = {}

    if (platform === 'gmail') {
      const tokens = await emailService.exchangeCodeForTokens(code)
      credentials = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        email: tokens.email
      }
    } else if (platform === 'calendly') {
      const tokenRes = await axios.post(
        'https://auth.calendly.com/oauth/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.CALENDLY_CLIENT_ID || '',
          client_secret: process.env.CALENDLY_CLIENT_SECRET || '',
          redirect_uri: `${apiBase}/onboarding/oauth/calendly/callback`,
          code
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )
      // Fetch user info to get scheduling URL
      const userRes = await axios.get('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
      })
      credentials = {
        accessToken: tokenRes.data.access_token,
        refreshToken: tokenRes.data.refresh_token || '',
        schedulingUrl: userRes.data.resource?.scheduling_url || '',
        userUri: userRes.data.resource?.uri || ''
      }
    } else if (platform === 'google-calendar') {
      const redirectUri = `${apiBase}/onboarding/oauth/google-calendar/callback`
      const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, redirectUri)
      const { tokens } = await oauth2Client.getToken(code)
      credentials = {
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token || '',
        expiresIn: String(tokens.expiry_date || '')
      }
    } else if (platform === 'meta') {
      const metaAppId = process.env.META_APP_ID
      const metaAppSecret = process.env.META_APP_SECRET
      const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          client_id: metaAppId,
          client_secret: metaAppSecret,
          code,
          redirect_uri: `${apiBase}/onboarding/oauth/meta/callback`
        }
      })
      credentials = {
        accessToken: tokenRes.data.access_token,
        platform: statePlatform
      }
    } else if (platform === 'linkedin') {
      const tokenRes = await axios.post(
        'https://www.linkedin.com/oauth/v2/accessToken',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${apiBase}/onboarding/oauth/linkedin/callback`,
          client_id: process.env.LINKEDIN_CLIENT_ID || '',
          client_secret: process.env.LINKEDIN_CLIENT_SECRET || ''
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )
      credentials = {
        accessToken: tokenRes.data.access_token,
        refreshToken: tokenRes.data.refresh_token || '',
        expiresIn: String(tokenRes.data.expires_in || '')
      }
    } else if (platform === 'hubspot') {
      const tokenRes = await axios.post(
        'https://api.hubapi.com/oauth/v1/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.HUBSPOT_CLIENT_ID || '',
          client_secret: process.env.HUBSPOT_CLIENT_SECRET || '',
          redirect_uri: `${apiBase}/onboarding/oauth/hubspot/callback`,
          code
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )
      credentials = {
        accessToken: tokenRes.data.access_token,
        refreshToken: tokenRes.data.refresh_token || '',
        expiresIn: String(tokenRes.data.expires_in || '')
      }
    } else {
      credentials = { code, connectedAt: new Date().toISOString() }
    }

    const storePlatform = platform === 'meta' ? statePlatform : platform
    const encrypted = encryptJSON({ ...credentials, connectedAt: new Date().toISOString() })

    await prisma.clientCredential.upsert({
      where: { id: `${storePlatform}-${clientId}` },
      update: { credentials: encrypted, service: storePlatform },
      create: { id: `${storePlatform}-${clientId}`, clientId, service: storePlatform, credentials: encrypted }
    })

    logger.info('OAuth callback completed', { platform: storePlatform, clientId })
    res.redirect(`${portalBase}/onboarding/connect?connected=${storePlatform}`)
  } catch (error) {
    logger.error('OAuth callback error', { error, platform, clientId })
    res.redirect(`${portalBase}/onboarding/connect?error=callback_failed`)
  }
})

export default router
