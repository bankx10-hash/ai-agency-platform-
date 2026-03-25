import axios from 'axios'
import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'
import { decryptJSON } from '../utils/encrypt'
import { emailService } from './email.service'
import { logger } from '../utils/logger'

const prisma = new PrismaClient()

export interface TimeSlot {
  start: string   // ISO 8601
  end: string
  label: string   // "Monday 31 March at 9:00 AM"
}

export interface BookingResult {
  success: boolean
  booked: boolean  // true = confirmed event, false = link sent
  confirmationMessage: string
  eventLink?: string
}

interface CalendlyCredentials {
  accessToken: string
  refreshToken: string
  schedulingUrl: string
  userUri: string
}

interface GoogleCalendarCredentials {
  accessToken: string
  refreshToken: string
  expiresIn?: string
}

interface CalcomCredentials {
  apiKey: string
  provider: 'calcom'
}

async function getCredentials<T>(clientId: string, service: string): Promise<T | null> {
  try {
    const cred = await prisma.clientCredential.findFirst({ where: { clientId, service } })
    if (!cred) return null
    return decryptJSON<T>(cred.credentials)
  } catch {
    return null
  }
}

function formatSlotLabel(isoDate: string): string {
  const d = new Date(isoDate)
  return d.toLocaleString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'Australia/Sydney'
  })
}

function buildSlotsFromFreebusy(busySlots: { start: string; end: string }[], daysAhead = 7): TimeSlot[] {
  const slots: TimeSlot[] = []
  const now = new Date()
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  // Generate 9am–5pm hourly slots for each day, skip busy
  for (let d = new Date(now); d < end; d.setDate(d.getDate() + 1)) {
    for (let hour = 9; hour < 17; hour++) {
      const slotStart = new Date(d)
      slotStart.setHours(hour, 0, 0, 0)
      if (slotStart <= now) continue

      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000)

      const isBusy = busySlots.some(b => {
        const bStart = new Date(b.start)
        const bEnd = new Date(b.end)
        return slotStart < bEnd && slotEnd > bStart
      })

      if (!isBusy) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          label: formatSlotLabel(slotStart.toISOString())
        })
      }

      if (slots.length >= 6) return slots
    }
  }

  return slots
}

export class CalendarService {
  async getCalendarProvider(clientId: string): Promise<'calendly' | 'google-calendar' | 'calcom' | null> {
    const [cal, gcal, calcom] = await Promise.all([
      prisma.clientCredential.findFirst({ where: { clientId, service: 'calendly' } }),
      prisma.clientCredential.findFirst({ where: { clientId, service: 'google-calendar' } }),
      prisma.clientCredential.findFirst({ where: { clientId, service: 'calcom' } })
    ])
    if (cal) return 'calendly'
    if (gcal) return 'google-calendar'
    if (calcom) return 'calcom'
    return null
  }

  async getAvailableSlots(clientId: string): Promise<{ provider: string; slots: TimeSlot[] }> {
    // Try Calendly
    const calendlyCreds = await getCredentials<CalendlyCredentials>(clientId, 'calendly')
    if (calendlyCreds?.accessToken && calendlyCreds.userUri) {
      try {
        const eventTypesRes = await axios.get('https://api.calendly.com/event_types', {
          params: { user: calendlyCreds.userUri, count: 1 },
          headers: { Authorization: `Bearer ${calendlyCreds.accessToken}` }
        })
        const eventTypes = eventTypesRes.data.collection || []
        if (eventTypes.length > 0) {
          const eventTypeUri = eventTypes[0].uri
          const startTime = new Date().toISOString()
          const endTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

          const timesRes = await axios.get('https://api.calendly.com/event_type_available_times', {
            params: { event_type: eventTypeUri, start_time: startTime, end_time: endTime },
            headers: { Authorization: `Bearer ${calendlyCreds.accessToken}` }
          })
          const available = (timesRes.data.collection || []) as Array<{ start_time: string }>
          const slots: TimeSlot[] = available.slice(0, 6).map(t => {
            const endDate = new Date(new Date(t.start_time).getTime() + 60 * 60 * 1000)
            return {
              start: t.start_time,
              end: endDate.toISOString(),
              label: formatSlotLabel(t.start_time)
            }
          })
          return { provider: 'calendly', slots }
        }
      } catch (error) {
        logger.warn('Calendly availability check failed', { clientId, error })
      }
    }

    // Try Google Calendar
    const gcalCreds = await getCredentials<GoogleCalendarCredentials>(clientId, 'google-calendar')
    if (gcalCreds?.accessToken) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GMAIL_CLIENT_ID,
          process.env.GMAIL_CLIENT_SECRET
        )
        oauth2Client.setCredentials({
          access_token: gcalCreds.accessToken,
          refresh_token: gcalCreds.refreshToken
        })
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

