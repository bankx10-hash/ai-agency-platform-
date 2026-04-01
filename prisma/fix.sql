-- Create missing enums if they don't exist
DO $$ BEGIN
  CREATE TYPE "FunnelStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StepType" AS ENUM ('LANDING', 'OPT_IN', 'UPSELL', 'THANK_YOU', 'SALES_PAGE', 'WEBINAR', 'CHECKOUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'SMS', 'APPOINTMENT', 'STAGE_CHANGE', 'SCORE_CHANGE', 'TASK_COMPLETED', 'AGENT_ACTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Convert ContactActivity.type from text to enum (if it's still text)
ALTER TABLE "ContactActivity" ALTER COLUMN "type" TYPE "ActivityType" USING "type"::"ActivityType";

-- Create Funnel table if it doesn't exist
CREATE TABLE IF NOT EXISTS "Funnel" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "FunnelStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id")
);

-- Create FunnelStep table if it doesn't exist
CREATE TABLE IF NOT EXISTS "FunnelStep" (
  "id" TEXT NOT NULL,
  "funnelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "StepType" NOT NULL,
  "order" INTEGER NOT NULL,
  "headline" TEXT,
  "subheadline" TEXT,
  "body" TEXT,
  "ctaText" TEXT,
  "config" JSONB,
  CONSTRAINT "FunnelStep_pkey" PRIMARY KEY ("id")
);

-- Create FunnelSubmission table if it doesn't exist
CREATE TABLE IF NOT EXISTS "FunnelSubmission" (
  "id" TEXT NOT NULL,
  "funnelId" TEXT NOT NULL,
  "stepId" TEXT,
  "contactId" TEXT,
  "data" JSONB,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FunnelSubmission_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys if not exist
DO $$ BEGIN
  ALTER TABLE "Funnel" ADD CONSTRAINT "Funnel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FunnelStep" ADD CONSTRAINT "FunnelStep_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FunnelSubmission" ADD CONSTRAINT "FunnelSubmission_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FunnelSubmission" ADD CONSTRAINT "FunnelSubmission_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FunnelStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add indexes
CREATE INDEX IF NOT EXISTS "Funnel_clientId_status_idx" ON "Funnel"("clientId", "status");
CREATE INDEX IF NOT EXISTS "FunnelStep_funnelId_order_idx" ON "FunnelStep"("funnelId", "order");
CREATE INDEX IF NOT EXISTS "FunnelSubmission_funnelId_createdAt_idx" ON "FunnelSubmission"("funnelId", "createdAt");
CREATE INDEX IF NOT EXISTS "FunnelSubmission_stepId_idx" ON "FunnelSubmission"("stepId");
