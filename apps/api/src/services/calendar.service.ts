import axios from 'axios'
import { google } from 'googleapis'
import { prisma } from '../lib/prisma'
import { decryptJSON, encryptJSON } from '../utils/encrypt'
import { emailService } from './email.service'
import { logger } from '../utils/logger'

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
  connectedAt?: string
}

interface GoogleCalendarCredentials {
  accessToken: string
  refreshToken: string
  expiresIn?: string
  connectedAt?: string
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

async function saveCredentials(clientId: string, service: string, data: Record<string, unknown>): Promise<void> {
  const encrypted = encryptJSON({ ...data, connectedAt: new Date().toISOString() })
  await prisma.clientCredential.upsert({
    where: { id: `${service}-${clientId}` },
    update: { credentials: encrypted },
    create: { id: `${service}-${clientId}`, clientId, service, credentials: encrypted }
  })
}

// Refresh Calendly access token using refresh token
async function refreshCalendlyToken(clientId: string, creds: CalendlyCredentials): Promise<CalendlyCredentials> {
  try {
    const res = await axios.post(
      'https://auth.calendly.com/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.CALENDLY_CLIENT_ID || '',
        client_secret: process.env.CALENDLY_CLIENT_SECRET || '',
        refresh_token: creds.refreshToken
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    const refreshed: CalendlyCredentials = {
      ...creds,
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token || creds.refreshToken
    }
    await saveCredentials(clientId, 'calendly', refreshed as unknown as Record<string, unknown>)
    logger.info('Calendly token refreshed', { clientId })
    return refreshed
  } catch (error) {
    logger.error('Calendly token refresh failed', { clientId, error })
    return creds  // return original — API call will fail and we handle it upstream
  }
}

// Get a valid Calendly access token, refreshing if needed
async function getCalendlyToken(clientId: string): Promise<CalendlyCredentials | null> {
  const creds = await getCredentials<CalendlyCredentials>(clientId, 'calendly')
  if (!creds?.accessToken) return null

  // Calendly access tokens last ~2 hours. Always refresh proactively to avoid mid-call failures.
  return await refreshCalendlyToken(clientId, creds)
}

// Get a valid Google Calendar access token, letting googleapis handle refresh automatically
async function getGoogleCalendarClient(clientId: string) {
  const creds = await getCredentials<GoogleCalendarCredentials>(clientId, 'google-calendar')
  if (!creds?.accessToken) return null

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  )
  oauth2Client.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken
  })

  // Persist refreshed tokens back to DB automatically
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await saveCredentials(clientId, 'google-calendar', {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || creds.refreshToken,
        expiresIn: String(tokens.expiry_date || '')
      })
      logger.info('Google Calendar token auto-refreshed', { clientId })
    }
  })

  return oauth2Client
}

function toICalDate(iso: string): string {
  // Convert ISO 8601 to iCal UTC format: YYYYMMDDTHHMMSSZ
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace('Z', 'Z').slice(0, 16) + '00Z'
}

