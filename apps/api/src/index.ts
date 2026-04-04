import 'dotenv/config'
import express from 'express'
import cron from 'node-cron'
import { prisma } from './lib/prisma'
import { apiRateLimit } from './middleware/rateLimit'
import authRouter from './routes/auth'
import billingRouter from './routes/billing'
import clientsRouter from './routes/clients'
import agentsRouter from './routes/agents'
import onboardingRouter from './routes/onboarding'
import webhooksRouter from './routes/webhooks'
import n8nCallbacksRouter from './routes/n8n-callbacks'
import adminRouter from './routes/admin'
import calendarRouter from './routes/calendar'
import metaWebhooksRouter from './routes/meta-webhooks'
import crmRouter from './routes/crm'
import marketingRouter from './routes/marketing'
import inboxRouter from './routes/inbox'
import notificationsRouter from './routes/notifications'
import { sendDailyDigest } from './services/digest'
import sequencesRouter, { processSequences } from './routes/sequences'
import smsRouter, { handleSmsWebhook } from './routes/sms'
import callsRouter, { handleCallWebhook } from './routes/calls'
import leadsRouter from './routes/leads'
import workflowsRouter from './routes/workflows'
import whatsappWebhooksRouter from './routes/whatsapp-webhooks'
import { startWorkflowTimeoutScheduler } from './queue/workflow-timeout.queue'
import { startSocialPublishScheduler } from './queue/social-publish.queue'
import { startSocialReminderScheduler } from './queue/social-reminder.queue'
import { startSocialAnalyticsScheduler } from './queue/social-analytics.queue'
import { startSocialCompetitorScheduler } from './queue/social-competitor.queue'
import { startSocialNewsScheduler } from './queue/social-news.queue'
import socialRouter from './routes/social'
import { logger } from './utils/logger'

// Prevent silent crashes — log and keep running
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason })
})
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack })
})

