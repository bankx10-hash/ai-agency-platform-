import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { onboardingQueue } from '../queue/onboarding.queue'
import { encryptJSON } from '../utils/encrypt'
import { emailService } from '../services/email.service'
import { logger } from '../utils/logger'
import { z } from 'zod'

const router = Router()
const prisma = new PrismaClient()

const startOnboardingSchema = z.object({
  clientId: z.string(),
  stripeSessionId: z.string().optional()
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

    const { clientId } = parsed.data

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
          data: { startedAt: new Date().toISOString() }
        }
      })
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

        // Persist locationId directly on the Client record so agents can use it
        await prisma.client.update({
          where: { id: clientId },
          data: { ghlLocationId: locationId }
        })
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
        url = emailService.getGmailAuthUrl()
        break
      }
      case 'facebook':
      case 'instagram': {
        const metaClientId = process.env.META_APP_ID
        if (!metaClientId) { res.status(500).json({ error: 'META_APP_ID not configured' }); return }
        const scope = platform === 'instagram'
          ? 'instagram_basic,instagram_content_publish,pages_read_engagement,pages_manage_posts'
          : 'pages_manage_posts,pages_read_engagement,pages_show_list'
        const redirect = encodeURIComponent(`${apiBase}/onboarding/oauth/facebook/callback`)
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

  if (oauthError) {
    res.redirect(`${portalBase}/onboarding/connect?error=${encodeURIComponent(oauthError)}`)
    return
  }

  let clientId = ''
  try {
    const parsed = JSON.parse(decodeURIComponent(state || '{}'))
    clientId = parsed.clientId || ''
  } catch {
    res.redirect(`${portalBase}/onboarding/connect?error=invalid_state`)
    return
  }

  try {
    // Store the auth code as a pending credential — full token exchange happens async
    const { encryptJSON } = await import('../utils/encrypt')
    const encrypted = encryptJSON({ platform, code, connectedAt: new Date().toISOString() })

    await prisma.clientCredential.upsert({
      where: { id: `${platform}-${clientId}` },
      update: { credentials: encrypted, service: platform },
      create: { id: `${platform}-${clientId}`, clientId, service: platform, credentials: encrypted }
    })

    logger.info('OAuth callback stored', { platform, clientId })
    res.redirect(`${portalBase}/onboarding/connect?connected=${platform}`)
  } catch (error) {
    logger.error('OAuth callback error', { error, platform, clientId })
    res.redirect(`${portalBase}/onboarding/connect?error=callback_failed`)
  }
})

export default router
