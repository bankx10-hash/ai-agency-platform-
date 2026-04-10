import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { getUsageSummary, getUsageHistory, OVERAGE_RATES } from '../services/usage.service'
import { logger } from '../utils/logger'

const router = Router()

router.use(authMiddleware)

// GET /usage/summary — current billing period usage vs limits + overage costs
router.get('/summary', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const summary = await getUsageSummary(clientId)
    if (!summary) {
      res.status(404).json({ error: 'Client not found' })
      return
    }
    res.json(summary)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logger.error('Usage summary error', { clientId: req.clientId, err: detail })
    res.status(500).json({ error: 'Failed to fetch usage summary', detail })
  }
})

// GET /usage/history?months=3 — past billing period summaries for trend charts
router.get('/history', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.clientId!
    const months = Math.min(parseInt(req.query.months as string) || 3, 12)
    const history = await getUsageHistory(clientId, months)
    res.json({ history })
  } catch (err) {
    logger.error('Usage history error', { err })
    res.status(500).json({ error: 'Failed to fetch usage history' })
  }
})

// GET /usage/rates — overage rates for display on the dashboard
router.get('/rates', async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ rates: OVERAGE_RATES })
})

export default router
