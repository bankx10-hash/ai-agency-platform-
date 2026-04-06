import { Router, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { n8nService } from '../services/n8n.service'
import { createAgent } from '../agents'
import { AgentType, AgentStatus } from '../../../../packages/shared/types/agent.types'
import { logger } from '../utils/logger'
import { z } from 'zod'

const router = Router()

const updateConfigSchema = z.object({
  config: z.record(z.unknown())
})

// Health check endpoint — checks all deployed agents for a client
router.get('/health/:clientId', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params
    if (clientId !== req.clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const deployments = await prisma.agentDeployment.findMany({
      where: { clientId }
    })

    const agents = await Promise.all(deployments.map(async (deployment) => {
      const checks = { db: false, n8n: true, retell: true }
      let lastError: string | undefined

      // DB check: is the record ACTIVE?
      checks.db = deployment.status === AgentStatus.ACTIVE

      // N8N check: is the workflow active?
      if (deployment.n8nWorkflowId) {
        try {
          const wfStatus = await n8nService.getWorkflowStatus(deployment.n8nWorkflowId)
          checks.n8n = wfStatus.active === true
        } catch (err) {
          checks.n8n = false
          lastError = `N8N workflow check failed: ${String(err)}`
        }
      }

      // Retell check: does the agent exist?
      if (deployment.retellAgentId) {
        try {
          const { voiceService } = await import('../services/voice.service')
          await voiceService.getAgent(deployment.retellAgentId)
          checks.retell = true
        } catch (err) {
          checks.retell = false
          lastError = `Retell agent check failed: ${String(err)}`
        }
      }

      // Determine overall status
      const allPassing = checks.db && checks.n8n && checks.retell
      const allFailing = !checks.db && (!deployment.n8nWorkflowId || !checks.n8n) && (!deployment.retellAgentId || !checks.retell)
      const status = allPassing ? 'healthy' : allFailing ? 'down' : 'degraded'

      return {
        agentType: deployment.agentType,
        deploymentId: deployment.id,
        status,
        checks,
        ...(lastError && { lastError })
      }
    }))

    res.json({ agents })
  } catch (error) {
    logger.error('Error checking agent health', { error, clientId: req.params.clientId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:deploymentId', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deploymentId } = req.params
    const deployment = await prisma.agentDeployment.findUnique({ where: { id: deploymentId } })
    if (!deployment) { res.status(404).json({ error: 'Not found' }); return }
    if (deployment.clientId !== req.clientId) { res.status(403).json({ error: 'Forbidden' }); return }
    res.json({ agent: deployment })
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:deploymentId/appointments', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deploymentId } = req.params
    const deployment = await prisma.agentDeployment.findUnique({ where: { id: deploymentId } })
    if (!deployment) { res.status(404).json({ error: 'Not found' }); return }
    if (deployment.clientId !== req.clientId) { res.status(403).json({ error: 'Forbidden' }); return }
    const metrics = (deployment.metrics as Record<string, unknown>) || {}
    const appointments = (metrics.appointments as unknown[]) || []
    res.json({ appointments })
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:deploymentId/pause', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deploymentId } = req.params

    const deployment = await prisma.agentDeployment.findUnique({
      where: { id: deploymentId }
    })

    if (!deployment) {
      res.status(404).json({ error: 'Agent deployment not found' })
      return
    }

    if (deployment.clientId !== req.clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    if (deployment.n8nWorkflowId) {
      await n8nService.pauseWorkflow(deployment.n8nWorkflowId)
    }

    const updated = await prisma.agentDeployment.update({
      where: { id: deploymentId },
      data: { status: AgentStatus.PAUSED }
    })

    logger.info('Agent paused', { deploymentId, clientId: req.clientId })

    res.json({ agent: updated })
  } catch (error) {
    logger.error('Error pausing agent', { error, deploymentId: req.params.deploymentId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:deploymentId/resume', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deploymentId } = req.params

    const deployment = await prisma.agentDeployment.findUnique({
      where: { id: deploymentId }
    })

    if (!deployment) {
      res.status(404).json({ error: 'Agent deployment not found' })
      return
    }

    if (deployment.clientId !== req.clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    if (deployment.n8nWorkflowId) {
      await n8nService.resumeWorkflow(deployment.n8nWorkflowId)
    }

    const updated = await prisma.agentDeployment.update({
      where: { id: deploymentId },
      data: { status: AgentStatus.ACTIVE }
    })

    logger.info('Agent resumed', { deploymentId, clientId: req.clientId })

    res.json({ agent: updated })
  } catch (error) {
    logger.error('Error resuming agent', { error, deploymentId: req.params.deploymentId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:deploymentId/config', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deploymentId } = req.params

    const parsed = updateConfigSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.errors })
      return
    }

    const deployment = await prisma.agentDeployment.findUnique({
      where: { id: deploymentId }
    })

    if (!deployment) {
      res.status(404).json({ error: 'Agent deployment not found' })
      return
    }

    if (deployment.clientId !== req.clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const newConfig = {
      ...(deployment.config as Record<string, unknown>),
      ...parsed.data.config
    }

    const agent = createAgent(deployment.agentType as AgentType)
    const newPrompt = agent.generatePrompt(newConfig)


    const updated = await prisma.agentDeployment.update({
      where: { id: deploymentId },
      data: {
        config: newConfig as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    })

    logger.info('Agent config updated', { deploymentId, clientId: req.clientId })

    res.json({ agent: updated })
  } catch (error) {
    logger.error('Error updating agent config', { error, deploymentId: req.params.deploymentId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:deploymentId/metrics', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deploymentId } = req.params

    const deployment = await prisma.agentDeployment.findUnique({
      where: { id: deploymentId }
    })

    if (!deployment) {
      res.status(404).json({ error: 'Agent deployment not found' })
      return
    }

    if (deployment.clientId !== req.clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    let n8nStatus = null
    if (deployment.n8nWorkflowId) {
      try {
        n8nStatus = await n8nService.getWorkflowStatus(deployment.n8nWorkflowId)
      } catch {
        logger.warn('Could not fetch N8N status', { deploymentId })
      }
    }

    res.json({
      metrics: deployment.metrics,
      status: deployment.status,
      n8nStatus,
      lastUpdated: deployment.updatedAt
    })
  } catch (error) {
    logger.error('Error fetching agent metrics', { error, deploymentId: req.params.deploymentId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete an agent deployment
router.delete('/:deploymentId', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deploymentId } = req.params

    const deployment = await prisma.agentDeployment.findUnique({
      where: { id: deploymentId }
    })

    if (!deployment) {
      res.status(404).json({ error: 'Agent deployment not found' })
      return
    }

    if (deployment.clientId !== req.clientId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    // Pause N8N workflow if exists
    if (deployment.n8nWorkflowId) {
      try {
        await n8nService.pauseWorkflow(deployment.n8nWorkflowId)
      } catch {
        logger.warn('Could not pause N8N workflow before deletion', { deploymentId })
      }
    }

    await prisma.agentDeployment.delete({ where: { id: deploymentId } })

    logger.info('Agent deployment deleted', { deploymentId, agentType: deployment.agentType, clientId: req.clientId })
    res.json({ success: true })
  } catch (error) {
    logger.error('Error deleting agent deployment', { error, deploymentId: req.params.deploymentId })
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