function generateICalContent(
  startTime: string,
  endTime: string,
  contactName: string,
  contactEmail: string,
  businessName: string,
  status: 'CONFIRMED' | 'TENTATIVE' = 'CONFIRMED'
): string {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@nodusaisystems.com`
  const dtStamp = toICalDate(new Date().toISOString())
  const dtStart = toICalDate(startTime)
  const dtEnd = toICalDate(endTime)
  const fromEmail = (process.env.SMTP_FROM || 'hello@nodusaisystems.com').match(/<(.+)>/)?.[1] || 'hello@nodusaisystems.com'

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nodus AI Systems//Appointment Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `DTSTAMP:${dtStamp}`,
    `UID:${uid}`,
    `SUMMARY:Appointment with ${businessName}`,
    `DESCRIPTION:Your appointment with ${businessName} has been confirmed.`,
    `ORGANIZER;CN=${businessName}:mailto:${fromEmail}`,
    `ATTENDEE;CN=${contactName};RSVP=FALSE:mailto:${contactEmail}`,
    `STATUS:${status}`,
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
}

const DEFAULT_TIMEZONE = 'Australia/Perth'

function formatSlotLabel(isoDate: string, timezone: string = DEFAULT_TIMEZONE): string {
  const d = new Date(isoDate)
  return d.toLocaleString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: timezone
  })
}

// Convert a local date/hour in a given timezone to a UTC Date object
function localToUtc(date: Date, hour: number, timezone: string): Date {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: timezone }) // YYYY-MM-DD
  // Create a date string in the target timezone and let JS parse it
  const localStr = `${dateStr}T${String(hour).padStart(2, '0')}:00:00`
  // Use Intl to get the UTC offset for this timezone at this moment
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
  const parts = formatter.formatToParts(new Date(`${dateStr}T12:00:00Z`))
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || '+00'
  // Parse offset like "GMT+8" or "GMT-5" or "GMT+10:30"
  const offsetMatch = offsetPart.match(/GMT([+-]?\d+):?(\d+)?/)
  if (offsetMatch) {
    const offsetHours = parseInt(offsetMatch[1])
    const offsetMins = parseInt(offsetMatch[2] || '0')
    const totalOffsetMs = (offsetHours * 60 + (offsetHours < 0 ? -offsetMins : offsetMins)) * 60 * 1000
    const localMs = new Date(localStr + 'Z').getTime()
    return new Date(localMs - totalOffsetMs)
  }
  // Fallback: treat as UTC
  return new Date(localStr + 'Z')
}

// Get day-of-week index (0=Sunday) for a date in a specific timezone
function getDayInTimezone(date: Date, timezone: string): number {
  const dayStr = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone })
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[dayStr] ?? 0
}

interface WorkingHours {
  timezone: string
  days: Array<{ day: number; startHour: number; endHour: number }> // day: 0=Sun, 1=Mon, etc.
}

function buildSlotsFromFreebusy(
  busySlots: { start: string; end: string }[],
  workingHours: WorkingHours,
  daysAhead = 7
): TimeSlot[] {
  const slots: TimeSlot[] = []
  const now = new Date()
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)
  const tz = workingHours.timezone

  for (let d = new Date(now); d < end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = getDayInTimezone(d, tz)
    const dayConfig = workingHours.days.find(dh => dh.day === dayOfWeek)
    if (!dayConfig) continue // Not a working day

    for (let hour = dayConfig.startHour; hour < dayConfig.endHour; hour++) {
      const slotStart = localToUtc(d, hour, tz)
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
          label: formatSlotLabel(slotStart.toISOString(), tz)
        })
      }

      if (slots.length >= 6) return slots
    }
  }

  return slots
}

// Fetch working hours from Google Calendar settings
async function getGoogleWorkingHours(oauth2Client: ReturnType<typeof google.auth.OAuth2.prototype.constructor>): Promise<WorkingHours> {
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    // Get calendar timezone
    const settingsTimezone = await calendar.settings.get({ setting: 'timezone' }).catch(() => null)
    const timezone = settingsTimezone?.data?.value || DEFAULT_TIMEZONE

    // Get calendar list to check working hours (defaultReminders indicates primary)
    const calList = await calendar.calendarList.get({ calendarId: 'primary' }).catch(() => null)

    // Google Calendar doesn't expose working hours via API directly,
    // but we can get the timezone. For working hours, check if the user
    // has all-day "busy" events marking non-working days.
    // Default to Mon-Fri 9am-5pm in the calendar's timezone.
    const defaultDays = [
      { day: 0, startHour: 8, endHour: 22 }, // Sunday
      { day: 1, startHour: 8, endHour: 22 }, // Monday
      { day: 2, startHour: 8, endHour: 22 }, // Tuesday
      { day: 3, startHour: 8, endHour: 22 }, // Wednesday
      { day: 4, startHour: 8, endHour: 22 }, // Thursday
      { day: 5, startHour: 8, endHour: 22 }, // Friday
      { day: 6, startHour: 8, endHour: 22 }, // Saturday
    ]
    logger.info('Google Calendar timezone detected', { timezone, calendarId: calList?.data?.id })

    return { timezone, days: defaultDays }
  } catch (error) {
    logger.warn('Failed to get Google working hours, using defaults', { error })
    return {
      timezone: DEFAULT_TIMEZONE,
      days: [
        { day: 0, startHour: 8, endHour: 22 },
        { day: 1, startHour: 8, endHour: 22 },
        { day: 2, startHour: 8, endHour: 22 },
        { day: 3, startHour: 8, endHour: 22 },
        { day: 4, startHour: 8, endHour: 22 },
        { day: 5, startHour: 8, endHour: 22 },
        { day: 6, startHour: 8, endHour: 22 },
      ]
    }
  }
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
    // Try Calendly — uses refresh-aware token helper
    const calendlyCreds = await getCalendlyToken(clientId)
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

    // Try Google Calendar — googleapis handles token refresh automatically
    const oauth2Client = await getGoogleCalendarClient(clientId)
    if (oauth2Client) {
      try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

        // Get the client's actual timezone and working hours from their calendar
        const workingHours = await getGoogleWorkingHours(oauth2Client)

        const now = new Date()
        const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

        const freeBusyRes = await calendar.freebusy.query({
          requestBody: {
            timeMin: now.toISOString(),
            timeMax: weekLater.toISOString(),
            timeZone: workingHours.timezone,
            items: [{ id: 'primary' }]
          }
        })

        const busySlots = (freeBusyRes.data.calendars?.primary?.busy || []) as { start: string; end: string }[]
        const slots = buildSlotsFromFreebusy(busySlots, workingHours)
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

    // Fetch client's email to use as reply-to on all booking emails
    const clientRecord = await prisma.client.findUnique({ where: { id: clientId }, select: { email: true } })
    const replyTo = clientRecord?.email || undefined

    // Try Google Calendar (direct booking) — uses refresh-aware client helper
    const gcalClient = await getGoogleCalendarClient(clientId)
    if (gcalClient) {
      try {
        const calendar = google.calendar({ version: 'v3', auth: gcalClient })

        const event = await calendar.events.insert({
          calendarId: 'primary',
          sendUpdates: 'all',
          requestBody: {
            summary: `Appointment — ${contact.name}`,
            description: `Booked via inbound call for ${businessName}`,
            start: { dateTime: startTime, timeZone: CLIENT_TIMEZONE },
            end: { dateTime: endTime, timeZone: CLIENT_TIMEZONE },
            attendees: [{ email: contact.email, displayName: contact.name }]
          }
        })

        const slotLabel = formatSlotLabel(startTime)
        await this.sendConfirmationEmail(contact, slotLabel, businessName, event.data.htmlLink || undefined, startTime, endTime, replyTo)

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
            timeZone: CLIENT_TIMEZONE,
            language: 'en',
            metadata: { source: 'voice-inbound' }
          }
        )
        const slotLabel = formatSlotLabel(startTime)
        await this.sendConfirmationEmail(contact, slotLabel, businessName, undefined, startTime, endTime, replyTo)

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

    // Calendly: send scheduling link post-call — use refresh-aware helper to get latest schedulingUrl
    const calendlyCreds = await getCalendlyToken(clientId)
    if (calendlyCreds?.schedulingUrl) {
      const slotLabel = formatSlotLabel(startTime)
      await this.sendSchedulingLinkEmail(contact, slotLabel, calendlyCreds.schedulingUrl, businessName, startTime, endTime, replyTo)

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
      await this.sendSchedulingLinkEmail(contact, formatSlotLabel(startTime), bookingLink, businessName, startTime, endTime, replyTo)
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
    eventLink?: string,
    startTime?: string,
    endTime?: string,
    replyTo?: string
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

      const attachments = startTime && endTime
        ? [{
            filename: 'appointment.ics',
            content: Buffer.from(generateICalContent(startTime, endTime, contact.name, contact.email, businessName, 'CONFIRMED')).toString('base64')
          }]
        : undefined

      await emailService.sendSystemEmail(contact.email, `Your appointment with ${businessName} is confirmed`, html, attachments, businessName, replyTo)
    } catch (error) {
      logger.error('Failed to send booking confirmation email', { error })
    }
  }

  private async sendSchedulingLinkEmail(
    contact: { name: string; email: string },
    slotLabel: string,
    bookingLink: string,
    businessName: string,
    startTime?: string,
    endTime?: string,
    replyTo?: string
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

      const attachments = startTime && endTime
        ? [{
            filename: 'appointment.ics',
            content: Buffer.from(generateICalContent(startTime, endTime, contact.name, contact.email, businessName, 'TENTATIVE')).toString('base64')
          }]
        : undefined

      await emailService.sendSystemEmail(contact.email, `Confirm your appointment with ${businessName}`, html, attachments, businessName, replyTo)
    } catch (error) {
      logger.error('Failed to send scheduling link email', { error })
    }
  }
}

export const calendarService = new CalendarService()
