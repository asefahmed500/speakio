-- Additive index only: no data is read or modified.
-- Content-management paths (TestsService.getForAdmin / deleteSet /
-- deleteQuestion) count attempts by testSetId. The existing
-- (userId, testSetId, status) and partial (userId, testSetId) indexes are
-- leading-userId, so they cannot serve a testSetId-only predicate.
CREATE INDEX IF NOT EXISTS "attempts_testSetId_idx" ON "attempts"("testSetId");
