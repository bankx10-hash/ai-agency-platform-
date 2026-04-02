import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import { calendarService } from '../services/calendar.service'
import { emailService } from '../services/email.service'
import { logger } from '../utils/logger'

const router = Router()
const prisma = new PrismaClient()

// These endpoints are called by Retell AI tool calling mid-call.
// Auth: simple secret check via x-retell-secret header (set as env var RETELL_TOOL_SECRET).
// The clientId is embedded in the URL so each client's tools point to their own endpoint.

function retellAuth(req: Request, res: Response, next: () => void) {
  const secret = process.env.RETELL_TOOL_SECRET
  if (secret && req.headers['x-retell-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

// Retell sends tool calls as { name, call, args: {...} } by default.
// Extract args from either nested or root level for compatibility.
function extractArgs(body: Record<string, any>): Record<string, any> {
  return body.args && typeof body.args === 'object' ? body.args : body
}

// POST /calendar/:clientId/availability
// Returns available appointment slots as text suitable for the voice agent to read aloud.
// Retell tool calling always sends POST regardless of the operation.
router.post('/:clientId/availability', retellAuth, async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params

  try {
    const { provider, slots } = await calendarService.getAvailableSlots(clientId)

    if (!slots.length) {
      res.json({ result: 'I am sorry, I could not find any available appointment times right now. I will have someone from the team follow up with you to schedule a time.' })
      return
    }

    const slotList = slots.map((s, i) => `Option ${i + 1}: ${s.label}`).join('. ')
    res.json({
      result: `Here are the next available times: ${slotList}. Which of these works best for you?`,
      slots: slots.slice(0, 6),
      provider
    })
  } catch (error) {
    logger.error('Calendar availability check failed', { clientId, error })
    res.json({ result: 'I was unable to check the calendar at this moment. I will have someone follow up with you to confirm a time.' })
  }
})

// POST /calendar/:clientId/book
// Books an appointment. Called by Retell with caller-provided details.
// Body: { start_time: string, caller_name: string, caller_email: string, caller_phone?: string }
router.post('/:clientId/book', retellAuth, async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const args = extractArgs(req.body)
  const { start_time, caller_name, caller_email, caller_phone } = args as {
    start_time: string
    caller_name: string
    caller_email: string
    caller_phone?: string
  }
  logger.info('Calendar book endpoint called', { clientId, hasArgs: !!req.body.args, start_time, caller_name, caller_email })

  if (!start_time || !caller_name || !caller_email) {
    res.json({ result: 'I need your name, email address, and preferred time to complete the booking. Could you confirm those details?' })
    return
  }

  try {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { businessName: true } })
    const businessName = client?.businessName || 'our business'

    const result = await calendarService.bookAppointment(
      clientId,
      start_time,
      { name: caller_name, email: caller_email, phone: caller_phone },
      businessName
    )

    res.json({ result: result.confirmationMessage, booked: result.booked, eventLink: result.eventLink })

    // Notify N8N workflow for ALL booking attempts (booked or link sent)
    // N8N handles confirmation email + appointment metrics logging
    if (result.success !== false && caller_email) {
      const n8nBase = process.env.N8N_BASE_URL || process.env.N8N_WEBHOOK_BASE
      if (n8nBase) {
        const webhookUrl = `${n8nBase}/webhook/voice-calendar-${clientId}`
        logger.info('Sending N8N calendar webhook', { webhookUrl, clientId, caller_email, booked: result.booked })
        axios.post(webhookUrl, {
          contactName: caller_name,
          contactEmail: caller_email,
          contactPhone: caller_phone,
          startTime: start_time,
          businessName,
          eventLink: result.eventLink,
          booked: result.booked,
          bookedAt: new Date().toISOString(),
        }).then(() => {
          logger.info('N8N calendar webhook notified successfully', { clientId, caller_email })
        }).catch((err) => {
          logger.error('N8N calendar webhook FAILED', { clientId, webhookUrl, error: err.message, status: err.response?.status, data: err.response?.data })
        })
      } else {
        logger.error('N8N_BASE_URL not set — cannot notify N8N of booking', { clientId })
      }

      // Direct email fallback — ensures confirmation email is sent even if N8N fails
      if (result.booked && caller_email) {
        const time = new Date(start_time).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        emailService.sendSystemEmail(
          caller_email,
          `Appointment confirmed with ${businessName}`,
          `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">` +
          `<div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:30px;border-radius:10px;text-align:center;margin-bottom:30px">` +
          `<h1 style="color:white;margin:0">Appointment Confirmed!</h1></div>` +
          `<p style="font-size:16px;color:#333">Hi ${caller_name},</p>` +
          `<p style="font-size:16px;color:#333">Your appointment with <strong>${businessName}</strong> is confirmed for <strong>${time}</strong>.</p>` +
          `<p style="font-size:16px;color:#333">A calendar invitation has been sent to your email.</p>` +
          (result.eventLink ? `<div style="text-align:center;margin:30px 0"><a href="${result.eventLink}" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:15px 30px;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold">View Calendar Event</a></div>` : '') +
          `<p style="font-size:14px;color:#666">We look forward to seeing you!<br><strong>The ${businessName} Team</strong></p></div>`
        ).then(() => {
          logger.info('Direct booking confirmation email sent', { clientId, caller_email })
        }).catch((err) => {
          logger.error('Direct booking confirmation email failed', { clientId, caller_email, error: err.message })
        })
      }
    }
  } catch (error) {
    logger.error('Calendar booking failed', { clientId, error })
    res.json({ result: 'I was unable to complete the booking right now. I will have someone from the team follow up with you to confirm.' })
  }
})

export default router
