/* Read-only production-safe data integrity audit. Run: node ops/db-integrity-check.cjs */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const p = new PrismaClient();

/**
 * The managed Postgres occasionally drops connections (P1001). A read-only
 * audit must not report a false failure because of a transient blip — retry
 * individual queries with backoff, but never retry a genuine integrity result.
 */
async function query(sql, attempts = 8) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await p.$queryRawUnsafe(sql);
    } catch (error) {
      const msg = String(error?.message ?? error);
      const transient = /P1001|Can't reach database|connection|timeout|ECONN/i.test(msg);
      if (!transient || i === attempts) throw error;
      console.log(`  (transient DB error — retry ${i}/${attempts})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

(async () => {
  const issues = [];
  const check = async (name, sql) => {
    const n = await query(sql).then((r) => r[0].n);
    console.log(`${n === 0 ? 'PASS' : 'FAIL'}  ${name}: ${n}`);
    if (n !== 0) issues.push(`${name}=${n}`);
  };
  // These two partial unique indexes are hand-written in SQL migrations and
  // CANNOT be expressed in schema.prisma. `prisma migrate dev` may try to drop
  // them as drift — a missing index silently reopens check-then-act races in
  // AttemptsService.start() and CertificatesService.issue().
  const indexCheck = async (name, indexName) => {
    const n = await query(
      `SELECT COUNT(*)::int n FROM pg_indexes WHERE indexname = '${indexName}'`
    ).then((r) => r[0].n);
    console.log(`${n === 1 ? 'PASS' : 'FAIL'}  ${name}: ${n === 1 ? 'present' : 'MISSING'}`);
    if (n !== 1) issues.push(`${name}=MISSING`);
  };
  await indexCheck('partial index: one IN_PROGRESS attempt', 'attempts_userId_testSetId_active_key');
  await indexCheck('partial index: one ACTIVE certificate', 'certificates_userId_active_key');

  await check('duplicate user emails', `SELECT COUNT(*)::int n FROM (SELECT email FROM users GROUP BY email HAVING COUNT(*)>1) t`);
  await check('orphan scores', `SELECT COUNT(*)::int n FROM scores s LEFT JOIN attempts a ON a.id=s."attemptId" WHERE a.id IS NULL`);
  await check('orphan attempts', `SELECT COUNT(*)::int n FROM attempts a LEFT JOIN users u ON u.id=a."userId" WHERE u.id IS NULL`);
  await check('orphan questions', `SELECT COUNT(*)::int n FROM questions q LEFT JOIN test_sets t ON t.id=q."testSetId" WHERE t.id IS NULL`);
  await check('multiple ACTIVE certificates', `SELECT COUNT(*)::int n FROM (SELECT "userId" FROM certificates WHERE status='ACTIVE' GROUP BY "userId" HAVING COUNT(*)>1) t`);
  await check('invalid roles', `SELECT COUNT(*)::int n FROM users WHERE role NOT IN ('USER','ADMIN')`);
  await check('invalid statuses', `SELECT COUNT(*)::int n FROM users WHERE status NOT IN ('ACTIVE','SUSPENDED')`);
  await check('out-of-range bands', `SELECT COUNT(*)::int n FROM scores WHERE "bandScore"<0 OR "bandScore">9`);
  await check('duplicate attempt+skill scores', `SELECT COUNT(*)::int n FROM (SELECT "attemptId",skill FROM scores GROUP BY "attemptId",skill HAVING COUNT(*)>1) t`);
  await check('submitted without timestamp', `SELECT COUNT(*)::int n FROM attempts WHERE status<>'IN_PROGRESS' AND "submittedAt" IS NULL`);
  await check('stale RUNNING agent runs >30min', `SELECT COUNT(*)::int n FROM agent_runs WHERE status='RUNNING' AND "createdAt"<NOW()-INTERVAL '30 minutes'`);
  await check('stale SCORING attempts >30min', `SELECT COUNT(*)::int n FROM attempts WHERE status='SCORING' AND "startedAt"<NOW()-INTERVAL '30 minutes'`);
  await check('expired unrevoked refresh tokens', `SELECT COUNT(*)::int n FROM refresh_tokens WHERE "expiresAt"<NOW() AND "revokedAt" IS NULL`);
  console.log(issues.length ? `\nINTEGRITY ISSUES: ${issues.join(', ')}` : '\nINTEGRITY: all checks clean');
  await p.$disconnect();
  process.exit(issues.length ? 1 : 0);
})();
