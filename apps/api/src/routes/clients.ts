import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logger } from '../utils/logger'
import { z } from 'zod'

const router = Router()

const updateClientSchema = z.object({
  businessName: z.string().min(1).optional(),
  phone: z.string().optional(),
  country: z.string().optional(),
  crmType: z.string().nullable().optional().transform(v => (!v || v.toLowerCase() === 'none') ? null : v),
  businessDescription: z.string().optional(),
  icpDescription: z.string().optional()
})

router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    if (req.clientId !== id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const clientWithHash = await prisma.client.findUnique({
      where: { id },
      include: {
        agents: {
          orderBy: { createdAt: 'desc' }
        },
        onboarding: true
      }
    })

    if (!clientWithHash) {
      res.status(404).json({ error: 'Client not found' })
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _ph, ...client } = clientWithHash as typeof clientWithHash & { passwordHash?: string }

    res.json({ client })
  } catch (error) {
    logger.error('Error fetching client', { error, clientId: req.params.id })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    if (req.clientId !== id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const parsed = updateClientSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.errors })
      return
    }

    const clientWithHash = await prisma.client.update({
      where: { id },
      data: parsed.data
    })

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _ph, ...client } = clientWithHash as typeof clientWithHash & { passwordHash?: string }

    res.json({ client })
  } catch (error) {
    logger.error('Error updating client', { error, clientId: req.params.id })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:id/agents', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    if (req.clientId !== id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const agents = await prisma.agentDeployment.findMany({
      where: { clientId: id },
      orderBy: { createdAt: 'desc' }
    })

    res.json({ agents })
  } catch (error) {
    logger.error('Error fetching client agents', { error, clientId: req.params.id })
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /:id/analytics — returns last 30 days of activity aggregated across all agents
router.get('/:id/analytics', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    if (req.clientId !== id) { res.status(403).json({ error: 'Forbidden' }); return }

    const agents = await prisma.agentDeployment.findMany({ where: { clientId: id } })

    // Aggregate dailyHistory across all agents by date
    const byDate: Record<string, { leads: number; calls: number; appointments: number; emails: number; posts: number }> = {}

    for (const agent of agents) {
      const metrics = (agent.metrics as Record<string, unknown>) || {}
      const history = (metrics.dailyHistory as Array<Record<string, unknown>>) || []

      for (const day of history) {
        const date = day.date as string
        if (!date) continue
        if (!byDate[date]) byDate[date] = { leads: 0, calls: 0, appointments: 0, emails: 0, posts: 0 }
        byDate[date].leads += (day.leadsToday as number) || (day.totalLeads as number) || 0
        byDate[date].calls += (day.callsAnswered as number) || (day.callsMade as number) || 0
        byDate[date].appointments += (day.appointmentsToday as number) || (day.appointmentsBooked as number) || 0
        byDate[date].emails += (day.emailsSent as number) || 0
        byDate[date].posts += (day.postsPublished as number) || 0
      }
    }

    // Sort by date ascending, last 30 days
    const sorted = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, vals]) => ({ date, ...vals }))

    res.json({ history: sorted })
  } catch (error) {
    logger.error('Error fetching client analytics', { error, clientId: req.params.id })
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