async function runStartupMigrations() {
  try {
    // Convert enum column to plain text so Prisma String? mapping works
    await prisma.$executeRaw`ALTER TABLE "Client" ALTER COLUMN "crmType" TYPE TEXT USING "crmType"::text`
    logger.info('Startup migration: crmType converted to TEXT')
  } catch { /* already TEXT, skip */ }

  try {
    // Make nullable to match Prisma String?
    await prisma.$executeRaw`ALTER TABLE "Client" ALTER COLUMN "crmType" DROP NOT NULL`
    logger.info('Startup migration: crmType made nullable')
  } catch { /* already nullable, skip */ }

  try {
    // Null out any rows where crmType was stored as the string "NONE"
    await prisma.$executeRaw`UPDATE "Client" SET "crmType" = NULL WHERE "crmType" IN ('NONE', 'none')`
    logger.info('Startup migration: cleared invalid crmType values')
  } catch (err) {
    logger.warn('Startup migration: UPDATE failed', { err })
  }

  try {
    await prisma.$executeRaw`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'AU'`
    logger.info('Startup migration: country column ensured')
  } catch { /* already exists, skip */ }

  try {
    await prisma.$executeRaw`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "businessDescription" TEXT`
    await prisma.$executeRaw`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "icpDescription" TEXT`
    logger.info('Startup migration: businessDescription and icpDescription columns ensured')
  } catch { /* already exists, skip */ }

  try {
    await prisma.$executeRaw`ALTER TYPE "AgentType" ADD VALUE IF NOT EXISTS 'SOCIAL_ENGAGEMENT'`
    logger.info('Startup migration: SOCIAL_ENGAGEMENT enum value ensured')
  } catch { /* already exists, skip */ }

  try {
    await prisma.$executeRaw`ALTER TYPE "AgentType" ADD VALUE IF NOT EXISTS 'CONVERSATIONAL_WORKFLOW'`
    logger.info('Startup migration: CONVERSATIONAL_WORKFLOW enum value ensured')
  } catch { /* already exists, skip */ }

  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Contact" (
        "id"         TEXT        NOT NULL,
        "clientId"   TEXT        NOT NULL,
        "name"       TEXT,
        "email"      TEXT,
        "phone"      TEXT,
        "source"     TEXT,
        "stage"      TEXT        NOT NULL DEFAULT 'new',
        "score"      INTEGER,
        "tags"       JSONB       NOT NULL DEFAULT '[]',
        "summary"    TEXT,
        "nextAction" TEXT,
        "crmId"      TEXT,
        "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "Contact_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId")
          REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "ContactNote" (
        "id"        TEXT        NOT NULL,
        "contactId" TEXT        NOT NULL,
        "body"      TEXT        NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "ContactNote_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ContactNote_contactId_fkey" FOREIGN KEY ("contactId")
          REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    // Unique index so upsert-by-email works without duplicates
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "Contact_clientId_email_key"
      ON "Contact"("clientId", "email")
      WHERE "email" IS NOT NULL
    `
    logger.info('Startup migration: Contact and ContactNote tables ensured')
  } catch { /* already exist, skip */ }

  // Fix: cast pipelineStage from TEXT to PipelineStage enum so Prisma queries work
  try {
    // First, fix any invalid values that would prevent the cast
    await prisma.$executeRaw`UPDATE "Contact" SET "pipelineStage" = 'NEW_LEAD' WHERE "pipelineStage" NOT IN ('NEW_LEAD','CONTACTED','QUALIFIED','PROPOSAL','CLOSED_WON','CLOSED_LOST')`
    await prisma.$executeRaw`ALTER TABLE "Contact" ALTER COLUMN "pipelineStage" TYPE "PipelineStage" USING "pipelineStage"::"PipelineStage"`
    logger.info('Startup migration: pipelineStage cast to PipelineStage enum')
  } catch { /* already enum type or enum doesn't exist yet, skip */ }

  // Also cast Deal.stage from TEXT to PipelineStage enum
  try {
    await prisma.$executeRaw`UPDATE "Deal" SET "stage" = 'NEW_LEAD' WHERE "stage" NOT IN ('NEW_LEAD','CONTACTED','QUALIFIED','PROPOSAL','CLOSED_WON','CLOSED_LOST')`
    await prisma.$executeRaw`ALTER TABLE "Deal" ALTER COLUMN "stage" TYPE "PipelineStage" USING "stage"::"PipelineStage"`
    logger.info('Startup migration: Deal.stage cast to PipelineStage enum')
  } catch { /* already enum type, skip */ }

  // CRM Phase 1: add new columns to existing Contact table + create new CRM tables
  try {
    await prisma.$executeRaw`ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "pipelineStage" TEXT NOT NULL DEFAULT 'NEW_LEAD'`
    await prisma.$executeRaw`ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "dealValue" DECIMAL(12,2)`
    await prisma.$executeRaw`ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "dealCurrency" TEXT NOT NULL DEFAULT 'AUD'`
    await prisma.$executeRaw`ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMPTZ`
    await prisma.$executeRaw`ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "score" INTEGER`
    logger.info('Startup migration: CRM columns added to Contact table')
  } catch { /* already exist, skip */ }

  try {
    await prisma.$executeRaw`ALTER TABLE "ContactNote" ADD COLUMN IF NOT EXISTS "authorType" TEXT NOT NULL DEFAULT 'agent'`
    logger.info('Startup migration: authorType column added to ContactNote')
  } catch { /* already exist, skip */ }

  try {
    await prisma.$executeRaw`ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Contact_linkedinUrl_idx" ON "Contact"("linkedinUrl") WHERE "linkedinUrl" IS NOT NULL`
    logger.info('Startup migration: linkedinUrl column added to Contact table')
  } catch { /* already exist, skip */ }

  try {
    await prisma.$executeRaw`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PipelineStage') THEN
          CREATE TYPE "PipelineStage" AS ENUM ('NEW_LEAD','CONTACTED','QUALIFIED','PROPOSAL','CLOSED_WON','CLOSED_LOST');
        END IF;
      END $$
    `
    await prisma.$executeRaw`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActivityType') THEN
          CREATE TYPE "ActivityType" AS ENUM ('NOTE','CALL','EMAIL','SMS','APPOINTMENT','STAGE_CHANGE','SCORE_CHANGE','TASK_COMPLETED','AGENT_ACTION');
        END IF;
      END $$
    `
    await prisma.$executeRaw`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskStatus') THEN
          CREATE TYPE "TaskStatus" AS ENUM ('PENDING','DONE','CANCELLED');
        END IF;
      END $$
    `
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "ContactActivity" (
        "id"        TEXT        NOT NULL,
        "contactId" TEXT        NOT NULL,
        "clientId"  TEXT        NOT NULL,
        "type"      TEXT        NOT NULL,
        "title"     TEXT        NOT NULL,
        "body"      TEXT,
        "metadata"  JSONB,
        "agentType" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "ContactActivity_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ContactActivity_contactId_fkey" FOREIGN KEY ("contactId")
          REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ContactActivity_contactId_createdAt_idx" ON "ContactActivity"("contactId","createdAt")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ContactActivity_clientId_type_idx" ON "ContactActivity"("clientId","type")`
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "ContactTask" (
        "id"          TEXT        NOT NULL,
        "contactId"   TEXT        NOT NULL,
        "clientId"    TEXT        NOT NULL,
        "title"       TEXT        NOT NULL,
        "body"        TEXT,
        "status"      TEXT        NOT NULL DEFAULT 'PENDING',
        "dueAt"       TIMESTAMPTZ,
        "completedAt" TIMESTAMPTZ,
        "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "ContactTask_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ContactTask_contactId_fkey" FOREIGN KEY ("contactId")
          REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ContactTask_clientId_status_dueAt_idx" ON "ContactTask"("clientId","status","dueAt")`
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Deal" (
        "id"          TEXT        NOT NULL,
        "contactId"   TEXT        NOT NULL,
        "clientId"    TEXT        NOT NULL,
        "title"       TEXT        NOT NULL,
        "value"       DECIMAL(12,2),
        "currency"    TEXT        NOT NULL DEFAULT 'AUD',
        "stage"       TEXT        NOT NULL DEFAULT 'NEW_LEAD',
        "probability" INTEGER,
        "closedAt"    TIMESTAMPTZ,
        "lostReason"  TEXT,
        "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "Deal_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId")
          REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Deal_clientId_stage_idx" ON "Deal"("clientId","stage")`
    logger.info('Startup migration: CRM tables (ContactActivity, ContactTask, Deal) ensured')
  } catch { /* already exist, skip */ }

  // Marketing tables
  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Campaign" (
        "id"              TEXT        NOT NULL,
        "clientId"        TEXT        NOT NULL,
        "name"            TEXT        NOT NULL,
        "type"            TEXT        NOT NULL,
        "subject"         TEXT,
        "body"            TEXT        NOT NULL,
        "status"          TEXT        NOT NULL DEFAULT 'DRAFT',
        "scheduledAt"     TIMESTAMPTZ,
        "sentAt"          TIMESTAMPTZ,
        "recipientFilter" JSONB,
        "stats"           JSONB,
        "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId")
          REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Campaign_clientId_status_idx" ON "Campaign"("clientId","status")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Campaign_clientId_createdAt_idx" ON "Campaign"("clientId","createdAt")`
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "CampaignRecipient" (
        "id"         TEXT        NOT NULL,
        "campaignId" TEXT        NOT NULL,
        "contactId"  TEXT        NOT NULL,
        "status"     TEXT        NOT NULL DEFAULT 'PENDING',
        "sentAt"     TIMESTAMPTZ,
        "openedAt"   TIMESTAMPTZ,
        "clickedAt"  TIMESTAMPTZ,
        "error"      TEXT,
        CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CampaignRecipient_campaignId_contactId_key" UNIQUE ("campaignId","contactId"),
        CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId")
          REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId")
          REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId","status")`
    logger.info('Startup migration: Campaign tables ensured')
  } catch { /* already exist, skip */ }

  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Funnel" (
        "id"          TEXT        NOT NULL,
        "clientId"    TEXT        NOT NULL,
        "name"        TEXT        NOT NULL,
        "description" TEXT,
        "status"      TEXT        NOT NULL DEFAULT 'DRAFT',
        "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "Funnel_clientId_fkey" FOREIGN KEY ("clientId")
          REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Funnel_clientId_status_idx" ON "Funnel"("clientId","status")`
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "FunnelStep" (
        "id"          TEXT    NOT NULL,
        "funnelId"    TEXT    NOT NULL,
        "name"        TEXT    NOT NULL,
        "type"        TEXT    NOT NULL,
        "order"       INTEGER NOT NULL,
        "headline"    TEXT,
        "subheadline" TEXT,
        "body"        TEXT,
        "ctaText"     TEXT,
        "config"      JSONB,
        CONSTRAINT "FunnelStep_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "FunnelStep_funnelId_fkey" FOREIGN KEY ("funnelId")
          REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "FunnelStep_funnelId_order_idx" ON "FunnelStep"("funnelId","order")`
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "FunnelSubmission" (
        "id"        TEXT        NOT NULL,
        "funnelId"  TEXT        NOT NULL,
        "stepId"    TEXT,
        "contactId" TEXT,
        "data"      JSONB,
        "ip"        TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "FunnelSubmission_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "FunnelSubmission_funnelId_fkey" FOREIGN KEY ("funnelId")
          REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "FunnelSubmission_funnelId_createdAt_idx" ON "FunnelSubmission"("funnelId","createdAt")`
    logger.info('Startup migration: Funnel tables ensured')
  } catch { /* already exist, skip */ }

  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Notification" (
        "id"        TEXT        NOT NULL,
        "clientId"  TEXT        NOT NULL,
        "type"      TEXT        NOT NULL,
        "title"     TEXT        NOT NULL,
        "body"      TEXT,
        "link"      TEXT,
        "isRead"    BOOLEAN     NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "Notification_clientId_fkey" FOREIGN KEY ("clientId")
          REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Notification_clientId_createdAt_idx" ON "Notification"("clientId","createdAt")`
    logger.info('Startup migration: Notification table ensured')
  } catch { /* already exist, skip */ }

  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "EmailSequence" (
        "id"          TEXT        NOT NULL,
        "clientId"    TEXT        NOT NULL,
        "name"        TEXT        NOT NULL,
        "description" TEXT,
        "steps"       JSONB       NOT NULL DEFAULT '[]',
        "isActive"    BOOLEAN     NOT NULL DEFAULT TRUE,
        "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "EmailSequence_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "EmailSequence_clientId_fkey" FOREIGN KEY ("clientId")
          REFERENCES "Client"("id") ON DELETE CASCADE
      )
    `
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "SequenceEnrollment" (
        "id"           TEXT        NOT NULL,
        "clientId"     TEXT        NOT NULL,
        "contactId"    TEXT        NOT NULL,
        "sequenceId"   TEXT        NOT NULL,
        "currentStep"  INTEGER     NOT NULL DEFAULT 1,
        "status"       TEXT        NOT NULL DEFAULT 'ACTIVE',
        "nextSendAt"   TIMESTAMPTZ,
        "enrolledAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "completedAt"  TIMESTAMPTZ,
        CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "SequenceEnrollment_contactId_fkey" FOREIGN KEY ("contactId")
          REFERENCES "Contact"("id") ON DELETE CASCADE,
        CONSTRAINT "SequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId")
          REFERENCES "EmailSequence"("id") ON DELETE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "SequenceEnrollment_status_nextSendAt_idx" ON "SequenceEnrollment"("status","nextSendAt")`
    logger.info('Startup migration: EmailSequence and SequenceEnrollment tables ensured')
  } catch { /* already exist, skip */ }

  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "SmsMessage" (
        "id"         TEXT        NOT NULL,
        "clientId"   TEXT        NOT NULL,
        "contactId"  TEXT,
        "from"       TEXT        NOT NULL,
        "to"         TEXT        NOT NULL,
        "body"       TEXT        NOT NULL,
        "direction"  TEXT        NOT NULL DEFAULT 'OUTBOUND',
        "twilioSid"  TEXT,
        "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "SmsMessage_clientId_fkey" FOREIGN KEY ("clientId")
          REFERENCES "Client"("id") ON DELETE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "SmsMessage_clientId_createdAt_idx" ON "SmsMessage"("clientId","createdAt")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "SmsMessage_clientId_from_idx" ON "SmsMessage"("clientId","from")`
    logger.info('Startup migration: SmsMessage table ensured')
  } catch { /* already exist, skip */ }

  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "CallLog" (
        "id"               TEXT        NOT NULL,
        "clientId"         TEXT        NOT NULL,
        "retellCallId"     TEXT,
        "retellAgentId"    TEXT,
        "direction"        TEXT        NOT NULL DEFAULT 'INBOUND',
        "fromNumber"       TEXT,
        "toNumber"         TEXT,
        "status"           TEXT        NOT NULL DEFAULT 'completed',
        "durationSeconds"  INTEGER     NOT NULL DEFAULT 0,
        "transcript"       TEXT,
        "transcriptObject" JSONB,
        "startedAt"        TIMESTAMPTZ,
        "endedAt"          TIMESTAMPTZ,
        "callerName"       TEXT,
        "callerEmail"      TEXT,
        "intent"           TEXT,
        "appointmentBooked" BOOLEAN    NOT NULL DEFAULT false,
        "summary"          TEXT,
        "contactId"        TEXT,
        "analysisData"     JSONB,
        "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CallLog_clientId_fkey" FOREIGN KEY ("clientId")
          REFERENCES "Client"("id") ON DELETE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "CallLog_retellCallId_key" ON "CallLog"("retellCallId") WHERE "retellCallId" IS NOT NULL`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "CallLog_clientId_createdAt_idx" ON "CallLog"("clientId","createdAt")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "CallLog_clientId_direction_idx" ON "CallLog"("clientId","direction")`
    logger.info('Startup migration: CallLog table ensured')
  } catch { /* already exist, skip */ }

  // ── Social Media Dashboard tables ─────────────────────────────────────────
  try {
    // Add social settings columns to Client
    await prisma.$executeRaw`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "autoApprovePosts" BOOLEAN NOT NULL DEFAULT false`
    await prisma.$executeRaw`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "postReviewLeadHours" INTEGER NOT NULL DEFAULT 24`
    await prisma.$executeRaw`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "postReminderHours" JSONB NOT NULL DEFAULT '[6, 2]'`

    // Create PostStatus, SocialPlatform, PostSource types (use TEXT, Prisma maps enums to text)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "ScheduledPost" (
        "id"             TEXT        NOT NULL,
        "clientId"       TEXT        NOT NULL,
        "platform"       TEXT        NOT NULL,
        "status"         TEXT        NOT NULL DEFAULT 'DRAFT',
        "source"         TEXT        NOT NULL DEFAULT 'MANUAL',
        "content"        TEXT        NOT NULL,
        "imageUrl"       TEXT,
        "imagePrompt"    TEXT,
        "hashtags"       JSONB       NOT NULL DEFAULT '[]',
        "contentPillar"  TEXT,
        "scheduledAt"    TIMESTAMPTZ,
        "publishedAt"    TIMESTAMPTZ,
        "externalPostId" TEXT,
        "errorMessage"   TEXT,
        "autoApproved"   BOOLEAN     NOT NULL DEFAULT false,
        "metadata"       JSONB,
        "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ScheduledPost_clientId_fkey" FOREIGN KEY ("clientId")
          REFERENCES "Client"("id") ON DELETE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ScheduledPost_clientId_status_idx" ON "ScheduledPost"("clientId","status")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ScheduledPost_clientId_platform_idx" ON "ScheduledPost"("clientId","platform")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ScheduledPost_clientId_scheduledAt_idx" ON "ScheduledPost"("clientId","scheduledAt")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ScheduledPost_status_scheduledAt_idx" ON "ScheduledPost"("status","scheduledAt")`

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "PostAnalytics" (
        "id"             TEXT        NOT NULL,
        "postId"         TEXT        NOT NULL UNIQUE,
        "impressions"    INTEGER     NOT NULL DEFAULT 0,
        "reach"          INTEGER     NOT NULL DEFAULT 0,
        "engagements"    INTEGER     NOT NULL DEFAULT 0,
        "likes"          INTEGER     NOT NULL DEFAULT 0,
        "comments"       INTEGER     NOT NULL DEFAULT 0,
        "shares"         INTEGER     NOT NULL DEFAULT 0,
        "clicks"         INTEGER     NOT NULL DEFAULT 0,
        "saves"          INTEGER     NOT NULL DEFAULT 0,
        "engagementRate" DECIMAL(5,4),
        "rawData"        JSONB,
        "fetchedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PostAnalytics_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PostAnalytics_postId_fkey" FOREIGN KEY ("postId")
          REFERENCES "ScheduledPost"("id") ON DELETE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "PostAnalytics_postId_idx" ON "PostAnalytics"("postId")`

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "PlatformInsight" (
        "id"        TEXT        NOT NULL,
        "clientId"  TEXT        NOT NULL,
        "platform"  TEXT        NOT NULL,
        "metric"    TEXT        NOT NULL,
        "period"    TEXT        NOT NULL DEFAULT 'day',
        "value"     INTEGER     NOT NULL,
        "endTime"   TIMESTAMPTZ NOT NULL,
        "fetchedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PlatformInsight_pkey" PRIMARY KEY ("id")
      )
    `
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "PlatformInsight_clientId_platform_metric_period_endTime_key" ON "PlatformInsight"("clientId","platform","metric","period","endTime")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "PlatformInsight_clientId_platform_fetchedAt_idx" ON "PlatformInsight"("clientId","platform","fetchedAt")`

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Competitor" (
        "id"        TEXT        NOT NULL,
        "clientId"  TEXT        NOT NULL,
        "name"      TEXT        NOT NULL,
        "platform"  TEXT        NOT NULL,
        "handle"    TEXT        NOT NULL,
        "avatarUrl" TEXT,
        "isActive"  BOOLEAN     NOT NULL DEFAULT true,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
      )
    `
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "Competitor_clientId_platform_handle_key" ON "Competitor"("clientId","platform","handle")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Competitor_clientId_isActive_idx" ON "Competitor"("clientId","isActive")`

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "CompetitorSnapshot" (
        "id"             TEXT        NOT NULL,
        "competitorId"   TEXT        NOT NULL,
        "followers"      INTEGER,
        "posts"          INTEGER,
        "avgLikes"       INTEGER,
        "avgComments"    INTEGER,
        "engagementRate" DECIMAL(5,4),
        "recentPosts"    JSONB,
        "fetchedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "CompetitorSnapshot_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CompetitorSnapshot_competitorId_fkey" FOREIGN KEY ("competitorId")
          REFERENCES "Competitor"("id") ON DELETE CASCADE
      )
    `
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "CompetitorSnapshot_competitorId_fetchedAt_idx" ON "CompetitorSnapshot"("competitorId","fetchedAt")`

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "NewsItem" (
        "id"          TEXT        NOT NULL,
        "clientId"    TEXT        NOT NULL,
        "title"       TEXT        NOT NULL,
        "source"      TEXT        NOT NULL,
        "url"         TEXT        NOT NULL,
        "imageUrl"    TEXT,
        "summary"     TEXT,
        "category"    TEXT,
        "publishedAt" TIMESTAMPTZ NOT NULL,
        "fetchedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "isRead"      BOOLEAN     NOT NULL DEFAULT false,
        "isSaved"     BOOLEAN     NOT NULL DEFAULT false,
        CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
      )
    `
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "NewsItem_clientId_url_key" ON "NewsItem"("clientId","url")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "NewsItem_clientId_fetchedAt_idx" ON "NewsItem"("clientId","fetchedAt")`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "NewsItem_clientId_category_idx" ON "NewsItem"("clientId","category")`

    logger.info('Startup migration: Social media dashboard tables ensured')
  } catch (err) { logger.warn('Social media migration partial', { err }) }

}

const app = express()
app.set('trust proxy', 1)
const PORT = process.env.PORT || 4000

const ALLOWED_ORIGINS = [
  'https://app.nodusaisystems.com',
  'http://localhost:3000',
  'http://localhost:3001',
]

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-admin-secret,x-api-secret')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }))

// Meta & WhatsApp webhooks must be registered before rate limiter — Meta's IPs must never be blocked
app.use('/webhooks/meta', metaWebhooksRouter)
app.use('/webhooks/whatsapp', whatsappWebhooksRouter)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.use(apiRateLimit)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/auth', authRouter)
app.use('/billing', billingRouter)
app.use('/clients', clientsRouter)
app.use('/agents', agentsRouter)
app.use('/onboarding', onboardingRouter)
app.use('/webhooks', webhooksRouter)
app.use('/n8n', n8nCallbacksRouter)
app.use('/admin', adminRouter)
app.use('/calendar', calendarRouter)
app.use('/crm', crmRouter)
app.use('/marketing', marketingRouter)
app.use('/inbox', inboxRouter)
app.use('/notifications', notificationsRouter)
app.use('/workflows', workflowsRouter)
app.use('/sequences', sequencesRouter)
app.post('/sms/webhook', handleSmsWebhook)
app.use('/sms', smsRouter)
app.use('/social', socialRouter)
app.post('/calls/webhook', handleCallWebhook)
app.use('/calls', callsRouter)
// Public lead capture — allow any origin (embedded on client websites)
app.use('/leads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
}, leadsRouter)

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack
  })

  // Ensure CORS headers are set even on error responses
  const origin = _req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  })
})

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

runStartupMigrations().then(() => {
  app.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`, {
      port: PORT,
      environment: process.env.NODE_ENV || 'development'
    })

    // Daily digest — 7am UTC every day
    cron.schedule('0 7 * * *', () => {
      sendDailyDigest().catch(err => logger.error('Daily digest cron failed', { err }))
    })
    logger.info('Daily digest cron scheduled at 07:00 UTC')

    // Sequence processor — every 15 minutes
    cron.schedule('*/15 * * * *', () => {
      processSequences().catch(err => logger.error('Sequence processor failed', { err }))
    })
    logger.info('Sequence processor cron scheduled every 15 minutes')

    // Workflow conversation timeout checker
    startWorkflowTimeoutScheduler()

    // Social media dashboard schedulers
    startSocialPublishScheduler()
    startSocialReminderScheduler()
    startSocialAnalyticsScheduler()
    startSocialCompetitorScheduler()
    startSocialNewsScheduler()
  })
})


export default app

