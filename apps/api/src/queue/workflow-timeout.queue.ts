import Bull from 'bull'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'
import { messagingService, MessageChannel } from '../services/messaging.service'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const TIMEOUT_HOURS = parseInt(process.env.WORKFLOW_TIMEOUT_HOURS || '24', 10)

export const workflowTimeoutQueue = new Bull('workflow-timeout', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 10
  }
})

workflowTimeoutQueue.process(async () => {
  const cutoff = new Date(Date.now() - TIMEOUT_HOURS * 60 * 60 * 1000)

  const staleConversations = await prisma.workflowConversation.findMany({
    where: {
      status: 'IN_PROGRESS',
      lastMessageAt: { lt: cutoff }
    },
    include: {
      workflow: { select: { disqualifyMessage: true } }
    }
  })

  if (staleConversations.length === 0) return

  logger.info(`Timing out ${staleConversations.length} stale workflow conversations`)

  for (const conv of staleConversations) {
    try {
      await prisma.workflowConversation.update({
        where: { id: conv.id },
        data: { status: 'TIMED_OUT', completedAt: new Date() }
      })

      // Optionally send a timeout message
      const timeoutMsg = conv.workflow.disqualifyMessage || "It looks like we haven't heard back from you. Feel free to message us anytime!"
      await messagingService.sendMessage({
        clientId: conv.clientId,
        channel: conv.channel.toLowerCase() as MessageChannel,
        recipientId: conv.senderId,
        text: timeoutMsg
      }).catch(() => { /* best effort */ })
    } catch (err) {
      logger.error('Failed to timeout conversation', { conversationId: conv.id, error: err })
    }
  }
})

// Schedule recurring check every 15 minutes
export function startWorkflowTimeoutScheduler(): void {
  workflowTimeoutQueue.add({}, {
    repeat: { every: 15 * 60 * 1000 }
  })
  logger.info('Workflow timeout scheduler started (every 15 min)')
}
