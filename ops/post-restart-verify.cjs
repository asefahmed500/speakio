/* Consolidated post-restart failure verification. Real API + real DB, no mocks.
 *
 * Usage:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node ops/post-restart-verify.cjs
 *
 * Requires the backend on :4040 (override with API_URL). Creates only
 * uniquely-named @speakio.test fixtures; never deletes or resets data.
 * Credentials are read from the environment — never embedded in source.
 */
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set');
  process.exit(2);
}
const BASE = process.env.API_URL || 'http://127.0.0.1:4040';

function jar() {
  const c = new Map();
  return {
    set(h) { for (const s of (h.getSetCookie ? h.getSetCookie() : [])) { const [p] = s.split(';'); const i = p.indexOf('='); if (i > 0) c.set(p.slice(0, i), p.slice(i + 1)); } },
    header() { return [...c.entries()].map(([k, v]) => `${k}=${v}`).join('; '); },
    get(n) { return c.get(n); },
  };
}
async function req(path, { method = 'GET', body, j, headers, timeout = 30000 } = {}) {
  const h = { ...(headers || {}) };
  if (j) h.cookie = j.header();
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(BASE + path, {
    method, headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (j) j.set(r.headers);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, text };
}

const results = [];
async function t(name, fn) {
  try { const detail = await fn(); results.push(true); console.log('PASS  ' + name + (detail ? ' :: ' + detail : '')); }
  catch (e) { results.push(false); console.log('FAIL  ' + name + ' :: ' + e.message); }
}
const ex = (c, m) => { if (!c) throw new Error(m); };
const st = (r, s) => ex(r.status === s, `expected ${s}, got ${r.status} :: ${String(r.text).slice(0, 180)}`);
const noLeak = (r) => {
  for (const bad of ['DATABASE_URL', 'postgres://', 'JWT_SECRET', 'cfoat_', 'PrismaClientKnownRequestError', 'at Object.', 'node_modules']) {
    ex(!String(r.text).includes(bad), `leaked ${bad}`);
  }
};

(async () => {
  const tag = Date.now().toString(36);
  const emailA = `POSTR-a-${tag}@speakio.test`, emailB = `POSTR-b-${tag}@speakio.test`;
  const pw = 'PostRestartPass123!';
  const a = jar(), b = jar(), admin = jar();
  let attemptId, setId;

  await t('health: db up', async () => { const r = await req('/health'); st(r, 200); ex(r.data.database === 'up', 'db not up'); });

  // --- auth validation & security ---
  await t('register: invalid input rejected', async () => {
    st(await req('/auth/register', { method: 'POST', body: { email: 'bad' } }), 400);
    st(await req('/auth/register', { method: 'POST', body: { email: `x-${tag}@s.io`, password: 'short', name: 'X' } }), 400);
  });
  await t('register: success, no passwordHash leaked', async () => {
    const r = await req('/auth/register', { method: 'POST', body: { email: emailA, password: pw, name: 'Post Restart A', targetBand: 7 }, j: a });
    st(r, 201); ex(a.get('access_token') && a.get('refresh_token'), 'no cookies');
    ex(!('passwordHash' in r.data), 'passwordHash leaked'); noLeak(r);
  });
  await t('register: duplicate -> 409', async () => {
    st(await req('/auth/register', { method: 'POST', body: { email: emailA, password: pw, name: 'Duplicate' } }), 409);
  });
  await t('login: wrong password -> 401, missing -> 400', async () => {
    st(await req('/auth/login', { method: 'POST', body: { email: emailA, password: 'Wrong123!' } }), 401);
    st(await req('/auth/login', { method: 'POST', body: { email: emailA } }), 400);
  });
  await t('me: no cookie -> 401, tampered token -> 401', async () => {
    st(await req('/auth/me'), 401);
    const tok = a.get('access_token'), parts = tok.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'x', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    st(await req('/auth/me', { headers: { cookie: `access_token=${parts.join('.')}` } }), 401);
  });
  await t('setup: second user + admin login', async () => {
    st(await req('/auth/register', { method: 'POST', body: { email: emailB, password: pw, name: 'Post Restart B' }, j: b }), 201);
    const r = await req('/auth/login', { method: 'POST', body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }, j: admin });
    st(r, 200); ex(r.data.role === 'ADMIN', 'not admin');
  });

  // --- RBAC / IDOR ---
  await t('RBAC: USER blocked from 7 admin endpoints', async () => {
    const endpoints = [['GET','/users'],['GET','/users/stats'],['GET','/admin/students'],['GET','/scoring/runs'],['GET','/scoring/review-queue'],['GET','/tests/manage'],['POST','/tests/generate']];
    const bad = [];
    for (const [m, p] of endpoints) {
      const r = await req(p, { method: m, j: a, body: m === 'POST' ? { skill: 'READING', count: 1 } : undefined });
      if (r.status !== 403) bad.push(`${m} ${p} -> ${r.status}`);
    }
    ex(!bad.length, bad.join('; ')); return `${endpoints.length} checked`;
  });
  await t('IDOR: cross-user attempt denied on all verbs', async () => {
    const s = await req('/attempts', { method: 'POST', j: a, body: { testSetId: 'reading-passage-urban-green' } }); st(s, 201); attemptId = s.data.id;
    for (const [m, p, body] of [
      ['GET', `/attempts/${attemptId}`, undefined],
      ['PATCH', `/attempts/${attemptId}`, { answers: { q: 'x' } }],
      ['POST', `/attempts/${attemptId}/submit`, { answers: {} }],
      ['POST', `/attempts/${attemptId}/rescore`, undefined],
    ]) st(await req(p, { method: m, j: b, body }), 403);
  });

  // --- validation boundaries ---
  await t('attempt/answer validation', async () => {
    st(await req('/attempts', { method: 'POST', j: a, body: {} }), 400);
    st(await req('/attempts', { method: 'POST', j: a, body: { testSetId: 'nope' } }), 404);
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: a, body: { answers: { q: 5 } } }), 400);
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: a, body: { answers: {}, timeRemainingSeconds: -3 } }), 400);
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: a, body: { answers: { q: 'x'.repeat(250000) } } }), 400);
  });
  await t('profile validation: date + enums + band', async () => {
    st(await req('/users/me', { method: 'PATCH', j: a, body: { examDate: '2026-12-15' } }), 400);
    st(await req('/users/me', { method: 'PATCH', j: a, body: { weakestSkill: 'NOPE' } }), 400);
    st(await req('/users/me', { method: 'PATCH', j: a, body: { targetBand: 12 } }), 400);
    st(await req('/users/me', { method: 'PATCH', j: a, body: { examDate: '2026-12-15T00:00:00.000Z' } }), 200);
  });

  // --- idempotency / state machine ---
  await t('submit: double -> 201 then 409', async () => {
    st(await req(`/attempts/${attemptId}/submit`, { method: 'POST', j: a, body: { answers: { q: 'a' } } }), 201);
    st(await req(`/attempts/${attemptId}/submit`, { method: 'POST', j: a, body: { answers: { q: 'b' } } }), 409);
  });
  await t('submit: concurrent -> exactly one 201', async () => {
    const s = await req('/attempts', { method: 'POST', j: a, body: { testSetId: 'reading-passage-urban-green' } }); st(s, 201);
    const [x, y] = await Promise.all([
      req(`/attempts/${s.data.id}/submit`, { method: 'POST', j: a, body: { answers: { q: 'one' } } }),
      req(`/attempts/${s.data.id}/submit`, { method: 'POST', j: a, body: { answers: { q: 'two' } } }),
    ]);
    const codes = [x.status, y.status].sort(); ex(codes[0] === 201 && codes[1] === 409, `got ${codes}`);
  });
  await t('state: autosave after submit -> 409', async () => {
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: a, body: { answers: { q: 'late' } } }), 409);
  });
  await t('state: short essay/speaking -> 400 + rollback IN_PROGRESS', async () => {
    for (const set of ['cambridge-18-test-1', 'speaking-part2-cuecard']) {
      const s = await req('/attempts', { method: 'POST', j: b, body: { testSetId: set } }); st(s, 201);
      st(await req(`/attempts/${s.data.id}/submit`, { method: 'POST', j: b, body: { answers: {} } }), 400);
      const after = await req(`/attempts/${s.data.id}`, { j: b });
      ex(after.data.status === 'IN_PROGRESS', `${set}: ${after.data.status}`);
    }
  });

  // --- refresh / logout ---
  await t('refresh: replay -> 401 + family revoked', async () => {
    const j = jar(); st(await req('/auth/login', { method: 'POST', body: { email: emailB, password: pw }, j }), 200);
    const old = j.get('refresh_token');
    st(await req('/auth/refresh', { method: 'POST', j }), 200);
    st(await req('/auth/refresh', { method: 'POST', headers: { cookie: `refresh_token=${old}` } }), 401);
    st(await req('/auth/refresh', { method: 'POST', j }), 401);
  });
  await t('logout -> me 401', async () => {
    st(await req('/auth/logout', { method: 'POST', j: a }), 200);
    st(await req('/auth/me', { j: a }), 401);
  });

  // --- admin flows ---
  await t('admin: invalid enums -> 400', async () => {
    st(await req('/users?role=ROOT', { j: admin }), 400);
    st(await req('/users/00000000-0000-0000-0000-000000000000/role', { method: 'PATCH', j: admin, body: { role: 'ROOT' } }), 400);
  });
  await t('admin: content validation + safe delete', async () => {
    st(await req('/tests', { method: 'POST', j: admin, body: { title: 'x', skill: 'READING', timeLimitMinutes: 20 } }), 400);
    st(await req('/tests', { method: 'POST', j: admin, body: { title: 'PostRestart Set ' + tag, skill: 'FULL_MOCK', timeLimitMinutes: 20 } }), 400);
    const s = await req('/tests', { method: 'POST', j: admin, body: { title: 'PostRestart Set ' + tag, skill: 'READING', timeLimitMinutes: 20 } }); st(s, 201); setId = s.data.id;
    st(await req(`/tests/${setId}/questions`, { method: 'POST', j: admin, body: { questionType: 'MCQ', prompt: 'Q?', options: ['a','b'], correctAnswer: 'a' } }), 400);
    st(await req(`/tests/${setId}`, { method: 'DELETE', j: admin }), 200);
    st(await req('/tests/reading-passage-urban-green', { method: 'DELETE', j: admin }), 409);
  });
  await t('admin: agent retry/override guards', async () => {
    st(await req('/scoring/runs/00000000-0000-0000-0000-000000000000/retry', { method: 'POST', j: admin }), 404);
    const runs = await req('/scoring/runs', { j: admin }); st(runs, 200);
    const done = runs.data.find(r => r.status === 'COMPLETED');
    if (done) st(await req(`/scoring/runs/${done.id}/retry`, { method: 'POST', j: admin }), 409);
    const q = await req('/scoring/review-queue', { j: admin }); st(q, 200);
    if (q.data.length) st(await req(`/scoring/review-queue/${q.data[0].id}/override`, { method: 'POST', j: admin, body: { finalBand: 7.3 } }), 400);
  });

  // --- certs / errors / rate limit ---
  await t('cert: issue w/o eligibility -> 400; verify unknown -> safe', async () => {
    st(await req('/certificates', { method: 'POST', j: b }), 400);
    const r = await req('/certificates/verify/NO-SUCH-CODE-' + tag);
    ex([200,404].includes(r.status), `verify ${r.status}`); noLeak(r);
  });
  await t('errors: no internals leaked', async () => {
    for (const r of [
      await req('/attempts/not-a-uuid', { j: b }),
      await req('/users/stats', { j: b }),
      await req('/auth/login', { method: 'POST', body: { email: emailB, password: '' } }),
    ]) noLeak(r);
  });
  await t('rate-limit: 429 after burst', async () => {
    let hit = false;
    for (let i = 0; i < 135; i++) { const r = await req('/auth/me'); if (r.status === 429) { hit = true; noLeak(r); break; } }
    ex(hit, 'no 429');
  });

  const passed = results.filter(Boolean).length;
  console.log(`\n===== POST-RESTART SUMMARY: ${passed}/${results.length} passed =====`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
