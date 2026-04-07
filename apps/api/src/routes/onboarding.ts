import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import axios from 'axios'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { onboardingQueue } from '../queue/onboarding.queue'
import { encryptJSON } from '../utils/encrypt'
import { emailService } from '../services/email.service'
import { google } from 'googleapis'
import { logger } from '../utils/logger'
import { z } from 'zod'

const router = Router()

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
  const { clientId, returnTo } = req.query as { clientId?: string; returnTo?: string }
  const apiBase = process.env.API_BASE_URL || 'http://localhost:4000'

  try {
    let url: string
    // returnTo is included in state so the callback knows where to send the user back
    const baseState = { clientId, ...(returnTo ? { returnTo } : {}) }

    switch (platform) {
      case 'gmail': {
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = emailService.getGmailAuthUrl(state)
        break
      }
      case 'facebook':
      case 'instagram': {
        const metaClientId = process.env.META_APP_ID
        if (!metaClientId) { res.status(500).json({ error: 'META_APP_ID not configured' }); return }
        // Same scope for both facebook and instagram buttons — one OAuth connects both
        const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish,pages_messaging,instagram_manage_messages,instagram_manage_comments,pages_manage_engagement'
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/meta/callback`)
        const state = encodeURIComponent(JSON.stringify({ ...baseState, platform }))
        url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${metaClientId}&redirect_uri=${redirect}&scope=${scope}&state=${state}&response_type=code`
        break
      }
      case 'tiktok': {
        const tiktokKey = process.env.TIKTOK_CLIENT_KEY
        if (!tiktokKey) { res.status(500).json({ error: 'TIKTOK_CLIENT_KEY not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/tiktok/callback`)
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = `https://www.tiktok.com/v2/auth/authorize?client_key=${tiktokKey}&redirect_uri=${redirect}&scope=user.info.basic,video.upload,video.publish&response_type=code&state=${state}`
        break
      }
      case 'twitter': {
        const twitterClientId = process.env.TWITTER_CLIENT_ID
        if (!twitterClientId) { res.status(500).json({ error: 'TWITTER_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/twitter/callback`)
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${twitterClientId}&redirect_uri=${redirect}&scope=tweet.read%20tweet.write%20users.read%20offline.access&state=${state}&code_challenge=challenge&code_challenge_method=plain`
        break
      }
      case 'linkedin': {
        const linkedinClientId = process.env.LINKEDIN_CLIENT_ID
        if (!linkedinClientId) { res.status(500).json({ error: 'LINKEDIN_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/linkedin/callback`)
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${linkedinClientId}&redirect_uri=${redirect}&scope=openid%20profile%20email%20w_member_social&state=${state}&prompt=login`
        break
      }
      case 'gohighlevel': {
        const ghlClientId = process.env.GHL_OAUTH_CLIENT_ID
        if (!ghlClientId) { res.status(500).json({ error: 'GHL_OAUTH_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/gohighlevel/callback`)
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${ghlClientId}&redirect_uri=${redirect}&scope=contacts.readonly%20contacts.write%20opportunities.readonly%20opportunities.write&state=${state}`
        break
      }
      case 'calendly': {
        const calendlyClientId = process.env.CALENDLY_CLIENT_ID
        if (!calendlyClientId) { res.status(500).json({ error: 'CALENDLY_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/calendly/callback`)
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = `https://auth.calendly.com/oauth/authorize?client_id=${calendlyClientId}&redirect_uri=${redirect}&response_type=code&state=${state}`
        break
      }
      case 'google-calendar': {
        const gcalClientId = process.env.GMAIL_CLIENT_ID
        const gcalClientSecret = process.env.GMAIL_CLIENT_SECRET
        if (!gcalClientId || !gcalClientSecret) { res.status(500).json({ error: 'Google credentials not configured' }); return }
        const redirectUri = `${apiBase}/onboarding/oauth/google-calendar/callback`
        const oauth2Client = new google.auth.OAuth2(gcalClientId, gcalClientSecret, redirectUri)
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
          prompt: 'consent',
          state
        })
        break
      }
      case 'hubspot': {
        const hubspotClientId = process.env.HUBSPOT_CLIENT_ID
        if (!hubspotClientId) { res.status(500).json({ error: 'HUBSPOT_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/hubspot/callback`)
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = `https://app.hubspot.com/oauth/authorize?client_id=${hubspotClientId}&redirect_uri=${redirect}&scope=crm.objects.contacts.read%20crm.objects.contacts.write%20crm.objects.deals.read%20crm.objects.deals.write&state=${state}`
        break
      }
      case 'salesforce': {
        const sfClientId = process.env.SALESFORCE_CLIENT_ID
        if (!sfClientId) { res.status(500).json({ error: 'SALESFORCE_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/salesforce/callback`)
        const state = encodeURIComponent(JSON.stringify(baseState))
        url = `https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=${sfClientId}&redirect_uri=${redirect}&state=${state}`
        break
      }
      case 'zoho': {
        const zohoClientId = process.env.ZOHO_CLIENT_ID
        if (!zohoClientId) { res.status(500).json({ error: 'ZOHO_CLIENT_ID not configured' }); return }
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/zoho/callback`)
        const state = encodeURIComponent(JSON.stringify(baseState))
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
  let returnTo = ''
  try {
    const parsed = JSON.parse(decodeURIComponent(state || '{}'))
    clientId = parsed.clientId || ''
    if (parsed.platform) statePlatform = parsed.platform
    if (parsed.returnTo) returnTo = parsed.returnTo
  } catch {
    res.redirect(`${portalBase}/onboarding/connect?error=invalid_state`)
    return
  }

  // Where to send the user back after OAuth — dashboard/connections or onboarding/connect
  const redirectBase = returnTo ? `${portalBase}${returnTo}` : `${portalBase}/onboarding/connect`

  if (!clientId) {
    res.redirect(`${redirectBase}?error=missing_client`)
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

      // Exchange code for short-lived user token
      const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: { client_id: metaAppId, client_secret: metaAppSecret, code, redirect_uri: `${apiBase}/onboarding/oauth/meta/callback` }
      })

      // Exchange for long-lived user token (60 days)
      const longTokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: { grant_type: 'fb_exchange_token', client_id: metaAppId, client_secret: metaAppSecret, fb_exchange_token: tokenRes.data.access_token }
      })
      const userToken: string = longTokenRes.data.access_token

      // Fetch pages managed by this user (with page access token + Instagram account)
      const pagesRes = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
        params: { access_token: userToken, fields: 'id,name,access_token,instagram_business_account' }
      })
      const pages: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }> = pagesRes.data.data || []
      if (!pages.length) throw new Error('No Facebook pages found — you must be an admin of at least one Facebook Page')
      const page = pages[0]

      // Store Facebook credentials
      await prisma.clientCredential.upsert({
        where: { id: `facebook-${clientId}` },
        update: { credentials: encryptJSON({ pageId: page.id, pageName: page.name, accessToken: page.access_token, connectedAt: new Date().toISOString() }), service: 'facebook' },
        create: { id: `facebook-${clientId}`, clientId, service: 'facebook', credentials: encryptJSON({ pageId: page.id, pageName: page.name, accessToken: page.access_token, connectedAt: new Date().toISOString() }) }
      })
      logger.info('Facebook page connected', { clientId, pageId: page.id })

      // Store Instagram credentials if linked
      if (page.instagram_business_account?.id) {
        await prisma.clientCredential.upsert({
          where: { id: `instagram-${clientId}` },
          update: { credentials: encryptJSON({ igUserId: page.instagram_business_account.id, accessToken: page.access_token, connectedAt: new Date().toISOString() }), service: 'instagram' },
          create: { id: `instagram-${clientId}`, clientId, service: 'instagram', credentials: encryptJSON({ igUserId: page.instagram_business_account.id, accessToken: page.access_token, connectedAt: new Date().toISOString() }) }
        })
        logger.info('Instagram Business account connected', { clientId, igUserId: page.instagram_business_account.id })

        // Auto-subscribe the Facebook page to Meta webhooks
        try {
          await axios.post(
            `https://graph.facebook.com/v19.0/${page.id}/subscribed_apps`,
            { subscribed_fields: 'messages,feed,mention,leadgen', access_token: page.access_token },
            { headers: { 'Content-Type': 'application/json' } }
          )
          logger.info('Meta page subscribed to webhooks', { clientId, pageId: page.id })
        } catch (subErr) {
          logger.warn('Failed to subscribe page to webhooks (non-fatal)', { clientId, pageId: page.id, subErr })
        }

        // Also subscribe the Instagram Business Account to webhooks for DMs and comments
        try {
          await axios.post(
            `https://graph.facebook.com/v19.0/${page.instagram_business_account.id}/subscribed_apps`,
            { subscribed_fields: 'messages,comments,mentions', access_token: page.access_token },
            { headers: { 'Content-Type': 'application/json' } }
          )
          logger.info('Instagram account subscribed to webhooks', { clientId, igUserId: page.instagram_business_account.id })
        } catch (subErr) {
          logger.warn('Failed to subscribe Instagram account to webhooks (non-fatal)', { clientId, igUserId: page.instagram_business_account.id, subErr })
        }

        res.redirect(`${redirectBase}?connected=facebook&connected=instagram`)
      } else {
        logger.warn('No Instagram Business account linked to this Facebook page', { clientId })

        // Still subscribe page to webhooks even without Instagram
        try {
          await axios.post(
            `https://graph.facebook.com/v19.0/${page.id}/subscribed_apps`,
            { subscribed_fields: 'messages,feed,mention,leadgen', access_token: page.access_token },
            { headers: { 'Content-Type': 'application/json' } }
          )
          logger.info('Meta page subscribed to webhooks', { clientId, pageId: page.id })
        } catch (subErr) {
          logger.warn('Failed to subscribe page to webhooks (non-fatal)', { clientId, pageId: page.id, subErr })
        }

        res.redirect(`${redirectBase}?connected=facebook`)
      }
      return

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
      const accessToken: string = tokenRes.data.access_token

      // Fetch person ID via OpenID Connect userinfo
      const userRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const personId: string = userRes.data.sub
      const personName: string = userRes.data.name || ''

      credentials = {
        accessToken,
        refreshToken: tokenRes.data.refresh_token || '',
        expiresIn: String(tokenRes.data.expires_in || ''),
        personId,
        personName
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

    // Auto-save Calendly scheduling URL as booking link in onboarding data
    if (platform === 'calendly' && (credentials as Record<string, string>).schedulingUrl) {
      const schedulingUrl = (credentials as Record<string, string>).schedulingUrl
      const existing = await prisma.onboarding.findUnique({ where: { clientId } })
      if (existing) {
        const existingData = (existing.data as Record<string, unknown>) || {}
        if (!existingData.bookingLink) {
          await prisma.onboarding.update({
            where: { clientId },
            data: { data: { ...existingData, bookingLink: schedulingUrl } as never }
          })
          logger.info('Calendly scheduling URL saved as booking link', { clientId, schedulingUrl })
        }
      }
    }

    logger.info('OAuth callback completed', { platform: storePlatform, clientId })
    res.redirect(`${redirectBase}?connected=${storePlatform}`)
  } catch (error) {
    logger.error('OAuth callback error', { error, platform, clientId })
    res.redirect(`${redirectBase}?error=callback_failed`)
  }
})

// GET /onboarding/:clientId/knowledge-base — fetch the upsell knowledge base
router.get('/:clientId/knowledge-base', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params
    const onboarding = await prisma.onboarding.findUnique({ where: { clientId } })
    const data = (onboarding?.data as Record<string, unknown>) || {}
    res.json({ knowledgeBase: (data.upsell_knowledge_base as string) || '' })
  } catch (error) {
    logger.error('Error fetching knowledge base', { error, clientId: req.params.clientId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /onboarding/:clientId/knowledge-base — save the upsell knowledge base for the closer
router.put('/:clientId/knowledge-base', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params
    const { knowledgeBase } = req.body as { knowledgeBase?: string }
    if (typeof knowledgeBase !== 'string') {
      res.status(400).json({ error: 'knowledgeBase must be a string' })
      return
    }

    const existing = await prisma.onboarding.findUnique({ where: { clientId } })
    const existingData = (existing?.data as Record<string, unknown>) || {}
    const newData = { ...existingData, upsell_knowledge_base: knowledgeBase }

    if (existing) {
      await prisma.onboarding.update({
        where: { clientId },
        data: { data: newData as never }
      })
    } else {
      await prisma.onboarding.create({
        data: { clientId, step: 1, data: newData as never }
      })
    }

    // Also push to any active VOICE_CLOSER deployment config so the next agent
    // redeploy picks it up automatically.
    await prisma.agentDeployment.updateMany({
      where: { clientId, agentType: 'VOICE_CLOSER' as never },
      data: {
        config: {
          // Merge: this overwrites the whole config which is fine because the
          // closer reads upsell_knowledge_base on every deploy.
          ...((await prisma.agentDeployment.findFirst({ where: { clientId, agentType: 'VOICE_CLOSER' as never }, select: { config: true } }))?.config as Record<string, unknown> || {}),
          upsell_knowledge_base: knowledgeBase
        } as never
      }
    })

    logger.info('Upsell knowledge base saved', { clientId, length: knowledgeBase.length })
    res.json({ success: true })
  } catch (error) {
    logger.error('Error saving knowledge base', { error, clientId: req.params.clientId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /onboarding/disconnect/:platform — removes stored credentials for a platform
router.get('/:clientId/connections', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params
    if (req.clientId !== clientId) { res.status(403).json({ error: 'Forbidden' }); return }

    const creds = await prisma.clientCredential.findMany({
      where: { clientId },
      select: { service: true }
    })

    const connected: Record<string, boolean> = {}
    for (const c of creds) {
      connected[c.service] = true
    }

    res.json({ connected })
  } catch (error) {
    logger.error('Error fetching connections', { error, clientId: req.params.clientId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/disconnect/:platform', async (req: Request, res: Response): Promise<void> => {
  const { platform } = req.params
  const { clientId } = req.query as { clientId?: string }

  if (!clientId) { res.status(400).json({ error: 'clientId required' }); return }

  try {
    // Meta connects both facebook + instagram — disconnect both
    const platforms = platform === 'facebook' || platform === 'instagram'
      ? ['facebook', 'instagram']
      : [platform]

    for (const p of platforms) {
      await prisma.clientCredential.deleteMany({ where: { clientId, service: p } })
    }

    logger.info('Platform disconnected', { clientId, platform })
    res.json({ success: true, disconnected: platforms })
  } catch (error) {
    logger.error('Disconnect error', { error, platform, clientId })
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

export default router
