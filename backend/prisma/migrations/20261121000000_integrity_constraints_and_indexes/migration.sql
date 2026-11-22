-- Additive data-integrity constraints and indexes.
-- Data was verified clean on 2026-11-21 (no status/band/revocation violations).
-- All constraints are CHECK/IF NOT EXISTS — no destructive DML, no table rewrites.

-- 1. Enforce the fixed string enums the application already assumes.
ALTER TABLE "users" ADD CONSTRAINT "users_status_check"
  CHECK (status IN ('ACTIVE', 'SUSPENDED'));

ALTER TABLE "scores" ADD CONSTRAINT "scores_bandScore_check"
  CHECK ("bandScore" >= 0 AND "bandScore" <= 9);

ALTER TABLE "certificates" ADD CONSTRAINT "certificates_overallBand_check"
  CHECK ("overallBand" >= 0 AND "overallBand" <= 9);

ALTER TABLE "review_queue_items" ADD CONSTRAINT "review_queue_items_status_check"
  CHECK (status IN ('PENDING', 'AI_APPROVED', 'AI_ESCALATED', 'APPROVED', 'OVERRIDDEN'));

-- A REVOKED certificate must carry a revocation timestamp; an ACTIVE one must not.
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_status_revokedAt_check"
  CHECK (
    (status = 'REVOKED' AND "revokedAt" IS NOT NULL) OR
    (status = 'ACTIVE' AND "revokedAt" IS NULL)
  );

-- 2. Indexes for query patterns actually used in code.
CREATE INDEX IF NOT EXISTS "questions_questionType_idx" ON "questions"("questionType");
CREATE INDEX IF NOT EXISTS "scores_skill_createdAt_idx" ON "scores"(skill, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "review_queue_items_status_createdAt_idx"
  ON "review_queue_items"(status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "users_status_idx" ON "users"(status);
CREATE INDEX IF NOT EXISTS "users_role_createdAt_idx" ON "users"(role, "createdAt" DESC);
