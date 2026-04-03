import { prisma, Prisma } from '../lib/prisma'
import { messagingService, MessageChannel } from './messaging.service'
import { logger } from '../utils/logger'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface IncomingMessageParams {
  clientId: string
  channel: MessageChannel
  senderId: string
  senderName?: string
  messageText: string
}

interface EngagementTriggerParams {
  clientId: string
  channel: MessageChannel
  senderId: string
  senderName?: string
  triggerType: 'comment' | 'story_reply' | 'story_mention'
  commentText?: string
  postId?: string
  commentId?: string
}

interface QuestionOption {
  label: string
  value: string
  score: number
  nextQuestionId?: string
}

interface BranchRule {
  condition: string
  nextQuestionId: string
}

interface AnswerRecord {
  questionId: string
  answer: string
  score: number
  answeredAt: string
}

class WorkflowEngineService {

  /**
   * Handle engagement triggers (comments, story replies, story mentions).
   * Auto-DMs the person to start the qualification workflow.
   */
  async handleEngagementTrigger(params: EngagementTriggerParams): Promise<void> {
    const { clientId, channel, senderId, senderName, triggerType, commentText, postId, commentId } = params

    // Find active workflow that triggers on this engagement type and channel
    const workflows = await prisma.conversationWorkflow.findMany({
      where: { clientId, status: 'ACTIVE' },
      include: { questions: { orderBy: { order: 'asc' } } }
    })

    const workflow = workflows.find(w => {
      const channels = w.channels as string[]
      const triggers = (w.triggerOn as string[]) || ['dm']
      return channels.includes(channel) && triggers.includes(triggerType)
    })

    if (!workflow || workflow.questions.length === 0) return

    // Check if this person already has a conversation (don't spam them)
    const existing = await prisma.workflowConversation.findUnique({
      where: {
        workflowId_channel_senderId: {
          workflowId: workflow.id,
          channel: channel.toUpperCase() as 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK',
          senderId
        }
      }
    })

    if (existing) return // Already engaged — don't re-trigger

    // Check trigger keywords against comment text if configured
    const triggerKeywords = workflow.triggerKeywords as string[]
    if (triggerKeywords.length > 0 && commentText) {
      const lowerComment = commentText.toLowerCase()
      const matched = triggerKeywords.some(kw => lowerComment.includes(kw.toLowerCase()))
      if (!matched) return
    }

    // If commentReplyText is set, reply to the comment first (public)
    // (This is handled by the caller via the existing send-reply endpoint)

    // Create conversation and auto-DM them the first question
    const firstQuestion = workflow.questions[0]

    await prisma.workflowConversation.create({
      data: {
        workflowId: workflow.id,
        clientId,
        channel: channel.toUpperCase() as 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK',
        senderId,
        senderName: senderName || null,
        currentQuestionId: firstQuestion.id,
        answers: {} as Prisma.InputJsonValue,
        extractedData: { _triggerType: triggerType, _postId: postId, _commentId: commentId } as Prisma.InputJsonValue
      }
    })

    const welcomeText = workflow.welcomeMessage
      ? `${workflow.welcomeMessage}\n\n${firstQuestion.questionText}`
      : firstQuestion.questionText

    const quickReplies = this.getQuickReplies(firstQuestion)

    await messagingService.sendMessage({
      clientId,
      channel,
      recipientId: senderId,
      text: welcomeText,
      quickReplies
    })

    logger.info('Engagement trigger started workflow conversation', {
      clientId, channel, triggerType, senderId, workflowId: workflow.id
    })
  }

