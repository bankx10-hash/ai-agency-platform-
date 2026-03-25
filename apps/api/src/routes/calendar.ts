import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
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

// GET /calendar/:clientId/availability
// Returns available appointment slots as text suitable for the voice agent to read aloud.
router.get('/:clientId/availability', retellAuth, async (req: Request, res: Response): Promise<void> => {
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
  } catch (error) {
    logger.error('Calendar booking failed', { clientId, error })
    res.json({ result: 'I was unable to complete the booking right now. I will have someone from the team follow up with you to confirm.' })
  }
})

export default router
