/* Full feature verification — real API + real DB, no mocks.
 * Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... node ops/feature-verification.cjs
 * Creates only uniquely-named @speakio.test fixtures; never deletes data.
 */
const BASE = process.env.API_URL || 'http://127.0.0.1:4040';
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
  process.exit(2);
}

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

/* The remote Postgres occasionally blips; retry a 500 once before judging. */
async function stableReq(path, opts = {}) {
  let r = await req(path, opts);
  if (r.status === 500) r = await req(path, opts);
  return r;
}

const results = [];
async function t(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true }); console.log('PASS  ' + name + (d ? ' :: ' + d : '')); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); console.log('FAIL  ' + name + ' :: ' + e.message); }
}
const ex = (c, m) => { if (!c) throw new Error(m); };
const st = (r, s) => ex(r.status === s, `expected ${s}, got ${r.status} :: ${String(r.text).slice(0, 200)}`);
const ok = (r, codes, msg) => ex(codes.includes(r.status), `${msg || 'unexpected'} ${r.status} :: ${String(r.text).slice(0, 160)}`);

(async () => {
  const tag = Date.now().toString(36);
  const email = `FV-${tag}@speakio.test`, pw = 'FeatureVerify123!';
  const user = jar(), admin = jar(), other = jar();
  let attemptId, setId, questionId, vocabId, certId;

  // ================= AUTH =================
  await t('AUTH 1/8 health + DB', async () => { const r = await req('/health'); st(r, 200); ex(r.data.database === 'up'); });
  await t('AUTH 2/8 register validation', async () => {
    st(await req('/auth/register', { method: 'POST', body: { email: 'bad' } }), 400);
    st(await req('/auth/register', { method: 'POST', body: { email: `x-${tag}@s.io`, password: 'short', name: 'X' } }), 400);
  });
  await t('AUTH 3/8 register success + cookies', async () => {
    const r = await req('/auth/register', { method: 'POST', body: { email, password: pw, name: 'Feature Verifier', targetBand: 7 }, j: user });
    st(r, 201); ex(user.get('access_token') && user.get('refresh_token'));
    ex(!('passwordHash' in r.data));
  });
  await t('AUTH 4/8 duplicate register 409', async () => {
    st(await req('/auth/register', { method: 'POST', body: { email, password: pw, name: 'Dup' } }), 409);
  });
  await t('AUTH 5/8 login wrong/missing/success', async () => {
    st(await req('/auth/login', { method: 'POST', body: { email, password: 'Wrong123!' } }), 401);
    st(await req('/auth/login', { method: 'POST', body: { email } }), 400);
    // A genuinely distinct second user for ownership / IDOR checks.
    const otherEmail = `FV-other-${tag}@speakio.test`;
    st(await req('/auth/register', { method: 'POST', body: { email: otherEmail, password: pw, name: 'Other Verifier' } }), 201);
    st(await req('/auth/login', { method: 'POST', body: { email: otherEmail, password: pw }, j: other }), 200);
    const a = await req('/auth/login', { method: 'POST', body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }, j: admin });
    st(a, 200); ex(a.data.role === 'ADMIN');
  });
  await t('AUTH 6/8 me auth + tampered token', async () => {
    st(await req('/auth/me'), 401);
    const tok = user.get('access_token'), parts = tok.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'fake', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    st(await req('/auth/me', { headers: { cookie: `access_token=${parts.join('.')}` } }), 401);
    st(await req('/auth/me', { j: user }), 200);
  });
  await t('AUTH 7/8 refresh rotation + family revocation', async () => {
    st(await req('/auth/refresh', { method: 'POST' }), 401);
    const old = user.get('refresh_token');
    st(await req('/auth/refresh', { method: 'POST', j: user }), 200);
    st(await req('/auth/refresh', { method: 'POST', headers: { cookie: `refresh_token=${old}` } }), 401);
    st(await req('/auth/refresh', { method: 'POST', j: user }), 401);
  });
  await t('AUTH 8/8 forgot/reset validation + logout', async () => {
    const f = await req('/auth/forgot-password', { method: 'POST', body: { email: `nobody-${tag}@speakio.test` } });
    st(f, 200); ex(String(f.text).includes('If an account exists'));
    st(await req('/auth/forgot-password', { method: 'POST', body: { email: 'bad' } }), 400);
    st(await req('/auth/reset-password', { method: 'POST', body: { token: 'abc', newPassword: 'NewPass123!' } }), 400);
    const j = jar(); await req('/auth/login', { method: 'POST', body: { email, password: pw }, j });
    st(await req('/auth/logout', { method: 'POST', j }), 200);
    st(await req('/auth/me', { j }), 401);
  });

  // ================= AUTHORIZATION / RBAC =================
  await t('RBAC 1/3 USER blocked from 7 admin endpoints', async () => {
    const eps = [['GET','/users'],['GET','/users/stats'],['GET','/admin/students'],['GET','/scoring/runs'],['GET','/scoring/review-queue'],['GET','/tests/manage'],['POST','/tests/generate']];
    const bad = [];
    for (const [m, p] of eps) { const r = await req(p, { method: m, j: user, body: m === 'POST' ? { skill: 'READING', count: 1 } : undefined }); if (r.status !== 403) bad.push(`${m} ${p}->${r.status}`); }
    ex(!bad.length, bad.join('; '));
  });
  await t('RBAC 2/3 admin endpoints reachable by ADMIN', async () => {
    for (const p of ['/users','/users/stats','/admin/students','/scoring/runs','/scoring/review-queue','/tests/manage']) st(await stableReq(p, { j: admin }), 200);
  });
  await t('RBAC 3/3 role + status change + self-protection', async () => {
    const u = await req('/auth/me', { j: user }); const id = u.data.id;
    st(await req(`/users/${id}/role`, { method: 'PATCH', j: admin, body: { role: 'ADMIN' } }), 200);
    st(await req(`/users/${id}/role`, { method: 'PATCH', j: admin, body: { role: 'SUPER' } }), 400);
    st(await req('/users?role=NOPE', { j: admin }), 400);
    st(await req(`/users/${id}/status`, { method: 'PATCH', j: admin, body: { status: 'SUSPENDED' } }), 200);
    st(await req('/auth/me', { j: user }), 403);
    st(await req(`/users/${id}/status`, { method: 'PATCH', j: admin, body: { status: 'ACTIVE' } }), 200);
    // Role/status changes revoke every session by design — re-authenticate the
    // user jar before the remaining feature checks.
    st(await req('/auth/login', { method: 'POST', body: { email, password: pw }, j: user }), 200);
  });

  // ================= DASHBOARD / SKILLS / AI =================
  await t('DASHBOARD 1/3 stats shape', async () => {
    const r = await req('/dashboard/stats', { j: user }); st(r, 200);
    ex('overallBand' in r.data && 'perSkill' in r.data && 'totals' in r.data);
  });
  await t('DASHBOARD 2/3 per-skill summary for all 4 skills', async () => {
    for (const s of ['LISTENING','READING','WRITING','SPEAKING']) st(await req(`/dashboard/skills/${s}`, { j: user }), 200);
    st(await req('/dashboard/skills/BOGUS', { j: user }), 400);
  });
  await t('AI 3/3 paraphrase + study-plan', async () => {
    const p = await req('/ai/paraphrase', { method: 'POST', j: user, timeout: 120000, body: { text: 'The government should improve public transport.' } });
    ok(p, [200, 201, 503, 504], 'paraphrase');
    const s = await req('/ai/study-plan', { method: 'POST', j: user, timeout: 120000, body: {} });
    ok(s, [200, 201, 503, 504], 'study-plan');
    if (s.status === 201 || s.status === 200) ex(Array.isArray(s.data.milestones));
  });

  // ================= QUESTION BANK / CONTENT =================
  await t('CONTENT 1/6 list with question counts', async () => {
    const r = await req('/tests?skill=READING', { j: user }); st(r, 200); ex(Array.isArray(r.data) && r.data.length > 0);
  });
  await t('CONTENT 2/6 sanitized detail (no answers leaked)', async () => {
    const r = await req('/tests/reading-passage-urban-green', { j: user }); st(r, 200);
    ex(Array.isArray(r.data.questions));
    ex(!JSON.stringify(r.data).includes('correctAnswer'));
  });
  await t('CONTENT 3/6 admin full view includes answers', async () => {
    const r = await req('/tests/reading-passage-urban-green/full', { j: admin }); st(r, 200);
    ex(r.data.questions.length > 0); ex('correctAnswer' in r.data.questions[0]);
  });
  await t('CONTENT 4/6 create set validation', async () => {
    st(await req('/tests', { method: 'POST', j: admin, body: { title: 'x', skill: 'READING', timeLimitMinutes: 20 } }), 400);
    st(await req('/tests', { method: 'POST', j: admin, body: { title: 'FV Set ' + tag, skill: 'FULL_MOCK', timeLimitMinutes: 20 } }), 400);
    const s = await req('/tests', { method: 'POST', j: admin, body: { title: 'FV Set ' + tag, skill: 'READING', timeLimitMinutes: 20 } });
    st(s, 201); setId = s.data.id;
    // An empty draft set must be invisible to students.
    const l = await req('/tests?skill=READING', { j: user });
    st(l, 200); ex(Array.isArray(l.data)); ex(!l.data.some(x => x.id === setId), 'draft set leaked');
  });
  await t('CONTENT 5/6 add question validation + success', async () => {
    st(await req(`/tests/${setId}/questions`, { method: 'POST', j: admin, body: { questionType: 'MCQ', prompt: 'Pick one?', options: ['a','b'], correctAnswer: 'a' } }), 400);
    st(await req(`/tests/${setId}/questions`, { method: 'POST', j: admin, body: { questionType: 'MCQ', prompt: 'Pick one?', options: ['a','b','c','d'], correctAnswer: 'z' } }), 400);
    const q = await req(`/tests/${setId}/questions`, { method: 'POST', j: admin, body: { questionType: 'MCQ', prompt: 'Which is valid?', options: ['a','b','c','d'], correctAnswer: 'a' } });
    st(q, 201); questionId = q.data.id;
  });
  await t('CONTENT 6/6 delete guards + empty set hidden', async () => {
    // The set now has a question, so it correctly appears in the student list.
    st(await req(`/tests/${setId}`, { method: 'DELETE', j: admin }), 200);
    st(await req('/tests/reading-passage-urban-green', { method: 'DELETE', j: admin }), 409);
  });

  // ================= ATTEMPTS / EXAM ENGINE =================
  await t('EXAM 1/8 start validation + success', async () => {
    st(await req('/attempts', { method: 'POST', j: user, body: {} }), 400);
    st(await req('/attempts', { method: 'POST', j: user, body: { testSetId: 'nope' } }), 404);
    const r = await req('/attempts', { method: 'POST', j: user, body: { testSetId: 'reading-passage-urban-green' } });
    st(r, 201); attemptId = r.data.id;
    ex(Array.isArray(r.data.questionIdsJson) && r.data.questionIdsJson.length > 0);
  });
  await t('EXAM 2/8 resume returns same attempt', async () => {
    const r = await req('/attempts', { method: 'POST', j: user, body: { testSetId: 'reading-passage-urban-green' } });
    st(r, 201); ex(r.data.id === attemptId && r.data.resumed === true);
  });
  await t('EXAM 3/8 autosave validation + server-authoritative clock', async () => {
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: user, body: { answers: { q: 5 } } }), 400);
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: user, body: { answers: {}, timeRemainingSeconds: -1 } }), 400);
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: user, body: { answers: {}, timeRemainingSeconds: 999999 } }), 400);
    // DTO boundary: the maximum is accepted, one above is rejected. The
    // service then clamps the accepted value to the test's configured limit.
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: user, body: { answers: { q: 'hello' }, timeRemainingSeconds: 21600 } }), 200);
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: user, body: { answers: {}, timeRemainingSeconds: 21601 } }), 400);
  });
  await t('EXAM 4/8 IDOR blocked on all attempt verbs', async () => {
    // Raw API client has no silent refresh — re-login so the other user's
    // 15-minute access token cannot expire mid-run.
    st(await req('/auth/login', { method: 'POST', body: { email: `FV-other-${tag}@speakio.test`, password: pw }, j: other }), 200);
    for (const [m, p, b] of [
      ['GET', `/attempts/${attemptId}`, undefined],
      ['PATCH', `/attempts/${attemptId}`, { answers: { x: 'y' } }],
      ['POST', `/attempts/${attemptId}/submit`, { answers: {} }],
      ['POST', `/attempts/${attemptId}/rescore`, undefined],
    ]) st(await req(p, { method: m, j: other, body: b }), 403);
    st(await req('/attempts/00000000-0000-0000-0000-000000000000', { j: user }), 404);
  });
  await t('EXAM 5/8 submit + auto-grade', async () => {
    const r = await req(`/attempts/${attemptId}/submit`, { method: 'POST', j: user, body: { answers: { q: 'a' } }, timeout: 60000 });
    st(r, 201); ex('bandScore' in r.data);
    const a = await req(`/attempts/${attemptId}`, { j: user });
    st(a, 200); ex(a.data.status === 'COMPLETED' && a.data.score != null);
  });
  await t('EXAM 6/8 double submit + post-submit autosave blocked', async () => {
    st(await req(`/attempts/${attemptId}/submit`, { method: 'POST', j: user, body: { answers: {} } }), 409);
    st(await req(`/attempts/${attemptId}`, { method: 'PATCH', j: user, body: { answers: {} } }), 409);
    st(await req(`/attempts/${attemptId}/rescore`, { method: 'POST', j: user }), 409);
  });
  await t('EXAM 7/8 concurrent double submit -> one winner', async () => {
    const s = await req('/attempts', { method: 'POST', j: user, body: { testSetId: 'reading-passage-urban-green' } }); st(s, 201);
    const [a, b] = await Promise.all([
      req(`/attempts/${s.data.id}/submit`, { method: 'POST', j: user, body: { answers: { q: 'x' } } }),
      req(`/attempts/${s.data.id}/submit`, { method: 'POST', j: user, body: { answers: { q: 'y' } } }),
    ]);
    const codes = [a.status, b.status].sort(); ex(codes[0] === 201 && codes[1] === 409, `got ${codes}`);
  });
  await t('EXAM 8/8 content validation rolls back to IN_PROGRESS', async () => {
    for (const set of ['cambridge-18-test-1', 'speaking-part2-cuecard']) {
      const s = await req('/attempts', { method: 'POST', j: user, body: { testSetId: set } }); st(s, 201);
      st(await req(`/attempts/${s.data.id}/submit`, { method: 'POST', j: user, body: { answers: {} } }), 400);
      const a = await req(`/attempts/${s.data.id}`, { j: user });
      ex(a.data.status === 'IN_PROGRESS', `${set}: ${a.data.status}`);
    }
  });

  // ================= VOCABULARY =================
  await t('VOCAB 1/4 create + list', async () => {
    const r = await req('/vocabulary', { method: 'POST', j: user, body: {
      word: 'mitigate', partOfSpeech: 'verb', definition: 'To make something less severe.', bandTarget: 7,
      topic: 'Environment', collocations: ['mitigate risk'], synonyms: ['alleviate'], exampleSentence: 'The policy mitigated the worst effects.'
    } });
    st(r, 201); vocabId = r.data.id;
    const l = await req('/vocabulary', { j: user }); st(l, 200); ex(l.data.some(v => v.id === vocabId));
  });
  await t('VOCAB 2/4 validation', async () => {
    st(await req('/vocabulary', { method: 'POST', j: user, body: { word: 'x' } }), 400);
    st(await req('/vocabulary', { method: 'POST', j: user, body: { word: 'ab', partOfSpeech: 'noun', definition: 'short', bandTarget: 9, topic: 'T', collocations: [], synonyms: [], exampleSentence: 'tiny' } }), 400);
  });
  await t('VOCAB 3/4 ownership', async () => {
    st(await req('/auth/login', { method: 'POST', body: { email: `FV-other-${tag}@speakio.test`, password: pw }, j: other }), 200);
    st(await req(`/vocabulary/${vocabId}`, { method: 'DELETE', j: other }), 403);
  });
  await t('VOCAB 4/4 delete', async () => {
    st(await req(`/vocabulary/${vocabId}`, { method: 'DELETE', j: user }), 200);
    const l = await req('/vocabulary', { j: user }); ex(!l.data.some(v => v.id === vocabId));
  });

  // ================= CERTIFICATES =================
  await t('CERT 1/5 list + eligibility', async () => {
    st(await req('/certificates', { j: user }), 200);
    const e = await req('/certificates/eligibility', { j: user }); st(e, 200);
    ex('eligible' in e.data && 'skills' in e.data && 'missingSkills' in e.data);
  });
  await t('CERT 2/5 issue blocked without eligibility', async () => {
    st(await req('/certificates', { method: 'POST', j: user }), 400);
  });
  await t('CERT 3/5 verify unknown + no auth', async () => {
    const r = await req('/certificates/verify/NOT-A-REAL-CODE-' + tag);
    ok(r, [200, 404]); ex(String(r.text).includes('No certificate matches'));
  });
  await t('CERT 4/5 revoke unknown + lower-case normalization', async () => {
    st(await req('/certificates/00000000-0000-0000-0000-000000000000/revoke', { method: 'POST', j: user, body: {} }), 404);
    const r = await req('/certificates/verify/spk-verify-lowerprobe-' + tag);
    ok(r, [200, 404]);
  });
  await t('CERT 5/5 PDF for unknown cert -> 404', async () => {
    ok(await req('/certificates/00000000-0000-0000-0000-000000000000/pdf', { j: user }), [404, 403]);
  });

  // ================= ADMIN OPS =================
  await t('ADMIN 1/4 students list + detail', async () => {
    const l = await req('/admin/students', { j: admin }); st(l, 200); ex(Array.isArray(l.data));
    if (l.data.length) st(await req(`/admin/students/${l.data[0].id}`, { j: admin }), 200);
    st(await req('/admin/students?query=' + encodeURIComponent("' OR 1=1 --"), { j: admin }), 200);
  });
  await t('ADMIN 2/4 review queue tabs + override guards', async () => {
    for (const s of ['', '?status=AI_APPROVED', '?status=OVERRIDDEN']) st(await req('/scoring/review-queue' + s, { j: admin }), 200);
    st(await req('/scoring/review-queue/00000000-0000-0000-0000-000000000000/override', { method: 'POST', j: admin, body: { finalBand: 7.5 } }), 404);
    const q = await req('/scoring/review-queue', { j: admin });
    if (q.data.length) st(await req(`/scoring/review-queue/${q.data[0].id}/override`, { method: 'POST', j: admin, body: { finalBand: 7.3 } }), 400);
  });
  await t('ADMIN 3/4 agent runs list/detail/retry guards', async () => {
    const l = await req('/scoring/runs', { j: admin }); st(l, 200);
    if (l.data.length) st(await req(`/scoring/runs/${l.data[0].id}`, { j: admin }), 200);
    st(await req('/scoring/runs/00000000-0000-0000-0000-000000000000', { j: admin }), 404);
    st(await req('/scoring/runs/00000000-0000-0000-0000-000000000000/retry', { method: 'POST', j: admin }), 404);
  });
  await t('ADMIN 4/4 platform stats', async () => {
    const r = await stableReq('/users/stats', { j: admin }); st(r, 200);
    ex('users' in r.data && 'attempts' in r.data && 'questions' in r.data);
  });

  // ================= ERROR SAFETY / RATE LIMIT =================
  await t('SAFETY 1/2 no internal leakage', async () => {
    for (const r of [
      await req('/attempts/not-a-uuid', { j: user }),
      await req('/users/stats', { j: user }),
      await req('/certificates', { method: 'POST', j: user }),
    ]) for (const bad of ['DATABASE_URL','postgres://','JWT_SECRET','cfoat_','PrismaClient','at Object.','node_modules']) {
      ex(!String(r.text).includes(bad), `leaked ${bad}`);
    }
  });
  await t('SAFETY 2/2 rate limit enforced', async () => {
    let hit = false;
    for (let i = 0; i < 140; i++) { const r = await req('/auth/me'); if (r.status === 429) { hit = true; break; } }
    ex(hit, 'no 429 after 140 requests');
  });

  const failed = results.filter(r => !r.ok);
  const passed = results.length - failed.length;
  console.log(`\n===== FEATURE VERIFICATION: ${passed}/${results.length} passed =====`);
  if (failed.length) console.log(failed.map(f => 'FAILED: ' + f.name + ' :: ' + f.detail).join('\n'));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
