import Bull from 'bull'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const socialReminderQueue = new Bull('social-reminder', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 10
  }
})

socialReminderQueue.process(async () => {
  // Find all DRAFT posts with a scheduledAt in the future
  const drafts = await prisma.scheduledPost.findMany({
    where: {
      status: 'DRAFT',
      scheduledAt: { not: null }
    },
    include: {
      client: {
        select: { id: true, email: true, businessName: true, postReminderHours: true }
      }
    }
  })

  if (drafts.length === 0) return

  const now = Date.now()

  for (const draft of drafts) {
    const scheduledAt = draft.scheduledAt!.getTime()
    const hoursUntil = (scheduledAt - now) / (1000 * 60 * 60)

    // Skip if already past scheduled time (publish queue will handle skipping DRAFTs)
    if (hoursUntil <= 0) continue

    const reminderHours = (draft.client.postReminderHours as number[]) || [6, 2]

    for (const reminderAt of reminderHours) {
      // Check if we're within the reminder window (within 30 min of the threshold)
      if (hoursUntil <= reminderAt && hoursUntil > (reminderAt - 0.5)) {
        // Check if we already sent this reminder (use metadata to track)
        const meta = (draft.metadata as Record<string, unknown>) || {}
        const sentReminders = (meta.sentReminders as number[]) || []
        if (sentReminders.includes(reminderAt)) continue

        logger.info('Sending post review reminder', {
          postId: draft.id,
          clientId: draft.clientId,
          hoursUntil: hoursUntil.toFixed(1),
          reminderThreshold: reminderAt
        })

        // TODO: Send email notification via email service
        // For now, log the reminder. Email integration can use the existing
        // Nodemailer/Gmail service when ready.
        // await emailService.sendPostReminder(draft.client.email, {
        //   postId: draft.id,
        //   content: draft.content.substring(0, 100),
        //   platform: draft.platform,
        //   scheduledAt: draft.scheduledAt,
        //   reviewUrl: `${process.env.NEXTAUTH_URL}/dashboard/social/posts?status=DRAFT`
        // })

        // Mark reminder as sent
        await prisma.scheduledPost.update({
          where: { id: draft.id },
          data: {
            metadata: {
              ...meta,
              sentReminders: [...sentReminders, reminderAt],
              lastReminderAt: new Date().toISOString()
            }
          }
        })
      }
    }
  }
})

// Schedule recurring check every 30 minutes
export function startSocialReminderScheduler(): void {
  socialReminderQueue.add({}, {
    repeat: { every: 30 * 60 * 1000 }
  })
  logger.info('Social reminder scheduler started (every 30 min)')
}
