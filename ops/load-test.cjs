/* Load / concurrency verification against the live backend.
 * Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... node ops/load-test.cjs
 * Measures latency percentiles, error rates, rate-limit behavior, and
 * concurrent-write correctness. All requests are real; no mocks.
 */
const BASE = process.env.API_URL || 'http://127.0.0.1:4040';
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD'); process.exit(2);
}

const samples = [];
const record = (label, ms, status) => samples.push({ label, ms, status });

async function raw(path, opts = {}) {
  const t0 = performance.now();
  const headers = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + path, {
      method: opts.method || 'GET', headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    record(opts.label || path, performance.now() - t0, res.status);
    return { s: res.status, t: text, h: res.headers };
  } catch (e) {
    record(opts.label || path, performance.now() - t0, 0);
    return { s: 0, t: String(e.message), h: new Headers() };
  }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return Math.round(a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]);
}
function report(label) {
  const set = samples.filter(s => s.label === label);
  const ms = set.map(s => s.ms);
  const statuses = {};
  for (const s of set) statuses[s.status] = (statuses[s.status] || 0) + 1;
  console.log(`${label.padEnd(26)} n=${String(set.length).padStart(3)}  p50=${pct(ms,50)}ms p95=${pct(ms,95)}ms p99=${pct(ms,99)}ms  ${JSON.stringify(statuses)}`);
  return set;
}

(async () => {
  console.log('=== LOAD TEST START ===');

  // 1. Warm-up — wait for the managed DB to actually be healthy before
  // measuring. /health returns HTTP 200 with `status: degraded` when the DB is
  // unreachable, so a status-code check alone would start a doomed run.
  let healthy = false;
  for (let i = 0; i < 30 && !healthy; i++) {
    const r = await raw('/health', { label: 'warmup' });
    try { healthy = JSON.parse(r.t).status === 'ok'; } catch { /* keep waiting */ }
    if (!healthy) await new Promise(r => setTimeout(r, 2000));
  }
  if (!healthy) { console.error('Backend database never became healthy — aborting'); process.exit(1); }
  console.log('warmup done (db healthy)');

  // 2. Burst concurrency on a read-only public endpoint
  const burst = Array.from({ length: 40 }, () => raw('/health', { label: 'public-burst' }));
  const burstResults = await Promise.all(burst);
  report('public-burst');
  const burstOk = burstResults.filter(r => r.s === 200).length;

  // 3. Build an admin session
  const cookies = new Map();
  const capture = h => { for (const s of (h.getSetCookie ? h.getSetCookie() : [])) { const [p] = s.split(';'); const i = p.indexOf('='); if (i > 0) cookies.set(p.slice(0, i), p.slice(i + 1)); } };
  const hdr = () => ({ cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') });
  const auth = async (path, opts = {}) => {
    const r = await raw(path, { ...opts, headers: { ...hdr(), ...(opts.headers || {}) } });
    capture(r.h);
    return r;
  };
  // The managed DB occasionally refuses a connection mid-handshake (P1001),
  // surfacing as a transient 500. Retry ONLY that case (and network errors);
  // a 401 is a real credential failure and must not be retried.
  let login;
  for (let i = 0; i < 6; i++) {
    login = await auth('/auth/login', { method: 'POST', label: 'login', body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    if (login.s === 200 || login.s === 401) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('login', login.s);

  // 4. Concurrent authenticated reads (dashboard stats is a heavier aggregation)
  const reads = Array.from({ length: 20 }, () => auth('/dashboard/stats', { label: 'auth-concurrent-reads' }));
  await Promise.all(reads);
  report('auth-concurrent-reads');

  // 5. Sustained paced load — 60 requests over ~12s (5 req/s)
  for (let i = 0; i < 60; i++) {
    await auth('/tests', { label: 'sustained-reads' });
    await new Promise(r => setTimeout(r, 200));
  }
  report('sustained-reads');

  // 6. Concurrent refresh with the SAME token — single-flight / family safety
  const refreshToken = cookies.get('refresh_token');
  if (refreshToken) {
    const refreshBurst = Array.from({ length: 8 }, () =>
      raw('/auth/refresh', { method: 'POST', label: 'refresh-burst', headers: { cookie: `refresh_token=${refreshToken}` } })
    );
    await Promise.all(refreshBurst);
    report('refresh-burst');
  }

  // 7. Concurrent writes — 6 simultaneous attempt starts for one user
  const starts = Array.from({ length: 6 }, () =>
    auth('/attempts', { method: 'POST', label: 'concurrent-writes', body: { testSetId: 'reading-passage-urban-green' } })
  );
  const startResults = await Promise.all(starts);
  report('concurrent-writes');
  const codes = startResults.map(r => r.s);
  console.log('attempt-start statuses:', JSON.stringify(codes.reduce((a, c) => (a[c] = (a[c] || 0) + 1, a), {})));

  // 8. Rate-limit verification (deliberately exhaust the burst limit)
  let first429 = null, before429 = 0;
  for (let i = 0; i < 140; i++) {
    const r = await raw('/auth/me', { label: 'rate-limit-probe', headers: hdr() });
    if (r.s === 429) { first429 = i + 1; break; }
    if (r.s === 200 || r.s === 401) before429++;
  }
  report('rate-limit-probe');
  console.log(`first 429 at request #${first429 ?? 'not reached'} (after ${before429} accepted)`);

  // Summary
  const all = samples;
  const errors = all.filter(s => s.status === 0 || s.status >= 500).length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`total requests: ${all.length}`);
  console.log(`network/server errors: ${errors}`);
  console.log(`overall p50=${pct(all.map(s=>s.ms),50)}ms p95=${pct(all.map(s=>s.ms),95)}ms p99=${pct(all.map(s=>s.ms),99)}ms`);
  const pass = errors === 0 && burstOk >= 38 && first429 !== null && first429 <= 140;
  console.log(pass ? 'LOAD TEST: PASS' : 'LOAD TEST: FAIL');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
