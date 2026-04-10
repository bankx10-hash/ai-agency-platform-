-- Create UsageType enum if it doesn't exist
DO $$ BEGIN
  CREATE TYPE "UsageType" AS ENUM ('VOICE_MINUTES', 'AI_ACTIONS', 'SMS', 'EMAILS', 'SOCIAL_POSTS', 'APOLLO_PROSPECTS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create UsageRecord table
CREATE TABLE IF NOT EXISTS "UsageRecord" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "usageType" "UsageType" NOT NULL,
  "quantity" DECIMAL(10,2) NOT NULL,
  "billingPeriodStart" TIMESTAMP(3) NOT NULL,
  "sourceId" TEXT,
  "sourceType" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsageRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS "UsageRecord_sourceId_sourceType_usageType_key" ON "UsageRecord"("sourceId", "sourceType", "usageType");
CREATE INDEX IF NOT EXISTS "UsageRecord_clientId_usageType_billingPeriodStart_idx" ON "UsageRecord"("clientId", "usageType", "billingPeriodStart");
CREATE INDEX IF NOT EXISTS "UsageRecord_clientId_billingPeriodStart_idx" ON "UsageRecord"("clientId", "billingPeriodStart");