        const now = new Date()
        const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

        const freeBusyRes = await calendar.freebusy.query({
          requestBody: {
            timeMin: now.toISOString(),
            timeMax: weekLater.toISOString(),
            items: [{ id: 'primary' }]
          }
        })

        const busySlots = (freeBusyRes.data.calendars?.primary?.busy || []) as { start: string; end: string }[]
        const slots = buildSlotsFromFreebusy(busySlots)
        return { provider: 'google-calendar', slots }
      } catch (error) {
        logger.warn('Google Calendar availability check failed', { clientId, error })
      }
    }

    // Try Cal.com
    const calcomCreds = await getCredentials<CalcomCredentials>(clientId, 'calcom')
    if (calcomCreds?.apiKey) {
      try {
        const res = await axios.get('https://api.cal.com/v1/slots', {
          params: {
            apiKey: calcomCreds.apiKey,
            startTime: new Date().toISOString(),
            endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          }
        })
        const slots: TimeSlot[] = Object.values(res.data.slots || {})
          .flat()
          .slice(0, 6)
          .map((s: unknown) => {
            const slot = s as { time: string }
            const endDate = new Date(new Date(slot.time).getTime() + 60 * 60 * 1000)
            return { start: slot.time, end: endDate.toISOString(), label: formatSlotLabel(slot.time) }
          })
        return { provider: 'calcom', slots }
      } catch (error) {
        logger.warn('Cal.com availability check failed', { clientId, error })
      }
    }

    return { provider: 'none', slots: [] }
  }

  async bookAppointment(
    clientId: string,
    startTime: string,
    contact: { name: string; email: string; phone?: string },
    businessName: string
  ): Promise<BookingResult> {
    const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString()

    // Try Google Calendar (direct booking)
    const gcalCreds = await getCredentials<GoogleCalendarCredentials>(clientId, 'google-calendar')
    if (gcalCreds?.accessToken) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GMAIL_CLIENT_ID,
          process.env.GMAIL_CLIENT_SECRET
        )
        oauth2Client.setCredentials({
          access_token: gcalCreds.accessToken,
          refresh_token: gcalCreds.refreshToken
        })
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

        const event = await calendar.events.insert({
          calendarId: 'primary',
          sendUpdates: 'all',
          requestBody: {
            summary: `Appointment — ${contact.name}`,
            description: `Booked via inbound call for ${businessName}`,
            start: { dateTime: startTime },
            end: { dateTime: endTime },
            attendees: [{ email: contact.email, displayName: contact.name }]
          }
        })

        const slotLabel = formatSlotLabel(startTime)
        await this.sendConfirmationEmail(contact, slotLabel, businessName, event.data.htmlLink || undefined)

        return {
          success: true,
          booked: true,
          confirmationMessage: `I have booked your appointment for ${slotLabel}. A confirmation email has been sent to ${contact.email}.`,
          eventLink: event.data.htmlLink || undefined
        }
      } catch (error) {
        logger.error('Google Calendar booking failed', { clientId, error })
      }
    }

    // Try Cal.com (direct booking)
    const calcomCreds = await getCredentials<CalcomCredentials>(clientId, 'calcom')
    if (calcomCreds?.apiKey) {
      try {
        const res = await axios.post(
          `https://api.cal.com/v1/bookings?apiKey=${calcomCreds.apiKey}`,
          {
            eventTypeId: 1, // default event type
            start: startTime,
            end: endTime,
            responses: { name: contact.name, email: contact.email, phone: contact.phone || '' },
            timeZone: 'Australia/Sydney',
            language: 'en',
            metadata: { source: 'voice-inbound' }
          }
        )
        const slotLabel = formatSlotLabel(startTime)
        await this.sendConfirmationEmail(contact, slotLabel, businessName)

        return {
          success: true,
          booked: true,
          confirmationMessage: `I have booked your appointment for ${slotLabel}. A confirmation email has been sent to ${contact.email}.`,
          eventLink: res.data.uid
        }
      } catch (error) {
        logger.error('Cal.com booking failed', { clientId, error })
      }
    }

    // Calendly: send scheduling link post-call
    const calendlyCreds = await getCredentials<CalendlyCredentials>(clientId, 'calendly')
    if (calendlyCreds?.schedulingUrl) {
      const slotLabel = formatSlotLabel(startTime)
      await this.sendSchedulingLinkEmail(contact, slotLabel, calendlyCreds.schedulingUrl, businessName)

      return {
        success: true,
        booked: false,
        confirmationMessage: `I will send a confirmation link to ${contact.email} right after this call so you can lock in that time.`
      }
    }

    // No calendar connected — send generic booking link if available
    const onboarding = await prisma.onboarding.findUnique({ where: { clientId } })
    const bookingLink = (onboarding?.data as Record<string, unknown>)?.bookingLink as string | undefined
    if (bookingLink) {
      await this.sendSchedulingLinkEmail(contact, formatSlotLabel(startTime), bookingLink, businessName)
      return {
        success: true,
        booked: false,
        confirmationMessage: `I will send a booking link to ${contact.email} right after this call.`
      }
    }

    return {
      success: false,
      booked: false,
      confirmationMessage: 'I will have someone from the team follow up with you shortly to confirm the appointment.'
    }
  }

  private async sendConfirmationEmail(
    contact: { name: string; email: string },
    slotLabel: string,
    businessName: string,
    eventLink?: string
  ): Promise<void> {
    try {
      const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:30px;border-radius:10px;text-align:center;margin-bottom:30px">
    <h1 style="color:white;margin:0">Appointment Confirmed</h1>
  </div>
  <p style="font-size:16px;color:#333">Hi ${contact.name},</p>
  <p style="font-size:16px;color:#333">Your appointment with <strong>${businessName}</strong> has been confirmed for:</p>
  <div style="background:#f8f9ff;border-left:4px solid #667eea;padding:20px;margin:20px 0;border-radius:4px">
    <p style="font-size:18px;font-weight:bold;color:#333;margin:0">${slotLabel}</p>
  </div>
  ${eventLink ? `<p style="font-size:14px;color:#666"><a href="${eventLink}" style="color:#667eea">View in Google Calendar</a></p>` : ''}
  <p style="font-size:14px;color:#666">We look forward to speaking with you.<br><strong>The ${businessName} Team</strong></p>
</div>`

      await emailService.sendSystemEmail(contact.email, `Your appointment with ${businessName} is confirmed`, html)
    } catch (error) {
      logger.error('Failed to send booking confirmation email', { error })
    }
  }

  private async sendSchedulingLinkEmail(
    contact: { name: string; email: string },
    slotLabel: string,
    bookingLink: string,
    businessName: string
  ): Promise<void> {
    try {
      const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:30px;border-radius:10px;text-align:center;margin-bottom:30px">
    <h1 style="color:white;margin:0">Confirm Your Appointment</h1>
  </div>
  <p style="font-size:16px;color:#333">Hi ${contact.name},</p>
  <p style="font-size:16px;color:#333">Thanks for calling <strong>${businessName}</strong>! As discussed, we have reserved <strong>${slotLabel}</strong> for you.</p>
  <p style="font-size:16px;color:#333">Click below to confirm your appointment:</p>
  <div style="text-align:center;margin:30px 0">
    <a href="${bookingLink}" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:15px 30px;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold">Confirm Appointment</a>
  </div>
  <p style="font-size:14px;color:#666">If the button does not work, copy this link: ${bookingLink}</p>
  <p style="font-size:14px;color:#666">Looking forward to speaking with you!<br><strong>The ${businessName} Team</strong></p>
</div>`

      await emailService.sendSystemEmail(contact.email, `Confirm your appointment with ${businessName}`, html)
    } catch (error) {
      logger.error('Failed to send scheduling link email', { error })
    }
  }
}

export const calendarService = new CalendarService()
