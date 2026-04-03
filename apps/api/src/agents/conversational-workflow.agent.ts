import { BaseAgent } from './base.agent'
import { AgentType } from '../../../../packages/shared/types/agent.types'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'

export class ConversationalWorkflowAgent extends BaseAgent {
  agentType = AgentType.CONVERSATIONAL_WORKFLOW

  generatePrompt(config: Record<string, unknown>): string {
    return `You are a lead qualification assistant managing conversational workflows on messaging channels (WhatsApp, Instagram, Facebook). Your role is to score open-ended answers from prospects based on buying intent, detail quality, and relevance.`
  }

  async deploy(clientId: string, config: Record<string, unknown>): Promise<{ id: string; n8nWorkflowId?: string }> {
    const workflowId = config.workflowId as string
    if (!workflowId) {
      throw new Error('workflowId is required in config')
    }

    // Verify the workflow exists
    const workflow = await prisma.conversationWorkflow.findUnique({
      where: { id: workflowId },
      include: { questions: true }
    })

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    if (workflow.questions.length === 0) {
      throw new Error('Workflow must have at least one question before deploying')
    }

    // Activate the workflow
    await prisma.conversationWorkflow.update({
      where: { id: workflowId },
      data: { status: 'ACTIVE' }
    })

    // Create deployment record — no N8N workflow needed, engine runs in-process
    const deployment = await this.createDeploymentRecord(clientId, {
      workflowId,
      channels: workflow.channels,
      qualifyThreshold: workflow.qualifyThreshold,
      questionCount: workflow.questions.length,
      generatedPrompt: this.generatePrompt(config)
    })

    logger.info('Conversational workflow agent deployed', {
      clientId,
      deploymentId: deployment.id,
      workflowId,
      channels: workflow.channels,
      questionCount: workflow.questions.length
    })

    return { id: deployment.id }
  }

  async teardown(deploymentId: string): Promise<void> {
    const deployment = await prisma.agentDeployment.findUnique({
      where: { id: deploymentId }
    })

    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`)
    }

    const config = deployment.config as Record<string, unknown>
    const workflowId = config.workflowId as string

    // Pause the workflow
    if (workflowId) {
      await prisma.conversationWorkflow.update({
        where: { id: workflowId },
        data: { status: 'PAUSED' }
      }).catch(err => {
        logger.error('Failed to pause conversation workflow', { workflowId, error: err })
      })
    }

    await prisma.agentDeployment.update({
      where: { id: deploymentId },
      data: { status: 'INACTIVE' }
    })

    logger.info('Conversational workflow agent torn down', { deploymentId, workflowId })
  }
}
