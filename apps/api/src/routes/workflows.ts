import express from 'express'
import { prisma, Prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logger } from '../utils/logger'
import { createAgent } from '../agents'
import { AgentType } from '../../../../packages/shared/types/agent.types'

const router = express.Router()
router.use(authMiddleware)

// ─── List Workflows ──────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res) => {
  try {
    const workflows = await prisma.conversationWorkflow.findMany({
      where: { clientId: req.clientId!, status: { not: 'ARCHIVED' } },
      include: {
        questions: { orderBy: { order: 'asc' } },
        _count: { select: { conversations: true } }
      },
      orderBy: { updatedAt: 'desc' }
    })

    // Add analytics summary to each workflow
    const result = await Promise.all(workflows.map(async (w) => {
      const qualified = await prisma.workflowConversation.count({
        where: { workflowId: w.id, status: 'QUALIFIED' }
      })
      return {
        ...w,
        conversationCount: w._count.conversations,
        qualifiedCount: qualified,
        qualificationRate: w._count.conversations > 0
          ? Math.round((qualified / w._count.conversations) * 100)
          : 0
      }
    }))

    res.json(result)
  } catch (err) {
    logger.error('Failed to list workflows', { clientId: req.clientId, error: err })
    res.status(500).json({ error: 'Failed to list workflows' })
  }
})

// ─── Get Workflow ────────────────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const workflow = await prisma.conversationWorkflow.findFirst({
      where: { id: req.params.id, clientId: req.clientId! },
      include: {
        questions: { orderBy: { order: 'asc' } },
        _count: { select: { conversations: true } }
      }
    })

    if (!workflow) return res.status(404).json({ error: 'Workflow not found' })
    res.json(workflow)
  } catch (err) {
    logger.error('Failed to get workflow', { id: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to get workflow' })
  }
})

// ─── Create Workflow ─────────────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res) => {
  try {
    const {
      name, description, channels, qualifyThreshold,
      welcomeMessage, completionMessage, disqualifyMessage,
      triggerKeywords, triggerOn, commentReplyText, questions
    } = req.body

    if (!name || !channels?.length) {
      return res.status(400).json({ error: 'name and channels are required' })
    }

    const workflow = await prisma.conversationWorkflow.create({
      data: {
        clientId: req.clientId!,
        name,
        description: description || null,
        channels: channels as Prisma.InputJsonValue,
        qualifyThreshold: qualifyThreshold || 70,
        welcomeMessage: welcomeMessage || null,
        completionMessage: completionMessage || null,
        disqualifyMessage: disqualifyMessage || null,
        triggerKeywords: (triggerKeywords || []) as Prisma.InputJsonValue,
        triggerOn: (triggerOn || ['dm']) as Prisma.InputJsonValue,
        commentReplyText: commentReplyText || null,
        questions: questions?.length ? {
          create: questions.map((q: Record<string, unknown>, i: number) => ({
            order: i,
            questionText: q.questionText as string,
            questionType: (q.questionType as string) || 'TEXT',
            options: (q.options || null) as Prisma.InputJsonValue,
            scoreWeight: (q.scoreWeight as number) || 0,
            crmField: (q.crmField as string) || null,
            isRequired: q.isRequired !== false,
            branchRules: (q.branchRules || null) as Prisma.InputJsonValue
          }))
        } : undefined
      },
      include: { questions: { orderBy: { order: 'asc' } } }
    })

    res.status(201).json(workflow)
  } catch (err) {
    logger.error('Failed to create workflow', { clientId: req.clientId, error: err })
    res.status(500).json({ error: 'Failed to create workflow' })
  }
})

// ─── Update Workflow ─────────────────────────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.conversationWorkflow.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!existing) return res.status(404).json({ error: 'Workflow not found' })

    const {
      name, description, channels, qualifyThreshold,
      welcomeMessage, completionMessage, disqualifyMessage,
      triggerKeywords, triggerOn, commentReplyText
    } = req.body

    const workflow = await prisma.conversationWorkflow.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(channels !== undefined && { channels: channels as Prisma.InputJsonValue }),
        ...(qualifyThreshold !== undefined && { qualifyThreshold }),
        ...(welcomeMessage !== undefined && { welcomeMessage }),
        ...(completionMessage !== undefined && { completionMessage }),
        ...(disqualifyMessage !== undefined && { disqualifyMessage }),
        ...(triggerKeywords !== undefined && { triggerKeywords: triggerKeywords as Prisma.InputJsonValue }),
        ...(triggerOn !== undefined && { triggerOn: triggerOn as Prisma.InputJsonValue }),
        ...(commentReplyText !== undefined && { commentReplyText })
      },
      include: { questions: { orderBy: { order: 'asc' } } }
    })

    res.json(workflow)
  } catch (err) {
    logger.error('Failed to update workflow', { id: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to update workflow' })
  }
})

