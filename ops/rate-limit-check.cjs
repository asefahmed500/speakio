/* Standalone rate-limit check: fresh throttle window, bounded burst. */
const BASE = process.env.API_URL || 'http://127.0.0.1:4040';
(async () => {
  const counts = {};
  let first429 = null;
  for (let i = 0; i < 140; i++) {
    try {
      const r = await fetch(BASE + '/auth/me', { signal: AbortSignal.timeout(15000) });
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.status === 429) {
        first429 = await r.text();
        break;
      }
    } catch (e) {
      counts.error = (counts.error || 0) + 1;
      console.log('request error after', i, e.message);
      break;
    }
  }
  console.log('status counts:', JSON.stringify(counts));
  console.log('429 body:', first429);
  const safe = first429 && !/Prisma|node_modules|DATABASE_URL|at Object\./.test(first429);
  console.log(safe ? 'PASS: rate limit enforced with safe error body' : 'FAIL: no safe 429 observed');
  process.exit(safe ? 0 : 1);
})();
