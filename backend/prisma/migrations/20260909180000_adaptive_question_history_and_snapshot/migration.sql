-- Adaptive assessment: per-user question history + per-attempt question snapshot.
-- Additive only; no existing columns or rows are modified.

CREATE TABLE IF NOT EXISTS "user_question_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_question_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_question_history_userId_questionId_key"
    ON "user_question_history"("userId", "questionId");
CREATE INDEX IF NOT EXISTS "user_question_history_userId_shownAt_idx"
    ON "user_question_history"("userId", "shownAt" DESC);

ALTER TABLE "user_question_history"
    ADD CONSTRAINT "user_question_history_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attempts" ADD COLUMN IF NOT EXISTS "questionIdsJson" JSONB;
