import nodemailer from 'nodemailer'
import { google } from 'googleapis'
import { logger } from '../utils/logger'

interface EmailCredentials {
  accessToken: string
  refreshToken: string
  email: string
}

interface SendEmailOptions {
  to: string
  subject: string
  body: string
  html?: string
}

const OAuth2 = google.auth.OAuth2

export class EmailService {
  private getOAuth2Client() {
    const clientId = process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GMAIL_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      throw new Error('Gmail OAuth2 credentials not configured')
    }

    return new OAuth2(
      clientId,
      clientSecret,
      'https://developers.google.com/oauthplayground'
    )
  }

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    credentials: EmailCredentials,
    clientId?: string
  ): Promise<void> {
    const oauth2Client = this.getOAuth2Client()

    oauth2Client.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken
    })

    const accessToken = await oauth2Client.getAccessToken()

    // Save refreshed token back to DB so it stays fresh for next use
    if (clientId && accessToken.token && accessToken.token !== credentials.accessToken) {
      try {
        const { prisma } = await import('../lib/prisma')
        const { encryptJSON } = await import('../utils/encrypt')
        const updatedCreds = { ...credentials, accessToken: accessToken.token }
        const encrypted = encryptJSON(updatedCreds as unknown as Record<string, unknown>)
        await prisma.clientCredential.updateMany({
          where: { clientId, service: 'gmail' },
          data: { credentials: encrypted }
        })
        logger.info('Gmail access token refreshed and saved', { clientId })
      } catch (saveErr) {
        logger.warn('Failed to save refreshed Gmail token (non-fatal)', { clientId, err: String(saveErr) })
      }
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: credentials.email,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: credentials.refreshToken,
        accessToken: accessToken.token || ''
      }
    })

    await transporter.sendMail({
      from: credentials.email,
      to,
      subject,
      text: body,
      html: body
    })

    logger.info('Email sent via Gmail OAuth2', { to, subject })
  }

  async sendSystemEmail(
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; content: string }>,
    fromName?: string,
    replyTo?: string
  ): Promise<void> {
    const resendApiKey = process.env.SMTP_PASSWORD
    const defaultFrom = process.env.SMTP_FROM || 'Nodus AI Systems <hello@nodusaisystems.com>'
    const sendingEmail = defaultFrom.match(/<(.+)>/)?.[1] || 'hello@nodusaisystems.com'
    const from = fromName ? `${fromName} <${sendingEmail}>` : defaultFrom

    if (!resendApiKey) {
      logger.warn('Resend API key not configured, skipping email', { to, subject })
      return
    }

    const payload: Record<string, unknown> = { from, to, subject, html }
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments
    }
    if (replyTo) {
      payload.reply_to = replyTo
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Resend API error: ${error}`)
    }

    logger.info('System email sent via Resend', { to, subject })
  }

  async sendWelcomeEmail(
    clientEmail: string,
    businessName: string,
    portalUrl: string,
    clientId?: string,
    phoneNumbers?: Record<string, string>
  ): Promise<void> {
    const apiUrl = process.env.API_URL || 'https://api.nodusaisystems.com'
    const embedSnippet = clientId
      ? `&lt;script src=&quot;${apiUrl}/leads/${clientId}/embed.js&quot;&gt;&lt;/script&gt;`
      : ''

    const listenerSnippet = clientId
      ? `&lt;script src=&quot;${apiUrl}/leads/${clientId}/listener.js&quot;&gt;&lt;/script&gt;`
      : ''
    const webhookUrl = clientId ? `${apiUrl}/leads/${clientId}` : ''

    const websiteSection = clientId ? `
          <div style="background: #FFF7ED; border: 1px solid #FDBA74; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <p style="font-size: 14px; color: #9A3412; margin: 0; font-weight: bold;">Important: Connect your website form before going live</p>
            <p style="font-size: 13px; color: #9A3412; margin: 6px 0 0;">
              Your AI agents are now active and ready to process leads. Make sure your website form is connected using one of the options below so enquiries flow in automatically. Once connected, every submission will be scored, followed up, and called by your AI agents — no manual work needed.
            </p>
          </div>

          <h2 style="color: #667eea;">Connect your website to start capturing leads:</h2>
          <p style="font-size: 15px; color: #333; margin-bottom: 20px;">
            Choose whichever option suits your website best. All three do the same thing — every enquiry is automatically scored by your AI, saved to your CRM, and routed to your appointment setter and outbound caller.
          </p>

          <div style="background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px; margin-bottom: 16px;">
            <h3 style="color: #333; margin: 0 0 8px; font-size: 16px;">Option 1 — Add our ready-made form</h3>
            <p style="font-size: 14px; color: #666; margin: 0 0 12px;">Paste this one line on your website. It adds a professional lead capture form automatically — no design or coding needed.</p>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; color: #333; word-break: break-all;">
              ${embedSnippet}
            </div>
          </div>

          <div style="background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px; margin-bottom: 16px;">
            <h3 style="color: #333; margin: 0 0 8px; font-size: 16px;">Option 2 — Keep your existing form</h3>
            <p style="font-size: 14px; color: #666; margin: 0 0 12px;">Already have a contact form on your website? Paste this line anywhere on the same page. It silently captures every submission and sends it to your AI pipeline in the background — your form keeps working exactly as it does now.</p>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; color: #333; word-break: break-all;">
              ${listenerSnippet}
            </div>
          </div>

          <div style="background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px; margin-bottom: 16px;">
            <h3 style="color: #333; margin: 0 0 8px; font-size: 16px;">Option 3 — Webhook URL (for form builders)</h3>
            <p style="font-size: 14px; color: #666; margin: 0 0 12px;">If you use WordPress (WPForms, Gravity Forms, Contact Form 7), Wix, Squarespace, Typeform, or Jotform — paste this URL into your form builder's webhook or integration settings. We automatically recognise the field names.</p>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; color: #333; word-break: break-all;">
              ${webhookUrl}
            </div>
          </div>

          <div style="background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px; margin-bottom: 16px;">
            <h3 style="color: #333; margin: 0 0 8px; font-size: 16px;">Option 4 — Social media bio link</h3>
            <p style="font-size: 14px; color: #666; margin: 0 0 12px;">A mobile-friendly landing page you can link to from your Instagram bio, Facebook page, Stories, ads, QR codes, or anywhere else. Visitors fill out the form and leads flow straight into your AI pipeline.</p>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; color: #333; word-break: break-all;">
              ${webhookUrl}/page
            </div>
          </div>

          <p style="font-size: 14px; color: #666;">
            You can also find all four options in your dashboard under <strong>Settings &gt; Website Lead Capture</strong>.
          </p>
    ` : ''

    // Build phone number section if any voice agents were provisioned
    const phoneLines: string[] = []
    if (phoneNumbers?.VOICE_INBOUND) {
      phoneLines.push(`<strong>Inbound AI Receptionist:</strong> <span style="font-size:18px;font-weight:bold;color:#333;">${phoneNumbers.VOICE_INBOUND}</span><br><span style="font-size:13px;color:#666;">Set up call forwarding from your main business line to this number. When you can't answer (after hours, on a job, on another call), your AI receptionist picks up, qualifies the caller, and books appointments into your calendar.</span>`)
    }
    if (phoneNumbers?.VOICE_OUTBOUND) {
      phoneLines.push(`<strong>Outbound AI Caller:</strong> <span style="font-size:18px;font-weight:bold;color:#333;">${phoneNumbers.VOICE_OUTBOUND}</span><br><span style="font-size:13px;color:#666;">This is the number your AI uses to call warm leads back. No action needed from you — outbound calls happen automatically when a new lead is scored as warm or hot.</span>`)
    }
    if (phoneNumbers?.VOICE_CLOSER) {
      phoneLines.push(`<strong>AI Closer:</strong> <span style="font-size:18px;font-weight:bold;color:#333;">${phoneNumbers.VOICE_CLOSER}</span><br><span style="font-size:13px;color:#666;">This number calls prospects at their booked appointment time to walk them through your offer and close the deal.</span>`)
    }

    const phoneSection = phoneLines.length > 0 ? `
          <h2 style="color: #667eea;">Your AI phone numbers:</h2>
          <p style="font-size: 15px; color: #333; margin-bottom: 16px;">
            These dedicated phone numbers have been provisioned for your AI agents. Save them — you will need the inbound number to set up call forwarding from your main business line.
          </p>
          <div style="background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 16px 0;">
            ${phoneLines.map(line => `<div style="margin-bottom: 16px; line-height: 1.6;">${line}</div>`).join('')}
          </div>
          <p style="font-size: 14px; color: #666;">
            <strong>How to set up call forwarding:</strong> On your current phone provider, enable "forward on no answer" or "forward when busy" to your inbound AI number above. This way, every call you miss is answered by your AI receptionist instead of going to voicemail.
          </p>
    ` : ''

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Welcome to AI Agency Platform</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0;">Welcome to Nodus AI Systems!</h1>
          </div>

          <p style="font-size: 16px; color: #333;">Hi ${businessName} team,</p>

          <p style="font-size: 16px; color: #333;">
            Your AI agents are now being deployed and configured. Within the next few minutes, your automated workforce will be ready to start generating leads, booking appointments, and growing your business.
          </p>

          <h2 style="color: #667eea;">What's happening right now:</h2>
          <ul style="font-size: 16px; color: #333; line-height: 1.8;">
            <li>Creating your dedicated CRM workspace</li>
            <li>Deploying your AI agents</li>
            <li>Configuring your communication channels</li>
            <li>Running initial system checks</li>
          </ul>

          ${phoneSection}

          ${websiteSection}

          <div style="text-align: center; margin: 30px 0;">
            <a href="${portalUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">
              Access Your Dashboard
            </a>
          </div>

          <p style="font-size: 14px; color: #666;">
            If you have any questions, our support team is here to help. Just reply to this email.
          </p>

          <p style="font-size: 14px; color: #666;">
            Best regards,<br>
            The Nodus AI Systems Team
          </p>
        </body>
      </html>
    `

    await this.sendSystemEmail(
      clientEmail,
      `Welcome to Nodus AI Systems — Your agents are being deployed, ${businessName}!`,
      html
    )
  }

  getGmailAuthUrl(state?: string): string {
    const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:4000/onboarding/oauth/gmail/callback'
    const clientId = process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GMAIL_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error('Gmail OAuth2 credentials not configured')
    }
    const oauth2Client = new OAuth2(clientId, clientSecret, redirectUri)

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email'
      ],
      prompt: 'consent',
      ...(state ? { state } : {})
    })
  }

  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string
    refreshToken: string
    email: string
  }> {
    const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:4000/onboarding/oauth/gmail/callback'
    const clientId = process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GMAIL_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error('Gmail OAuth2 credentials not configured')
    }
    const oauth2Client = new OAuth2(clientId, clientSecret, redirectUri)

    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()

    return {
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || '',
      email: userInfo.data.email || ''
    }
  }
}

export const emailService = new EmailService()
