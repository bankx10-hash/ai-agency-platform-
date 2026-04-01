import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logger } from '../utils/logger'

const router = Router()
const prisma = new PrismaClient()

router.use(authMiddleware)

// GET /notifications
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const notifications = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id", "clientId", "type", "title", "body", "link", "isRead", "createdAt"
      FROM "Notification"
      WHERE "clientId" = ${clientId}
      ORDER BY "createdAt" DESC
      LIMIT 30
    `
    const unreadCount = notifications.filter(n => !n.isRead).length
    res.json({ notifications, unreadCount })
  } catch (err) {
    logger.error('Get notifications error', { err })
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

// PATCH /notifications/read-all  — must be before /:id/read
router.patch('/read-all', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    await prisma.$executeRaw`UPDATE "Notification" SET "isRead" = true WHERE "clientId" = ${clientId}`
    res.json({ success: true })
  } catch (err) {
    logger.error('Mark all read error', { err })
    res.status(500).json({ error: 'Failed to mark notifications as read' })
  }
})

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    await prisma.$executeRaw`
      UPDATE "Notification" SET "isRead" = true
      WHERE "id" = ${req.params.id} AND "clientId" = ${clientId}
    `
    res.json({ success: true })
  } catch (err) {
    logger.error('Mark read error', { err })
    res.status(500).json({ error: 'Failed to mark notification as read' })
  }
})

export default router
