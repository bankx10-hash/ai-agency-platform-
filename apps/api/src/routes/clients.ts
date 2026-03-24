import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logger } from '../utils/logger'
import { z } from 'zod'

const router = Router()
const prisma = new PrismaClient()

const updateClientSchema = z.object({
  businessName: z.string().min(1).optional(),
  phone: z.string().optional(),
  crmType: z.string().nullable().optional().transform(v => (!v || v.toLowerCase() === 'none') ? null : v)
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

export default router
