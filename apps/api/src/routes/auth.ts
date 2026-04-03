import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import bcrypt from 'bcryptjs'
import { stripeService } from '../services/stripe.service'
import { generateToken } from '../middleware/auth'
import { authRateLimit } from '../middleware/rateLimit'
import { logger } from '../utils/logger'
import { emailService } from '../services/email.service'
import { z } from 'zod'

// In-memory reset token store (tokens expire after 1 hour)
const resetTokens = new Map<string, { clientId: string; email: string; expiresAt: number }>()

const router = Router()

const registerSchema = z.object({
  businessName: z.string().min(1, 'Business name required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().optional(),
  country: z.string().optional().default('AU')
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

router.post('/register', authRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.errors })
      return
    }

    const { businessName, email, password, phone, country } = parsed.data

    const existing = await prisma.client.findUnique({ where: { email } })
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' })
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)

    let stripeCustomerId: string
    try {
      const stripeCustomer = await stripeService.createCustomer(email, businessName)
      stripeCustomerId = stripeCustomer.id
    } catch (stripeError) {
      logger.error('Failed to create Stripe customer', { email, stripeError })
      stripeCustomerId = `manual_${Date.now()}`
    }

    const client = await prisma.client.create({
      data: {
        businessName,
        email,
        phone,
        passwordHash,
        stripeCustomerId,
        country,
        status: 'PENDING',
        plan: 'STARTER'
      }
    })

    const token = generateToken(client.id, client.email)

    logger.info('New client registered', { clientId: client.id, email, businessName })

    res.status(201).json({
      message: 'Account created successfully',
      client: {
        id: client.id,
        email: client.email,
        businessName: client.businessName,
        plan: client.plan,
        status: client.status,
        stripeCustomerId: client.stripeCustomerId
      },
      token,
      clientId: client.id
    })
  } catch (error) {
    logger.error('Registration error', { error })
    res.status(500).json({ error: 'Registration failed. Please try again.' })
  }
})

router.post('/login', authRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' })
      return
    }

    const { email, password } = parsed.data

    const client = await prisma.client.findUnique({ where: { email } })

    if (!client) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    const passwordMatch = await bcrypt.compare(password, client.passwordHash)
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    const token = generateToken(client.id, client.email)

    logger.info('Client logged in', { clientId: client.id, email })

    res.json({
      message: 'Login successful',
      client: {
        id: client.id,
        email: client.email,
        businessName: client.businessName,
        plan: client.plan,
        status: client.status
      },
      token,
      clientId: client.id
    })
  } catch (error) {
    logger.error('Login error', { error })
    res.status(500).json({ error: 'Login failed. Please try again.' })
  }
})

// ─── Forgot Password ─────────────────────────────────────────────────────────
router.post('/forgot-password', authRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body
    if (!email) {
      res.status(400).json({ error: 'Email is required' })
      return
    }

    // Always return success to prevent email enumeration
    const client = await prisma.client.findUnique({ where: { email } })
    if (!client) {
      res.json({ message: 'If an account exists with that email, a reset link has been sent.' })
      return
    }

    // Generate a secure token
    const token = crypto.randomBytes(32).toString('hex')
    resetTokens.set(token, {
      clientId: client.id,
      email: client.email,
      expiresAt: Date.now() + 60 * 60 * 1000 // 1 hour
    })

    const portalUrl = process.env.NEXTAUTH_URL || 'https://app.nodusaisystems.com'
    const resetUrl = `${portalUrl}/reset-password?token=${token}`

    await emailService.sendSystemEmail(
      client.email,
      'Reset your password — Nodus AI Systems',
      `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1a1a2e; margin-bottom: 8px;">Reset your password</h2>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
          Hi ${client.businessName},<br><br>
          We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.
        </p>
        <a href="${resetUrl}" style="display: inline-block; margin: 24px 0; padding: 12px 32px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
          Reset Password
        </a>
        <p style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
          If you didn't request this, you can safely ignore this email.<br>
          Or copy this link: ${resetUrl}
        </p>
      </div>
      `
    )

    logger.info('Password reset email sent', { email: client.email, clientId: client.id })
    res.json({ message: 'If an account exists with that email, a reset link has been sent.' })
  } catch (error) {
    logger.error('Forgot password error', { error })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ─── Reset Password ──────────────────────────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body
    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password are required' })
      return
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' })
      return
    }

    const resetData = resetTokens.get(token)
    if (!resetData) {
      res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' })
      return
    }

    if (Date.now() > resetData.expiresAt) {
      resetTokens.delete(token)
      res.status(400).json({ error: 'Reset link has expired. Please request a new one.' })
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await prisma.client.update({
      where: { id: resetData.clientId },
      data: { passwordHash }
    })

    // Invalidate the token
    resetTokens.delete(token)

    logger.info('Password reset successful', { clientId: resetData.clientId, email: resetData.email })
    res.json({ message: 'Password has been reset. You can now log in.' })
  } catch (error) {
    logger.error('Reset password error', { error })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

export default router
