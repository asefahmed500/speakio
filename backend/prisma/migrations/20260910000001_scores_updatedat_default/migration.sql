-- Align scores."updatedAt" with the Prisma datamodel: the client always sets
-- @updatedAt explicitly, so the DB-level default added in 20260909000000 is
-- unnecessary drift.
ALTER TABLE "scores" ALTER COLUMN "updatedAt" DROP DEFAULT;