  async handleIncomingMessage(params: IncomingMessageParams): Promise<void> {
    const { clientId, channel, senderId, senderName, messageText } = params

    // Find active workflow for this client that includes this channel
    const workflows = await prisma.conversationWorkflow.findMany({
      where: { clientId, status: 'ACTIVE' },
      include: { questions: { orderBy: { order: 'asc' } } }
    })

    const workflow = workflows.find(w => {
      const channels = w.channels as string[]
      const triggers = (w.triggerOn as string[]) || ['dm']
      // For DMs: workflow must include this channel AND trigger on 'dm'
      // OR the sender already has an in-progress conversation (reply to engagement DM)
      return channels.includes(channel) && triggers.includes('dm')
    })

    // Also check if sender has an existing in-progress conversation (from engagement trigger)
    if (!workflow) {
      const existingConv = await prisma.workflowConversation.findFirst({
        where: { clientId, senderId, status: 'IN_PROGRESS', channel: channel.toUpperCase() as 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' },
        include: { workflow: { include: { questions: { orderBy: { order: 'asc' } } } } }
      })
      if (existingConv) {
        // Process as a reply to an engagement-triggered conversation
        return this.processExistingConversation(existingConv, existingConv.workflow, messageText, senderId, senderName, clientId, channel)
      }
      return
    }

    // Find or create conversation
    let conversation = await prisma.workflowConversation.findUnique({
      where: {
        workflowId_channel_senderId: {
          workflowId: workflow.id,
          channel: channel.toUpperCase() as 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK',
          senderId
        }
      }
    })

    if (conversation && ['COMPLETED', 'QUALIFIED', 'DISQUALIFIED', 'TIMED_OUT'].includes(conversation.status)) {
      // Conversation already finished — don't restart
      return
    }

    if (!conversation) {
      // Check trigger keywords if configured
      const triggerKeywords = workflow.triggerKeywords as string[]
      if (triggerKeywords.length > 0) {
        const lowerMsg = messageText.toLowerCase()
        const triggered = triggerKeywords.some(kw => lowerMsg.includes(kw.toLowerCase()))
        if (!triggered) return // Message doesn't match trigger keywords
      }

      // Start new conversation
      const firstQuestion = workflow.questions[0]
      if (!firstQuestion) return // No questions defined

      conversation = await prisma.workflowConversation.create({
        data: {
          workflowId: workflow.id,
          clientId,
          channel: channel.toUpperCase() as 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK',
          senderId,
          senderName: senderName || null,
          currentQuestionId: firstQuestion.id,
          answers: {} as Prisma.InputJsonValue,
          extractedData: {} as Prisma.InputJsonValue
        }
      })

      // Send welcome message + first question
      const welcomeText = workflow.welcomeMessage
        ? `${workflow.welcomeMessage}\n\n${firstQuestion.questionText}`
        : firstQuestion.questionText

      const quickReplies = this.getQuickReplies(firstQuestion)

      await messagingService.sendMessage({
        clientId,
        channel,
        recipientId: senderId,
        text: welcomeText,
        quickReplies
      })

      return
    }

    // Existing conversation — delegate to shared handler
    await this.processExistingConversation(conversation, workflow, messageText, senderId, senderName, clientId, channel)
  }

  /**
   * Shared logic: process a reply to an in-progress conversation.
   * Used by both DM-triggered and engagement-triggered workflows.
   */
  private async processExistingConversation(
    conversation: { id: string; currentQuestionId: string | null; score: number; answers: unknown; extractedData: unknown },
    workflow: { id: string; qualifyThreshold: number; completionMessage: string | null; disqualifyMessage: string | null; questions: Array<{ id: string; order: number; questionText: string; questionType: string; options: unknown; scoreWeight: number; crmField: string | null; isRequired: boolean; branchRules: unknown }> },
    messageText: string,
    senderId: string,
    senderName: string | undefined,
    clientId: string,
    channel: MessageChannel
  ): Promise<void> {
    const currentQuestion = workflow.questions.find(q => q.id === conversation.currentQuestionId)
    if (!currentQuestion) {
      logger.error('Current question not found', { conversationId: conversation.id, questionId: conversation.currentQuestionId })
      return
    }

    const answerScore = await this.scoreAnswer(currentQuestion, messageText, workflow)

    const answers = (conversation.answers || {}) as Record<string, AnswerRecord>
    answers[currentQuestion.id] = {
      questionId: currentQuestion.id,
      answer: messageText,
      score: answerScore,
      answeredAt: new Date().toISOString()
    }

    const extractedData = (conversation.extractedData || {}) as Record<string, string>
    if (currentQuestion.crmField) {
      extractedData[currentQuestion.crmField] = messageText
    }

    const newScore = conversation.score + answerScore
    const nextQuestion = this.getNextQuestion(workflow.questions, currentQuestion, messageText)

    if (!nextQuestion) {
      const qualified = newScore >= workflow.qualifyThreshold

      await prisma.workflowConversation.update({
        where: { id: conversation.id },
        data: {
          answers: answers as unknown as Prisma.InputJsonValue,
          extractedData: extractedData as unknown as Prisma.InputJsonValue,
          score: newScore,
          currentQuestionId: null,
          status: qualified ? 'QUALIFIED' : 'DISQUALIFIED',
          completedAt: new Date(),
          lastMessageAt: new Date()
        }
      })

      if (qualified) {
        await this.handleQualifiedLead(clientId, conversation.id, extractedData, newScore, channel, senderId, senderName)
        const completionMsg = workflow.completionMessage || "Thank you! We'll be in touch shortly."
        await messagingService.sendMessage({ clientId, channel, recipientId: senderId, text: completionMsg })
      } else {
        const disqualifyMsg = workflow.disqualifyMessage || 'Thank you for your time!'
        await messagingService.sendMessage({ clientId, channel, recipientId: senderId, text: disqualifyMsg })
      }

      await this.updateWorkflowMetrics(clientId, qualified)
      return
    }

    await prisma.workflowConversation.update({
      where: { id: conversation.id },
      data: {
        answers: answers as unknown as Prisma.InputJsonValue,
        extractedData: extractedData as unknown as Prisma.InputJsonValue,
        score: newScore,
        currentQuestionId: nextQuestion.id,
        lastMessageAt: new Date()
      }
    })

    const quickReplies = this.getQuickReplies(nextQuestion)
    await messagingService.sendMessage({
      clientId,
      channel,
      recipientId: senderId,
      text: nextQuestion.questionText,
      quickReplies
    })
  }

  private async scoreAnswer(
    question: { questionType: string; options: unknown; scoreWeight: number },
    answerText: string,
    workflow: { id: string; qualifyThreshold: number }
  ): Promise<number> {
    const type = question.questionType

    if (type === 'TEXT') {
      // Text questions are for data capture, no scoring
      return 0
    }

    if (type === 'MULTIPLE_CHOICE') {
      const options = (question.options || []) as QuestionOption[]
      const lowerAnswer = answerText.toLowerCase().trim()
      const matched = options.find(o =>
        o.label.toLowerCase() === lowerAnswer ||
        o.value.toLowerCase() === lowerAnswer
      )
      return matched?.score ?? 0
    }

    if (type === 'YES_NO') {
      const lowerAnswer = answerText.toLowerCase().trim()
      const isYes = ['yes', 'y', 'yeah', 'yep', 'sure', 'absolutely', 'definitely'].includes(lowerAnswer)
      // YES gets the full score weight, NO gets 0
      return isYes ? question.scoreWeight : 0
    }

    if (type === 'OPEN_ENDED') {
      return await this.scoreOpenEndedAnswer(question, answerText)
    }

    return 0
  }

  private async scoreOpenEndedAnswer(
    question: { scoreWeight: number },
    answerText: string
  ): Promise<number> {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        system: 'You are a lead scoring assistant. Score the user\'s answer on a scale of 0-10 based on quality, detail, and buying intent. Respond with ONLY a JSON object: {"score": <number>}',
        messages: [{
          role: 'user',
          content: `Question context: The maximum score weight for this answer is ${question.scoreWeight} points.\n\nUser's answer: "${answerText}"\n\nScore this answer 0-10.`
        }]
      })

