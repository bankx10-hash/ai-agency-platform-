import nodemailer from 'nodemailer'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'

const PORTAL_URL = 'https://app.nodusaisystems.com'

export async function sendDailyDigest(): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.info('Digest: SMTP_USER/SMTP_PASS not configured — skipping')
    return
  }

  const clients = await prisma.client.findMany({
    where: { status: 'ACTIVE' as never },
    select: { id: true, email: true, businessName: true }
  })

  logger.info(`Digest: sending to ${clients.length} active clients`)

  for (const client of clients) {
    try {
      await sendDigestForClient(client)
    } catch (err) {
      logger.error('Digest failed for client', { clientId: client.id, err })
    }
  }
}

async function sendDigestForClient(client: { id: string; email: string; businessName: string }): Promise<void> {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [newContacts, activityRows, completedTasks, stageChangeRows, pipelineRows, dealValueRows] = await Promise.all([
    // New contacts yesterday
    prisma.contact.count({ where: { clientId: client.id, createdAt: { gte: yesterday, lt: today } } }),

    // Activity breakdown yesterday (excluding system types)
    prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
      SELECT type, COUNT(*) as count FROM "ContactActivity"
      WHERE "clientId" = ${client.id}
        AND "createdAt" >= ${yesterday} AND "createdAt" < ${today}
        AND type NOT IN ('SCORE_CHANGE', 'STAGE_CHANGE', 'TASK_COMPLETED')
      GROUP BY type
      ORDER BY count DESC
    `,

    // Tasks completed yesterday
    prisma.contactTask.count({
      where: { clientId: client.id, status: 'DONE' as never, completedAt: { gte: yesterday, lt: today } }
    }),

    // Stage moves yesterday
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM "ContactActivity"
      WHERE "clientId" = ${client.id}
        AND "createdAt" >= ${yesterday} AND "createdAt" < ${today}
        AND type = 'STAGE_CHANGE'
    `,

    // Current pipeline breakdown
    prisma.$queryRaw<Array<{ pipelineStage: string; count: bigint }>>`
      SELECT "pipelineStage", COUNT(*) as count FROM "Contact"
      WHERE "clientId" = ${client.id}
      GROUP BY "pipelineStage"
      ORDER BY count DESC
    `,

    // Active pipeline value
    prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM("dealValue"), 0) as total FROM "Deal"
      WHERE "clientId" = ${client.id} AND stage != 'CLOSED_LOST'
    `
  ])

  const stageChanges = Number(stageChangeRows[0]?.count ?? 0)
  const pipelineValue = parseFloat(dealValueRows[0]?.total ?? '0')

  const ACTIVITY_LABELS: Record<string, string> = {
    CALL: 'Calls', EMAIL: 'Emails', NOTE: 'Notes',
    SMS: 'SMS', APPOINTMENT: 'Appointments', AGENT_ACTION: 'AI Actions'
  }
  const STAGE_ORDER = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CLOSED_WON', 'CLOSED_LOST']

  const activityLines = activityRows.map(a =>
    `<span style="margin-right:16px"><strong>${Number(a.count)}</strong> ${ACTIVITY_LABELS[a.type] || a.type}</span>`
  ).join('') || '<span style="color:#6b7280">No activities logged</span>'

  const sortedPipeline = [...pipelineRows].sort(
    (a, b) => STAGE_ORDER.indexOf(a.pipelineStage as string) - STAGE_ORDER.indexOf(b.pipelineStage as string)
  )
  const pipelineLines = sortedPipeline.map(r => {
    const label = (r.pipelineStage as string).replace(/_/g, ' ')
    const count = Number(r.count)
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6">
      <span style="color:#374151;font-size:13px">${label}</span>
      <span style="font-weight:600;color:#111;font-size:13px">${count}</span>
    </div>`
  }).join('')

  const dateStr = yesterday.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:580px;margin:32px auto;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 32px">
    <p style="margin:0;color:#c7d2fe;font-size:12px;text-transform:uppercase;letter-spacing:0.08em">Daily Digest</p>
    <h1 style="margin:4px 0 0;color:white;font-size:22px;font-weight:700">${client.businessName}</h1>
    <p style="margin:4px 0 0;color:#e0e7ff;font-size:13px">${dateStr}</p>
  </div>

  <!-- Stats row -->
  <div style="background:white;padding:24px 32px;display:flex;gap:0;border-bottom:1px solid #f3f4f6">
    <div style="flex:1;text-align:center;padding:0 12px;border-right:1px solid #f3f4f6">
      <div style="font-size:32px;font-weight:700;color:#4f46e5">${newContacts}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">New Leads</div>
    </div>
    <div style="flex:1;text-align:center;padding:0 12px;border-right:1px solid #f3f4f6">
      <div style="font-size:32px;font-weight:700;color:#059669">${stageChanges}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">Stage Moves</div>
    </div>
    <div style="flex:1;text-align:center;padding:0 12px">
      <div style="font-size:32px;font-weight:700;color:#d97706">${completedTasks}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">Tasks Done</div>
    </div>
  </div>

  <!-- Activity -->
  <div style="background:white;padding:20px 32px;border-bottom:1px solid #f3f4f6">
    <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em">Yesterday's Activity</p>
    <div style="font-size:14px;color:#374151">${activityLines}</div>
  </div>

  <!-- Pipeline -->
  <div style="background:white;padding:20px 32px;border-bottom:1px solid #f3f4f6">
    <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em">Pipeline Snapshot</p>
    ${pipelineLines}
    ${pipelineValue > 0 ? `<div style="margin-top:12px;padding:10px 12px;background:#f0fdf4;border-radius:8px;font-size:14px;font-weight:600;color:#059669">Pipeline Value: $${pipelineValue.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} AUD</div>` : ''}
  </div>

  <!-- CTA -->
  <div style="background:white;padding:24px 32px;text-align:center">
    <a href="${PORTAL_URL}/dashboard/crm" style="display:inline-block;background:#4f46e5;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Open Dashboard →</a>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af">Nodus AI Systems · Automated daily performance report</p>
  </div>

</div>
</body>
</html>`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  })

  await transporter.sendMail({
    from: `"Nodus AI" <${process.env.SMTP_USER}>`,
    to: client.email,
    subject: `📊 Daily Digest — ${newContacts} new lead${newContacts !== 1 ? 's' : ''} · ${dateStr}`,
    html
  })

  logger.info('Digest sent', { clientId: client.id, email: client.email, newContacts, stageChanges })
}
