-- Listing performance: skill hub pages filter TestSet by skill (newest first),
-- and the Agent Ops dashboard lists runs by status + recency.
CREATE INDEX IF NOT EXISTS "test_sets_skill_createdAt_idx" ON "test_sets"("skill", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "agent_runs_status_createdAt_idx" ON "agent_runs"("status", "createdAt" DESC);
