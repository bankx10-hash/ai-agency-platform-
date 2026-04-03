import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'
import { logger } from '../utils/logger'
import axios from 'axios'
import { randomUUID } from 'crypto'

const router = Router()

const RETELL_API_KEY = process.env.RETELL_API_KEY || ''
const API_URL = process.env.API_URL || 'https://api.nodusaisystems.com'

const retellApi = axios.create({
  baseURL: 'https://api.retellai.com',
  headers: {
    Authorization: `Bearer ${RETELL_API_KEY}`,
    'Content-Type': 'application/json'
  }
})

// ── Public webhook (called by Retell on call end) ─────────────────────────────

export async function handleCallWebhook(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body
    const callData = body.call || body

    if (!callData?.call_id) {
      res.json({ received: true })
      return
    }

    // Only process ended/completed calls
    const status: string = callData.call_status || ''
    const event: string = body.event || ''
    if (status !== 'ended' && status !== 'completed' && event !== 'call_ended') {
      res.json({ received: true })
      return
    }

    const agentId: string | null = callData.agent_id || null

    // Find clientId from retellAgentId
    let clientId: string | null = null
    if (agentId) {
      const rows = await prisma.$queryRaw<Array<{ clientId: string }>>`
        SELECT "clientId" FROM "AgentDeployment"
        WHERE "retellAgentId" = ${agentId}
        LIMIT 1
      `
      clientId = rows[0]?.clientId || null
    }

    if (!clientId) {
      logger.warn('CallLog webhook: no client matched for agent', { agentId })
      res.json({ received: true })
      return
    }

    const startMs = callData.start_timestamp ? Number(callData.start_timestamp) : null
    const endMs   = callData.end_timestamp   ? Number(callData.end_timestamp)   : null
    const durationSeconds = callData.duration_ms
      ? Math.round(Number(callData.duration_ms) / 1000)
      : (startMs && endMs ? Math.round((endMs - startMs) / 1000) : 0)

    const direction = (
      callData.direction === 'outbound' || callData.call_type === 'outbound_call'
    ) ? 'OUTBOUND' : 'INBOUND'

    const analysis = callData.call_analysis || {}
    const transcriptObj = callData.transcript_object
      ? JSON.stringify(callData.transcript_object)
      : null

    const id = randomUUID()

    await prisma.$executeRaw`
      INSERT INTO "CallLog" (
        "id", "clientId", "retellCallId", "retellAgentId", "direction",
        "fromNumber", "toNumber", "status", "durationSeconds",
        "transcript", "transcriptObject",
        "startedAt", "endedAt", "summary", "analysisData", "createdAt"
      ) VALUES (
        ${id}, ${clientId}, ${callData.call_id as string}, ${agentId},
        ${direction},
        ${(callData.from_number as string) || null},
        ${(callData.to_number   as string) || null},
        ${'completed'},
        ${durationSeconds},
        ${(callData.transcript  as string) || null},
        ${transcriptObj}::jsonb,
        ${startMs ? new Date(startMs) : null},
        ${endMs   ? new Date(endMs)   : null},
        ${(analysis.call_summary as string) || null},
        ${JSON.stringify(analysis)}::jsonb,
        NOW()
      )
      ON CONFLICT ("retellCallId") WHERE "retellCallId" IS NOT NULL DO UPDATE SET
        "durationSeconds"  = EXCLUDED."durationSeconds",
        "transcript"       = EXCLUDED."transcript",
        "transcriptObject" = EXCLUDED."transcriptObject",
        "status"           = EXCLUDED."status",
        "endedAt"          = EXCLUDED."endedAt",
        "summary"          = EXCLUDED."summary",
        "analysisData"     = EXCLUDED."analysisData"
    `

    logger.info('Call logged via webhook', { clientId, callId: callData.call_id, direction, durationSeconds })

    // Forward to N8N for Claude analysis + contact creation (async — don't block response)
    const n8nPath = direction === 'OUTBOUND'
      ? `voice-outbound-${clientId}`
      : `voice-inbound-${clientId}`
    const n8nUrl = `${process.env.N8N_BASE_URL}/webhook/${n8nPath}`
    axios.post(n8nUrl, body, { timeout: 8000 }).catch(() => { /* non-fatal */ })

    res.json({ received: true })
  } catch (err) {
    logger.error('CallLog webhook error', { err })
    res.json({ received: true }) // always 200 to Retell
  }
}

// ── Authenticated routes ──────────────────────────────────────────────────────

router.use(authMiddleware)

