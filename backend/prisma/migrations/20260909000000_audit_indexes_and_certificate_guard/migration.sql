-- Performance indexes for hot student paths (Prisma does not auto-index FKs)
CREATE INDEX IF NOT EXISTS "questions_testSetId_orderIndex_idx" ON "questions"("testSetId", "orderIndex");
CREATE INDEX IF NOT EXISTS "attempts_userId_startedAt_idx" ON "attempts"("userId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "attempts_userId_testSetId_status_idx" ON "attempts"("userId", "testSetId", "status");
CREATE INDEX IF NOT EXISTS "agent_runs_attemptId_idx" ON "agent_runs"("attemptId");
CREATE INDEX IF NOT EXISTS "agent_runs_status_idx" ON "agent_runs"("status");
CREATE INDEX IF NOT EXISTS "review_queue_items_status_idx" ON "review_queue_items"("status");

-- Score freshness: rescores update rows in place; keep a visible updated marker
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Enforcement of "at most one ACTIVE certificate per user" at the database
-- level (the application serializes issuance with an advisory lock; this is
-- the backstop that makes duplicates impossible even under direct DB access).
CREATE UNIQUE INDEX IF NOT EXISTS "certificates_userId_active_key" ON "certificates"("userId") WHERE "status" = 'ACTIVE';
