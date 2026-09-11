-- Auth hardening + integrity backstops:
-- 1. refresh_tokens table (rotating refresh tokens, family-based revocation).
-- 2. Partial unique index: only one IN_PROGRESS attempt per (user, test set) —
--    closes the check-then-act race in attemptsService.start().
-- 3. Missing secondary indexes (certificates.userId, agent_steps.agentRunId).
-- 4. Hard FK user_question_history.questionId -> questions.id (cascade) —
--    orphaned history rows are removed first so the FK can be created.

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_tokenHash_key"
    ON "refresh_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "refresh_tokens_userId_idx"
    ON "refresh_tokens"("userId");
CREATE INDEX IF NOT EXISTS "refresh_tokens_familyId_idx"
    ON "refresh_tokens"("familyId");

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One live attempt per user per test set; completed/revoked attempts exempt.
CREATE UNIQUE INDEX IF NOT EXISTS "attempts_userId_testSetId_active_key"
    ON "attempts"("userId", "testSetId")
    WHERE "status" = 'IN_PROGRESS';

CREATE INDEX IF NOT EXISTS "certificates_userId_idx"
    ON "certificates"("userId");
CREATE INDEX IF NOT EXISTS "agent_steps_agentRunId_idx"
    ON "agent_steps"("agentRunId");

DELETE FROM "user_question_history"
WHERE "questionId" NOT IN (SELECT "id" FROM "questions");

ALTER TABLE "user_question_history" ADD CONSTRAINT "user_question_history_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
