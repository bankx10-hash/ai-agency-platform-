/**
 * Service Pipeline Worker — runs every 30 minutes for AI Receptionist clients.
 * Auto-transitions contacts through the service pipeline stages:
 *
 * NEW_INQUIRY → APPOINTMENT_BOOKED (handled by voice-inbound booking)
 * APPOINTMENT_BOOKED → APPOINTMENT_COMPLETED (appointment time has passed)
 * APPOINTMENT_COMPLETED → FOLLOW_UP_DUE (follow-up triggered — handled by n8n-callbacks)
 * FOLLOW_UP_DUE → RECURRING_CLIENT (client rebooks after follow-up)
 * APPOINTMENT_BOOKED → NO_SHOW (appointment time passed + no call/activity recorded)
 * * → INACTIVE (no activity for 90+ days)
 */

import Bull from 'bull'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'
import { randomUUID } from 'crypto'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const servicePipelineQueue = new Bull('service-pipeline', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 10,
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 }
  }
})

servicePipelineQueue.process(async () => {
  // Only process AI_RECEPTIONIST clients
  const clients = await prisma.client.findMany({
    where: { plan: 'AI_RECEPTIONIST', status: 'ACTIVE' },
    select: { id: true, businessName: true }
  })

  if (clients.length === 0) return

  logger.info(`Service pipeline: processing ${clients.length} receptionist clients`)

  for (const client of clients) {
    try {
      await processClientPipeline(client.id)
    } catch (err) {
      logger.error('Service pipeline failed for client', { clientId: client.id, err: String(err) })
    }
  }

  logger.info('Service pipeline run complete')
})

async function processClientPipeline(clientId: string): Promise<void> {
  const now = new Date()

  // ── APPOINTMENT_BOOKED → APPOINTMENT_COMPLETED ──────────────────────
  // Contacts whose booked appointment time has passed (check CallLog for
  // a completed inbound call around that time, or just use time-based)
  const bookedContacts = await prisma.$queryRaw<Array<{ id: string; lastContactedAt: Date | null; updatedAt: Date }>>`
    SELECT id, "lastContactedAt", "updatedAt"
    FROM "Contact"
    WHERE "clientId" = ${clientId}
      AND "pipelineStage" = 'APPOINTMENT_BOOKED'
  `

  for (const contact of bookedContacts) {
    // Check if there's a completed appointment (CallLog entry or activity after booking)
    const hasPostBookingActivity = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM "ContactActivity"
      WHERE "contactId" = ${contact.id}
        AND "clientId" = ${clientId}
        AND "type" IN ('CALL', 'NOTE')
        AND "createdAt" > ${contact.updatedAt}
    `
    const activityCount = Number(hasPostBookingActivity[0]?.count || 0)

    // Also check if enough time has passed since booking (at least 2 hours)
    const hoursSinceUpdate = (now.getTime() - new Date(contact.updatedAt).getTime()) / (1000 * 60 * 60)

    if (activityCount > 0 && hoursSinceUpdate > 2) {
      // Has post-booking activity → appointment completed
      await moveStage(clientId, contact.id, 'APPOINTMENT_COMPLETED', 'Appointment completed (activity detected)')
    } else if (hoursSinceUpdate > 48 && activityCount === 0) {
      // 48 hours since booking, no activity → likely no-show
      await moveStage(clientId, contact.id, 'NO_SHOW', 'No activity 48 hours after booked appointment')
    }
  }

  // ── APPOINTMENT_COMPLETED → FOLLOW_UP_DUE ──────────────────────────
  // Contacts who completed their appointment 2+ days ago and haven't
  // been followed up yet. The follow-up agent triggers separately via
  // N8N, but we update the pipeline stage here.
  const completedContacts = await prisma.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
    SELECT id, "updatedAt"
    FROM "Contact"
    WHERE "clientId" = ${clientId}
      AND "pipelineStage" = 'APPOINTMENT_COMPLETED'
  `

  for (const contact of completedContacts) {
    const daysSinceCompleted = (now.getTime() - new Date(contact.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceCompleted >= 2) {
      await moveStage(clientId, contact.id, 'FOLLOW_UP_DUE', 'Follow-up due (2 days post-appointment)')
    }
  }

  // ── FOLLOW_UP_DUE → RECURRING_CLIENT (when they rebook) ────────────
  // Check if any FOLLOW_UP_DUE contacts have a new booking activity
  const followUpContacts = await prisma.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
    SELECT id, "updatedAt"
    FROM "Contact"
    WHERE "clientId" = ${clientId}
      AND "pipelineStage" = 'FOLLOW_UP_DUE'
  `

  for (const contact of followUpContacts) {
    // Check for a new booking after the follow-up stage was set
    const hasRebooked = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM "ContactActivity"
      WHERE "contactId" = ${contact.id}
        AND "clientId" = ${clientId}
        AND "title" ILIKE '%appointment%booked%'
        AND "createdAt" > ${contact.updatedAt}
    `
    if (Number(hasRebooked[0]?.count || 0) > 0) {
      await moveStage(clientId, contact.id, 'RECURRING_CLIENT', 'Client rebooked after follow-up')
    }
  }

  // ── NO_SHOW handling — check if they eventually rebook ──────────────
  const noShowContacts = await prisma.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
    SELECT id, "updatedAt"
    FROM "Contact"
    WHERE "clientId" = ${clientId}
      AND "pipelineStage" = 'NO_SHOW'
  `

  for (const contact of noShowContacts) {
    const hasRebooked = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM "ContactActivity"
      WHERE "contactId" = ${contact.id}
        AND "clientId" = ${clientId}
        AND "title" ILIKE '%appointment%booked%'
        AND "createdAt" > ${contact.updatedAt}
    `
    if (Number(hasRebooked[0]?.count || 0) > 0) {
      await moveStage(clientId, contact.id, 'APPOINTMENT_BOOKED', 'No-show client rebooked')
    }
  }

  // ── * → INACTIVE (no activity for 90+ days) ────────────────────────
  // Any contact that hasn't been updated in 90 days and isn't already
  // INACTIVE or RECURRING_CLIENT
  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "pipelineStage" = 'INACTIVE', "updatedAt" = NOW()
    WHERE "clientId" = ${clientId}
      AND "pipelineStage" NOT IN ('INACTIVE', 'RECURRING_CLIENT', 'NEW_INQUIRY')
      AND "updatedAt" < ${new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)}
  `
}

async function moveStage(clientId: string, contactId: string, newStage: string, reason: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "pipelineStage" = ${newStage}, "updatedAt" = NOW()
    WHERE "id" = ${contactId} AND "clientId" = ${clientId}
  `

  // Log the transition as a ContactActivity
  await prisma.contactActivity.create({
    data: {
      id: randomUUID(),
      contactId,
      clientId,
      type: 'STAGE_CHANGE' as never,
      title: `Pipeline: ${newStage.replace(/_/g, ' ')}`,
      body: reason,
      agentType: 'RECEPTIONIST_FOLLOWUP'
    }
  }).catch(() => {})

  logger.info('Service pipeline transition', { clientId, contactId, newStage, reason })
}

/**
 * Start the service pipeline scheduler. Runs every 30 minutes.
 */
export function startServicePipelineScheduler(): void {
  servicePipelineQueue.add({}, {
    repeat: { cron: '*/30 * * * *' },
    jobId: 'service-pipeline-cron'
  })
  logger.info('Service pipeline scheduler started (every 30 min)')
}