      const text = response.content[0]
      if (text.type !== 'text') return 0

      const parsed = JSON.parse(text.text)
      const rawScore = Math.min(10, Math.max(0, Number(parsed.score) || 0))
      // Scale to the question's score weight
      return Math.round((rawScore / 10) * question.scoreWeight)
    } catch (err) {
      logger.error('Failed to score open-ended answer', { error: err })
      return Math.round(question.scoreWeight * 0.5) // Default to 50% on failure
    }
  }

  private getNextQuestion(
    questions: Array<{ id: string; order: number; questionText: string; questionType: string; options: unknown; branchRules: unknown }>,
    currentQuestion: { id: string; order: number; questionText: string; options: unknown; branchRules: unknown; questionType: string },
    answerText: string
  ) {
    // Check multiple choice branching
    if (currentQuestion.questionType === 'MULTIPLE_CHOICE') {
      const options = (currentQuestion.options || []) as QuestionOption[]
      const lowerAnswer = answerText.toLowerCase().trim()
      const matched = options.find(o =>
        o.label.toLowerCase() === lowerAnswer ||
        o.value.toLowerCase() === lowerAnswer
      )
      if (matched?.nextQuestionId) {
        return questions.find(q => q.id === matched.nextQuestionId) || null
      }
    }

    // Check branch rules
    if (currentQuestion.branchRules) {
      const rules = currentQuestion.branchRules as BranchRule[]
      const lowerAnswer = answerText.toLowerCase()
      for (const rule of rules) {
        if (lowerAnswer.includes(rule.condition.toLowerCase())) {
          return questions.find(q => q.id === rule.nextQuestionId) || null
        }
      }
    }

    // Default: go to next question by order
    const sortedQuestions = [...questions].sort((a, b) => a.order - b.order)
    const currentIndex = sortedQuestions.findIndex(q => q.id === currentQuestion.id)
    const next = sortedQuestions[currentIndex + 1]
    return next || null
  }

  private getQuickReplies(question: { questionType: string; options: unknown }): string[] | undefined {
    if (question.questionType === 'MULTIPLE_CHOICE') {
      const options = (question.options || []) as QuestionOption[]
      return options.map(o => o.label)
    }
    if (question.questionType === 'YES_NO') {
      return ['Yes', 'No']
    }
    return undefined
  }

  private async handleQualifiedLead(
    clientId: string,
    conversationId: string,
    extractedData: Record<string, string>,
    score: number,
    channel: MessageChannel,
    senderId: string,
    senderName?: string
  ): Promise<void> {
    try {
      // Create contact in internal CRM
      const contact = await prisma.contact.create({
        data: {
          clientId,
          name: extractedData.name || senderName || null,
          email: extractedData.email || null,
          phone: extractedData.phone || null,
          source: `workflow-${channel}`,
          score,
          pipelineStage: 'QUALIFIED',
          tags: ['workflow-qualified', channel] as unknown as Prisma.InputJsonValue,
          summary: `Qualified via conversational workflow on ${channel} with score ${score}`
        }
      })

      // Link conversation to contact
      await prisma.workflowConversation.update({
        where: { id: conversationId },
        data: { contactId: contact.id }
      })

      // Log activity
      await prisma.contactActivity.create({
        data: {
          contactId: contact.id,
          clientId,
          type: 'AGENT_ACTION',
          title: 'Qualified via conversation workflow',
          body: `Lead scored ${score} via ${channel} workflow. Data captured: ${JSON.stringify(extractedData)}`,
          agentType: 'CONVERSATIONAL_WORKFLOW'
        }
      })

      logger.info('Qualified lead created from workflow', { clientId, contactId: contact.id, score, channel })
    } catch (err) {
      logger.error('Failed to create qualified lead', { clientId, conversationId, error: err })
    }
  }

  private async updateWorkflowMetrics(clientId: string, qualified: boolean): Promise<void> {
    try {
      const deployment = await prisma.agentDeployment.findFirst({
        where: { clientId, agentType: 'CONVERSATIONAL_WORKFLOW', status: 'ACTIVE' }
      })
      if (!deployment) return

      const metrics = (deployment.metrics || {}) as Record<string, unknown>
      const conversationsCompleted = ((metrics.conversationsCompleted as number) || 0) + 1
      const leadsQualified = ((metrics.leadsQualified as number) || 0) + (qualified ? 1 : 0)

      await prisma.agentDeployment.update({
        where: { id: deployment.id },
        data: {
          metrics: {
            ...metrics,
            conversationsCompleted,
            leadsQualified,
            qualificationRate: Math.round((leadsQualified / conversationsCompleted) * 100),
            lastUpdatedAt: new Date().toISOString()
          } as Prisma.InputJsonValue
        }
      })
    } catch (err) {
      logger.error('Failed to update workflow metrics', { clientId, error: err })
    }
  }
}

export const workflowEngine = new WorkflowEngineService()
