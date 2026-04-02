import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import { calendarService } from '../services/calendar.service'
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
  const { start_time, caller_name, caller_email, caller_phone } = req.body as {
    start_time: string
    caller_name: string
    caller_email: string
    caller_phone?: string
  }

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

    // Notify N8N workflow so it sends branded confirmation email + logs metrics
    if (result.booked) {
      const n8nBase = process.env.N8N_BASE_URL || process.env.N8N_WEBHOOK_BASE
      if (n8nBase) {
        axios.post(`${n8nBase}/webhook/voice-calendar-${clientId}`, {
          contactName: caller_name,
          contactEmail: caller_email,
          contactPhone: caller_phone,
          startTime: start_time,
          businessName,
          eventLink: result.eventLink,
          bookedAt: new Date().toISOString(),
        }).then(() => {
          logger.info('N8N calendar webhook notified', { clientId, caller_email })
        }).catch((err) => {
          logger.warn('N8N calendar webhook failed — email may not send', { clientId, error: err.message })
        })
      }
    }
  } catch (error) {
    logger.error('Calendar booking failed', { clientId, error })
    res.json({ result: 'I was unable to complete the booking right now. I will have someone from the team follow up with you to confirm.' })
  }
})

export default router