// ─── Delete (Archive) Workflow ───────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.conversationWorkflow.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!existing) return res.status(404).json({ error: 'Workflow not found' })

    await prisma.conversationWorkflow.update({
      where: { id: req.params.id },
      data: { status: 'ARCHIVED' }
    })

    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to delete workflow', { id: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to delete workflow' })
  }
})

// ─── Activate Workflow ───────────────────────────────────────────────────────
router.post('/:id/activate', async (req: AuthRequest, res) => {
  try {
    const workflow = await prisma.conversationWorkflow.findFirst({
      where: { id: req.params.id, clientId: req.clientId! },
      include: { questions: true }
    })
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' })
    if (workflow.questions.length === 0) {
      return res.status(400).json({ error: 'Workflow must have at least one question' })
    }

    // Deploy the agent
    const agent = createAgent(AgentType.CONVERSATIONAL_WORKFLOW)
    const deployment = await agent.deploy(req.clientId!, { workflowId: workflow.id })

    res.json({ success: true, deploymentId: deployment.id, status: 'ACTIVE' })
  } catch (err) {
    logger.error('Failed to activate workflow', { id: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to activate workflow' })
  }
})

// ─── Pause Workflow ──────────────────────────────────────────────────────────
router.post('/:id/pause', async (req: AuthRequest, res) => {
  try {
    const workflow = await prisma.conversationWorkflow.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' })

    await prisma.conversationWorkflow.update({
      where: { id: req.params.id },
      data: { status: 'PAUSED' }
    })

    // Pause the agent deployment
    const deployment = await prisma.agentDeployment.findFirst({
      where: {
        clientId: req.clientId!,
        agentType: 'CONVERSATIONAL_WORKFLOW',
        status: 'ACTIVE',
        config: { path: ['workflowId'], equals: workflow.id }
      }
    })
    if (deployment) {
      await prisma.agentDeployment.update({
        where: { id: deployment.id },
        data: { status: 'PAUSED' }
      })
    }

    res.json({ success: true, status: 'PAUSED' })
  } catch (err) {
    logger.error('Failed to pause workflow', { id: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to pause workflow' })
  }
})

// ─── List Conversations ──────────────────────────────────────────────────────
router.get('/:id/conversations', async (req: AuthRequest, res) => {
  try {
    const { status, channel, limit = '50', offset = '0' } = req.query

    const where: Prisma.WorkflowConversationWhereInput = {
      workflowId: req.params.id,
      clientId: req.clientId!
    }
    if (status) where.status = status as 'IN_PROGRESS' | 'COMPLETED' | 'QUALIFIED' | 'DISQUALIFIED' | 'TIMED_OUT'
    if (channel) where.channel = (channel as string).toUpperCase() as 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK'

    const conversations = await prisma.workflowConversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    })

    const total = await prisma.workflowConversation.count({ where })

    res.json({ conversations, total })
  } catch (err) {
    logger.error('Failed to list conversations', { workflowId: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to list conversations' })
  }
})

// ─── Workflow Analytics ──────────────────────────────────────────────────────
router.get('/:id/analytics', async (req: AuthRequest, res) => {
  try {
    const workflowId = req.params.id

    const [total, completed, qualified, disqualified, timedOut] = await Promise.all([
      prisma.workflowConversation.count({ where: { workflowId, clientId: req.clientId! } }),
      prisma.workflowConversation.count({ where: { workflowId, clientId: req.clientId!, status: 'COMPLETED' } }),
      prisma.workflowConversation.count({ where: { workflowId, clientId: req.clientId!, status: 'QUALIFIED' } }),
      prisma.workflowConversation.count({ where: { workflowId, clientId: req.clientId!, status: 'DISQUALIFIED' } }),
      prisma.workflowConversation.count({ where: { workflowId, clientId: req.clientId!, status: 'TIMED_OUT' } })
    ])

    // Average score for completed conversations
    const conversations = await prisma.workflowConversation.findMany({
      where: { workflowId, clientId: req.clientId!, status: { in: ['QUALIFIED', 'DISQUALIFIED'] } },
      select: { score: true, channel: true, answers: true }
    })

    const avgScore = conversations.length > 0
      ? Math.round(conversations.reduce((sum, c) => sum + c.score, 0) / conversations.length)
      : 0

    // Channel breakdown
    const channelBreakdown: Record<string, number> = {}
    conversations.forEach(c => {
      channelBreakdown[c.channel] = (channelBreakdown[c.channel] || 0) + 1
    })

    // Drop-off analysis: count how many answers each question received
    const workflow = await prisma.conversationWorkflow.findFirst({
      where: { id: workflowId, clientId: req.clientId! },
      include: { questions: { orderBy: { order: 'asc' } } }
    })

    const dropOffByQuestion = workflow?.questions.map(q => {
      const answeredCount = conversations.filter(c => {
        const answers = c.answers as Record<string, unknown>
        return answers[q.id] !== undefined
      }).length
      return {
        questionId: q.id,
        questionText: q.questionText,
        order: q.order,
        answeredCount,
        dropOffRate: total > 0 ? Math.round(((total - answeredCount) / total) * 100) : 0
      }
    }) || []

    res.json({
      total,
      inProgress: total - completed - qualified - disqualified - timedOut,
      completed,
      qualified,
      disqualified,
      timedOut,
      qualificationRate: total > 0 ? Math.round((qualified / total) * 100) : 0,
      avgScore,
      channelBreakdown,
      dropOffByQuestion
    })
  } catch (err) {
    logger.error('Failed to get workflow analytics', { workflowId: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to get analytics' })
  }
})

// ─── Question CRUD ───────────────────────────────────────────────────────────

router.post('/:id/questions', async (req: AuthRequest, res) => {
  try {
    const workflow = await prisma.conversationWorkflow.findFirst({
      where: { id: req.params.id, clientId: req.clientId! }
    })
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' })

    const { questionText, questionType, options, scoreWeight, crmField, isRequired, branchRules } = req.body
    if (!questionText) return res.status(400).json({ error: 'questionText is required' })

    // Get max order
    const maxOrder = await prisma.workflowQuestion.findFirst({
      where: { workflowId: workflow.id },
      orderBy: { order: 'desc' },
      select: { order: true }
    })

    const question = await prisma.workflowQuestion.create({
      data: {
        workflowId: workflow.id,
        order: (maxOrder?.order ?? -1) + 1,
        questionText,
        questionType: questionType || 'TEXT',
        options: (options || null) as Prisma.InputJsonValue,
        scoreWeight: scoreWeight || 0,
        crmField: crmField || null,
        isRequired: isRequired !== false,
        branchRules: (branchRules || null) as Prisma.InputJsonValue
      }
    })

    res.status(201).json(question)
  } catch (err) {
    logger.error('Failed to add question', { workflowId: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to add question' })
  }
})

router.put('/:id/questions/:qid', async (req: AuthRequest, res) => {
  try {
    const question = await prisma.workflowQuestion.findFirst({
      where: { id: req.params.qid, workflow: { id: req.params.id, clientId: req.clientId! } }
    })
    if (!question) return res.status(404).json({ error: 'Question not found' })

    const { questionText, questionType, options, scoreWeight, crmField, isRequired, branchRules } = req.body

    const updated = await prisma.workflowQuestion.update({
      where: { id: req.params.qid },
      data: {
        ...(questionText !== undefined && { questionText }),
        ...(questionType !== undefined && { questionType }),
        ...(options !== undefined && { options: options as Prisma.InputJsonValue }),
        ...(scoreWeight !== undefined && { scoreWeight }),
        ...(crmField !== undefined && { crmField }),
        ...(isRequired !== undefined && { isRequired }),
        ...(branchRules !== undefined && { branchRules: branchRules as Prisma.InputJsonValue })
      }
    })

    res.json(updated)
  } catch (err) {
    logger.error('Failed to update question', { qid: req.params.qid, error: err })
    res.status(500).json({ error: 'Failed to update question' })
  }
})

router.delete('/:id/questions/:qid', async (req: AuthRequest, res) => {
  try {
    const question = await prisma.workflowQuestion.findFirst({
      where: { id: req.params.qid, workflow: { id: req.params.id, clientId: req.clientId! } }
    })
    if (!question) return res.status(404).json({ error: 'Question not found' })

    await prisma.workflowQuestion.delete({ where: { id: req.params.qid } })
    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to delete question', { qid: req.params.qid, error: err })
    res.status(500).json({ error: 'Failed to delete question' })
  }
})

router.post('/:id/questions/reorder', async (req: AuthRequest, res) => {
  try {
    const { questionIds } = req.body as { questionIds: string[] }
    if (!questionIds?.length) return res.status(400).json({ error: 'questionIds array required' })

    await prisma.$transaction(
      questionIds.map((id, index) =>
        prisma.workflowQuestion.update({
          where: { id },
          data: { order: index }
        })
      )
    )

    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to reorder questions', { workflowId: req.params.id, error: err })
    res.status(500).json({ error: 'Failed to reorder questions' })
  }
})

export default router
