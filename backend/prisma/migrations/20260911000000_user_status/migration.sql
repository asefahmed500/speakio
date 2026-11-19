-- Account lifecycle: suspension support for role-based administration.
-- Additive only: every existing account defaults to ACTIVE.
ALTER TABLE "users" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