// GET /calls/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).clientId

    const [totalRow, weekRow, todayRow, durationRow, apptRow, byDayRows, byDirRows] = await Promise.all([
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint as count FROM "CallLog" WHERE "clientId" = ${clientId}
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint as count FROM "CallLog"
        WHERE "clientId" = ${clientId} AND "createdAt" >= NOW() - INTERVAL '7 days'
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint as count FROM "CallLog"
        WHERE "clientId" = ${clientId} AND "createdAt" >= CURRENT_DATE
      `,
      prisma.$queryRaw<[{ avg: number | null; total: bigint | null }]>`
        SELECT
          AVG("durationSeconds")::float  as avg,
          SUM("durationSeconds")::bigint as total
        FROM "CallLog" WHERE "clientId" = ${clientId}
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint as count FROM "CallLog"
        WHERE "clientId" = ${clientId} AND "appointmentBooked" = true
      `,
      prisma.$queryRaw<Array<{ day: string; count: bigint; inbound: bigint; outbound: bigint }>>`
        SELECT
          TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
          COUNT(*)::bigint                                        as count,
          COUNT(*) FILTER (WHERE direction = 'INBOUND')::bigint  as inbound,
          COUNT(*) FILTER (WHERE direction = 'OUTBOUND')::bigint as outbound
        FROM "CallLog"
        WHERE "clientId" = ${clientId} AND "createdAt" >= NOW() - INTERVAL '7 days'
        GROUP BY 1 ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ direction: string; count: bigint }>>`
        SELECT direction, COUNT(*)::bigint as count FROM "CallLog"
        WHERE "clientId" = ${clientId}
        GROUP BY direction
      `
    ])

    res.json({
      total:              Number(totalRow[0]?.count    || 0),
      thisWeek:           Number(weekRow[0]?.count     || 0),
      today:              Number(todayRow[0]?.count    || 0),
      avgDurationSeconds: Math.round(durationRow[0]?.avg   || 0),
      totalDurationSeconds: Number(durationRow[0]?.total || 0),
      appointmentsBooked: Number(apptRow[0]?.count     || 0),
      byDay: byDayRows.map(r => ({
        day:      r.day,
        count:    Number(r.count),
        inbound:  Number(r.inbound),
        outbound: Number(r.outbound)
      })),
      byDirection: byDirRows.reduce((acc, r) => {
        acc[r.direction] = Number(r.count)
        return acc
      }, {} as Record<string, number>)
    })
  } catch (err) {
    logger.error('GET /calls/stats', { err })
    res.status(500).json({ error: 'Failed to load stats' })
  }
})

// POST /calls/sync — pull recent calls from Retell for all voice agents
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).clientId

    const agentRows = await prisma.$queryRaw<Array<{ retellAgentId: string }>>`
      SELECT "retellAgentId" FROM "AgentDeployment"
      WHERE "clientId" = ${clientId}
      AND "retellAgentId" IS NOT NULL
      AND "agentType" IN ('VOICE_INBOUND', 'VOICE_OUTBOUND')
    `

    if (!agentRows.length) {
      res.json({ synced: 0, message: 'No voice agents deployed' })
      return
    }

    let synced = 0

    for (const { retellAgentId } of agentRows) {
      try {
        const listRes = await retellApi.post('/v2/list-calls', {
          filter_criteria: { agent_id: [retellAgentId] },
          limit: 200,
          sort_order: 'descending'
        })
        const calls: any[] = Array.isArray(listRes.data) ? listRes.data : []

        for (const call of calls) {
          if (!call.call_id) continue

          const startMs = call.start_timestamp ? Number(call.start_timestamp) : null
          const endMs   = call.end_timestamp   ? Number(call.end_timestamp)   : null
          const durationSeconds = call.duration_ms
            ? Math.round(Number(call.duration_ms) / 1000)
            : (startMs && endMs ? Math.round((endMs - startMs) / 1000) : 0)

          const direction = (call.direction === 'outbound' || call.call_type === 'outbound_call')
            ? 'OUTBOUND' : 'INBOUND'
          const analysis = call.call_analysis || {}
          const transcriptObj = call.transcript_object ? JSON.stringify(call.transcript_object) : null
          const id = randomUUID()

          await prisma.$executeRaw`
            INSERT INTO "CallLog" (
              "id", "clientId", "retellCallId", "retellAgentId", "direction",
              "fromNumber", "toNumber", "status", "durationSeconds",
              "transcript", "transcriptObject",
              "startedAt", "endedAt", "summary", "analysisData", "createdAt"
            ) VALUES (
              ${id}, ${clientId}, ${call.call_id as string}, ${retellAgentId},
              ${direction},
              ${(call.from_number as string) || null},
              ${(call.to_number   as string) || null},
              ${(call.call_status as string) || 'completed'},
              ${durationSeconds},
              ${(call.transcript  as string) || null},
              ${transcriptObj}::jsonb,
              ${startMs ? new Date(startMs) : null},
              ${endMs   ? new Date(endMs)   : null},
              ${(analysis.call_summary as string) || null},
              ${JSON.stringify(analysis)}::jsonb,
              ${startMs ? new Date(startMs) : new Date()}
            )
            ON CONFLICT ("retellCallId") DO UPDATE SET
              "durationSeconds"  = EXCLUDED."durationSeconds",
              "transcript"       = EXCLUDED."transcript",
              "transcriptObject" = EXCLUDED."transcriptObject",
              "summary"          = EXCLUDED."summary",
              "analysisData"     = EXCLUDED."analysisData"
          `
          synced++
        }
      } catch (agentErr) {
        logger.warn('Sync failed for agent', { retellAgentId, agentErr })
      }
    }

    res.json({ synced, agents: agentRows.length })
  } catch (err) {
    logger.error('POST /calls/sync', { err })
    res.status(500).json({ error: 'Sync failed' })
  }
})

// GET /calls — paginated list with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).clientId
    const page  = Math.max(1, parseInt(req.query.page  as string) || 1)
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20)
    const offset = (page - 1) * limit

    const dirFilter = req.query.direction && req.query.direction !== 'all'
      ? (req.query.direction as string).toUpperCase() : null
    const fromDate = req.query.from ? new Date(req.query.from as string)                      : null
    const toDate   = req.query.to   ? new Date((req.query.to as string) + 'T23:59:59Z')       : null
    const search   = req.query.search ? `%${req.query.search}%`                               : null
    const apptOnly = req.query.appointmentBooked === 'true'

    const [calls, countRow] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT id, "retellCallId", direction, "fromNumber", "toNumber",
               status, "durationSeconds", "startedAt", "endedAt",
               "callerName", "intent", "appointmentBooked", "summary",
               "contactId", "createdAt"
        FROM "CallLog"
        WHERE "clientId" = ${clientId}
        AND (${dirFilter}::text IS NULL OR direction = ${dirFilter}::text)
        AND (${fromDate}::timestamptz IS NULL OR "createdAt" >= ${fromDate}::timestamptz)
        AND (${toDate}::timestamptz   IS NULL OR "createdAt" <= ${toDate}::timestamptz)
        AND (${search}::text IS NULL
             OR "callerName" ILIKE ${search}
             OR "fromNumber" ILIKE ${search}
             OR "toNumber"   ILIKE ${search})
        AND (${apptOnly} = false OR "appointmentBooked" = true)
        ORDER BY "createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint as count FROM "CallLog"
        WHERE "clientId" = ${clientId}
        AND (${dirFilter}::text IS NULL OR direction = ${dirFilter}::text)
        AND (${fromDate}::timestamptz IS NULL OR "createdAt" >= ${fromDate}::timestamptz)
        AND (${toDate}::timestamptz   IS NULL OR "createdAt" <= ${toDate}::timestamptz)
        AND (${search}::text IS NULL
             OR "callerName" ILIKE ${search}
             OR "fromNumber" ILIKE ${search}
             OR "toNumber"   ILIKE ${search})
        AND (${apptOnly} = false OR "appointmentBooked" = true)
      `
    ])

    res.json({
      calls: calls.map(c => ({
        ...c,
        durationSeconds:  Number(c.durationSeconds  || 0),
        appointmentBooked: Boolean(c.appointmentBooked)
      })),
      total: Number(countRow[0]?.count || 0),
      page,
      pages: Math.ceil(Number(countRow[0]?.count || 0) / limit)
    })
  } catch (err) {
    logger.error('GET /calls', { err })
    res.status(500).json({ error: 'Failed to load calls' })
  }
})

// GET /calls/:id — full call detail with parsed transcript
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const clientId = (req as any).clientId
    const { id } = req.params

    const rows = await prisma.$queryRaw<any[]>`
      SELECT * FROM "CallLog"
      WHERE id = ${id} AND "clientId" = ${clientId}
      LIMIT 1
    `

    if (!rows.length) {
      res.status(404).json({ error: 'Call not found' })
      return
    }

    const call = rows[0]

    // Build speaker-labelled transcript segments
    let transcriptSegments: Array<{ role: string; content: string }> = []
    if (call.transcriptObject && Array.isArray(call.transcriptObject)) {
      transcriptSegments = (call.transcriptObject as any[]).map((s: any) => ({
        role:    s.role    || 'unknown',
        content: s.content || ''
      }))
    } else if (call.transcript) {
      transcriptSegments = (call.transcript as string)
        .split('\n')
        .filter((l: string) => l.trim())
        .map((line: string) => {
          const idx = line.indexOf(':')
          if (idx > 0 && idx < 20) {
            return { role: line.slice(0, idx).trim().toLowerCase(), content: line.slice(idx + 1).trim() }
          }
          return { role: 'unknown', content: line }
        })
    }

    res.json({
      ...call,
      durationSeconds:  Number(call.durationSeconds  || 0),
      appointmentBooked: Boolean(call.appointmentBooked),
      transcriptSegments
    })
  } catch (err) {
    logger.error('GET /calls/:id', { err })
    res.status(500).json({ error: 'Failed to load call' })
  }
})

export default router
