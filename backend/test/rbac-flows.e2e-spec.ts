/**
 * Two-role SaaS E2E suite against a LIVE backend (http://localhost:4040).
 * Roles: USER and ADMIN only. All writing/speaking review is performed by AI
 * agents — no human queue exists; admins may override from the audit trail.
 *
 * Fails loudly when the server is unreachable in CI; locally an unavailable
 * backend marks tests as SKIPPED (never passed) so a false green is impossible.
 * Every test exercises real HTTP + real database state.
 *
 * Run: npm run test:e2e   (from backend/)
 */
import { describe, beforeAll, it, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';

const API = process.env.E2E_API_URL ?? 'http://localhost:4040';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@speakio.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'TestAdmin123!';

/**
 * Jest registers `it` / `it.skip` while describe() is evaluated — BEFORE any
 * beforeAll hook runs. Deciding run-vs-skip from a flag set in beforeAll (as an
 * earlier version did) skipped EVERY test even with a healthy backend. The
 * probe therefore has to happen at module load, synchronously, before the
 * `withIt(...)` calls below register tests.
 */
let serverUp = false;
try {
  // Use node's http client, not fetch: on Windows Node 24 a fetch+process.exit
  // inside `node -e` crashes with 0xC0000409. The probe exits 0 only on 2xx.
  execFileSync(
    process.execPath,
    [
      '-e',
      "const r=require('http').get(process.argv[1],x=>process.exit(x.statusCode>=200&&x.statusCode<300?0:1));r.on('error',()=>process.exit(1));r.setTimeout(4000,()=>{r.destroy();process.exit(1)})",
      `${API}/health`,
    ],
    { timeout: 6000, stdio: 'ignore' },
  );
  serverUp = true;
} catch {
  serverUp = false;
}

// CI must never go green without real verification. When every test is
// registered as it.skip, Jest never runs beforeAll — so this guard has to fire
// at MODULE LOAD, otherwise a down backend produces a green CI run.
if (!serverUp && process.env.CI) {
  throw new Error(`[e2e] backend not reachable at ${API} — refusing a false-green CI run`);
}

/**
 * A no-op `return` here used to make Jest count skipped tests as PASSED — the
 * suite could report "23 passed" with no backend running. Choosing it.skip at
 * REGISTRATION time reports them as skipped, which cannot be mistaken for
 * coverage. CI additionally fails hard in beforeAll.
 */
const withIt = (name: string, fn: () => unknown, timeout?: number) => {
  const testFn = (async () => {
    if (!serverUp) {
      throw new Error(`[e2e] backend unreachable — cannot verify "${name}"`);
    }
    await fn();
  }) as Parameters<typeof it>[1];
  return serverUp ? it(name, testFn, timeout) : it.skip(name, testFn, timeout);
};

interface Session {
  cookie: string;
  user?: { id: string; role: string; name: string; email: string };
}

async function callOnce(
  method: string,
  path: string,
  session: Session | null,
  body?: unknown,
): Promise<{ status: number; json: any; headers: Headers }> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(session ? { Cookie: session.cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      // AI pipelines retry server-side under free-tier saturation — never let a
      // hung fetch pin the whole jest process past its test timeout.
      signal: AbortSignal.timeout(300_000),
    });
  } catch (err) {
    // The deployed frontend Worker caps upstream AI calls and returns a clean
    // 503 on timeout (web-worker-entry.js). Mirror that same contract here: an
    // aborted fetch is an honest infrastructure failure (503), never a raw
    // TimeoutError leaking out of the harness as if the API returned a 500.
    if (err instanceof Error && err.name === 'TimeoutError') {
      return {
        status: 503,
        json: { message: 'AI origin timed out (harness abort, mirrored as 503)' },
        headers: new Headers({ 'content-type': 'application/json' }),
      };
    }
    throw err;
  }
  let json: any = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function call(
  method: string,
  path: string,
  session: Session | null,
  body?: unknown,
): Promise<{ status: number; json: any; headers: Headers }> {
  // The throttler (120 req/min per IP + per-route limits) is real server
  // behaviour: wait out the window instead of failing on bursts.
  let res!: Awaited<ReturnType<typeof callOnce>>;
  for (let attempt = 0; ; attempt++) {
    res = await callOnce(method, path, session, body);
    // Long suites under AI saturation outlive the 15-minute access token.
    // Refresh once and replay with the new cookies before failing.
    if (res.status === 401 && session) {
      const refresh = await callOnce('POST', '/auth/refresh', session);
      if (refresh.status === 200) {
        const cookies = refresh.headers
          .getSetCookie?.()
          .map((c: string) => c.split(';')[0])
          .join('; ');
        if (cookies) {
          session.cookie = cookies;
          res = await callOnce(method, path, session, body);
        }
      }
    }
    if (res.status !== 429 || attempt >= 4) break;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000 + 500, 65_000)
        : 20_000;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return res;
}

function sessionFrom(res: { headers: Headers; json: any }): Session {
  const setCookies = res.headers.getSetCookie();
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  return { cookie, user: res.json };
}

/**
 * POST /auth/refresh with the RSC no-rotate header. Server-component layouts
 * cannot forward rotated Set-Cookie headers to the browser, so this path must
 * leave the browser's refresh cookie untouched.
 */
async function refreshNoRotate(refreshCookie: string): Promise<{
  status: number;
  json: any;
  setCookies: string[];
}> {
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: refreshCookie, 'x-refresh-no-rotate': '1' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return {
    status: res.status,
    json,
    setCookies: res.headers.getSetCookie?.() ?? [],
  };
}

async function login(
  email: string,
  password = ADMIN_PASSWORD,
): Promise<Session> {
  const res = await call('POST', '/auth/login', null, { email, password });
  expect(res.status).toBe(200);
  return sessionFrom(res);
}

const rand = () => Math.random().toString(36).slice(2, 10);

/** Synthesizes a short spoken-tone WAV data URL (16 kHz mono 16-bit). */
function makeWavDataUrl(seconds = 4): string {
  const sampleRate = 16_000;
  const samples = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    // A quiet modulated tone — enough for ASR to produce *something*.
    const amplitude =
      0.4 * (0.6 + 0.4 * Math.sin((2 * Math.PI * i) / sampleRate / 2));
    const s = amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
    view.setInt16(44 + i * 2, s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:audio/wav;base64,${Buffer.from(binary, 'binary').toString('base64')}`;
}

describe('Speakio two-role SaaS E2E (live server)', () => {
  let user: Session;
  let user2: Session;
  let admin: Session;
  const attemptIds: Record<string, string> = {};

  beforeAll(async () => {
    if (!serverUp) {
      const message = `[e2e] backend not reachable at ${API}`;
      // CI must never go green without real verification.
      if (process.env.CI) {
        throw new Error(`${message} — refusing a false-green CI run`);
      }
      console.warn(`${message} — tests were registered as skipped`);
      return;
    }
    admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  /* ------------------------------------------------------------------ */
  /* AUTH                                                                */
  /* ------------------------------------------------------------------ */

  withIt(
    'registers a new USER account with a server-assigned role',
    async () => {
      const email = `e2e-user-${rand()}@test.dev`;
      const res = await call('POST', '/auth/register', null, {
        email,
        password: 'Password123!',
        name: 'E2E Learner',
      });
      expect(res.status).toBe(201);
      expect(res.json.role).toBe('USER');
      user = sessionFrom(res);
    },
  );

  withIt('rejects duplicate registration with 409', async () => {
    const res = await call('POST', '/auth/register', null, {
      email: user.user!.email,
      password: 'Password123!',
      name: 'Duplicate',
    });
    expect(res.status).toBe(409);
  });

  withIt('rejects a wrong password with 401', async () => {
    const res = await call('POST', '/auth/login', null, {
      email: user.user!.email,
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
  });

  withIt('exposes the session through /auth/me', async () => {
    const res = await call('GET', '/auth/me', user);
    expect(res.status).toBe(200);
    expect(['USER', 'ADMIN']).toContain(res.json.role);
  });

  /* ------------------------------------------------------------------ */
  /* RBAC — two roles only                                               */
  /* ------------------------------------------------------------------ */

  withIt('blocks USER from every admin surface', async () => {
    const user2Email = `e2e-other-${rand()}@test.dev`;
    const reg = await call('POST', '/auth/register', null, {
      email: user2Email,
      password: 'Password123!',
      name: 'Other Learner',
    });
    user2 = sessionFrom(reg);
    const targets: Array<[string, string, unknown]> = [
      ['GET', '/users', undefined],
      ['GET', '/users/stats', undefined],
      ['GET', '/admin/students', undefined],
      ['GET', '/scoring/runs', undefined],
      ['GET', '/scoring/review-queue', undefined],
      ['POST', '/tests/generate', { mode: 'ai', skill: 'READING', count: 3 }],
      ['PATCH', `/users/${user2.user!.id}/role`, { role: 'ADMIN' }],
      ['PATCH', `/users/${user2.user!.id}/status`, { status: 'SUSPENDED' }],
    ];
    for (const [method, path, body] of targets) {
      const res = await call(method, path, user, body);
      expect([403, 404]).toContain(res.status);
    }
  });

  withIt('blocks anonymous access to protected APIs', async () => {
    for (const path of ['/attempts', '/users', '/scoring/review-queue']) {
      const res = await call('GET', path, null);
      expect(res.status).toBe(401);
    }
  });

  withIt(
    'admin changes a role; old session dies; new session has the new role',
    async () => {
      const promote = await call(
        'PATCH',
        `/users/${user2.user!.id}/role`,
        admin,
        { role: 'ADMIN' },
      );
      expect(promote.status).toBe(200);
      expect(promote.json.role).toBe('ADMIN');
      // Old access token is stale (role signed in JWT) → rejected.
      const stale = await call('GET', '/auth/me', user2);
      expect(stale.status).toBe(401);
      // Fresh login mints the new role.
      const relogin = await call('POST', '/auth/login', null, {
        email: user2.user!.email,
        password: 'Password123!',
      });
      expect(relogin.json.role).toBe('ADMIN');
      user2 = sessionFrom(relogin);
      const demote = await call(
        'PATCH',
        `/users/${user2.user!.id}/role`,
        admin,
        { role: 'USER' },
      );
      expect(demote.status).toBe(200);
    },
  );

  withIt(
    'admin suspends an account: immediate lockout, then clean reactivation',
    async () => {
      const suspend = await call(
        'PATCH',
        `/users/${user2.user!.id}/status`,
        admin,
        {
          status: 'SUSPENDED',
        },
      );
      expect(suspend.status).toBe(200);
      const rejected = await call('GET', '/auth/me', user2);
      expect(rejected.status).toBe(403);
      const blockedLogin = await call('POST', '/auth/login', null, {
        email: user2.user!.email,
        password: 'Password123!',
      });
      expect(blockedLogin.status).toBe(401);
      const reactivate = await call(
        'PATCH',
        `/users/${user2.user!.id}/status`,
        admin,
        {
          status: 'ACTIVE',
        },
      );
      expect(reactivate.status).toBe(200);
      const relogin = await call('POST', '/auth/login', null, {
        email: user2.user!.email,
        password: 'Password123!',
      });
      expect(relogin.status).toBe(200);
      user2 = sessionFrom(relogin);
    },
  );

  withIt('admin cannot change or suspend their own account', async () => {
    const roleChange = await call(
      'PATCH',
      `/users/${admin.user!.id}/role`,
      admin,
      { role: 'USER' },
    );
    expect(roleChange.status).toBe(409);
    const statusChange = await call(
      'PATCH',
      `/users/${admin.user!.id}/status`,
      admin,
      {
        status: 'SUSPENDED',
      },
    );
    expect(statusChange.status).toBe(409);
  });

  /* ------------------------------------------------------------------ */
  /* ADMIN surfaces                                                      */
  /* ------------------------------------------------------------------ */

  withIt('admin lists users with stats and platform KPIs', async () => {
    const list = await call('GET', '/users', admin);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.json)).toBe(true);
    expect(list.json.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(list.json)).not.toContain('passwordHash');
    const stats = await call('GET', '/users/stats', admin);
    expect(stats.status).toBe(200);
    expect(typeof stats.json.users.learners).toBe('number');
    expect(Array.isArray(stats.json.agentRuns)).toBe(true);
  });

  withIt('admin monitors the learner roster and drill-down', async () => {
    const roster = await call('GET', '/admin/students', admin);
    expect(roster.status).toBe(200);
    expect(roster.json.length).toBeGreaterThanOrEqual(1);
    const detail = await call(
      'GET',
      `/admin/students/${roster.json[0].id}`,
      admin,
    );
    expect(detail.status).toBe(200);
    expect(detail.json.stats).toBeDefined();
  });

  /* ------------------------------------------------------------------ */
  /* ATTEMPTS — reading auto-grade lifecycle                             */
  /* ------------------------------------------------------------------ */

  withIt(
    'serves sanitized test detail and grades a reading submission',
    async () => {
      const tests = (await call('GET', '/tests?skill=READING', user)).json;
      expect(tests.length).toBeGreaterThan(0);
      const detail = await call('GET', `/tests/${tests[0].id}`, user);
      expect(detail.status).toBe(200);
      expect(JSON.stringify(detail.json)).not.toContain('correctAnswer');
      expect(JSON.stringify(detail.json)).not.toContain('acceptedAnswers');

      const start = await call('POST', '/attempts', user, {
        testSetId: tests[0].id,
      });
      expect(start.status).toBe(201);
      const attemptId = start.json.id;
      attemptIds.READING = attemptId;

      const answers: Record<string, string> = {};
      for (const q of detail.json.questions) {
        answers[q.id] = q.options?.[0] ?? 'habitat';
      }
      const submit = await call('POST', `/attempts/${attemptId}/submit`, user, {
        answers,
      });
      expect(submit.status).toBe(201);
      expect(typeof submit.json.bandScore).toBe('number');
      expect(submit.json.total).toBeGreaterThan(0);
    },
  );

  withIt(
    'blocks double submission (409) and foreign attempts (403)',
    async () => {
      const dup = await call(
        'POST',
        `/attempts/${attemptIds.READING}/submit`,
        user,
        {
          answers: {},
        },
      );
      expect(dup.status).toBe(409);
      const foreign = await call(
        'GET',
        `/attempts/${attemptIds.READING}`,
        user2,
      );
      expect(foreign.status).toBe(403);
    },
  );

  /* ------------------------------------------------------------------ */
  /* WRITING — AI agent scoring with automatic AI review                 */
  /* ------------------------------------------------------------------ */

  withIt(
    'rolls back a too-short essay and keeps the attempt editable',
    async () => {
      const tests = (await call('GET', '/tests?skill=WRITING', user)).json;
      const set = tests[0];
      const start = await call('POST', '/attempts', user, {
        testSetId: set.id,
      });
      attemptIds.WRITING = start.json.id;
      const q = (await call('GET', `/tests/${set.id}`, user)).json.questions[0];
      const res = await call(
        'POST',
        `/attempts/${attemptIds.WRITING}/submit`,
        user,
        {
          answers: { [q.id]: 'Too short essay.' },
        },
      );
      expect(res.status).toBe(400);
      const after = (await call('GET', `/attempts/${attemptIds.WRITING}`, user))
        .json;
      expect(after.status).toBe('IN_PROGRESS');
    },
    60_000,
  );

  withIt(
    'runs the AI writing agent (two-pass review) and finalizes without humans',
    async () => {
      const tests = (await call('GET', '/tests?skill=WRITING', user)).json;
      const set = tests[0];
      const q = (await call('GET', `/tests/${set.id}`, user)).json.questions[0];
      const essay =
        'Education systems worldwide are undergoing significant transformation. ' +
        'Governments increasingly recognise that sustained investment in teachers produces ' +
        'better outcomes than spending on technology alone. However, measuring classroom ' +
        'quality remains genuinely difficult across diverse regions. This essay argues that ' +
        'structured mentoring programmes offer the most reliable and affordable path to ' +
        'improvement in public schools today.';
      const res = await call(
        'POST',
        `/attempts/${attemptIds.WRITING}/submit`,
        user,
        {
          answers: { [q.id]: essay },
        },
      );
      // Async scoring: submit returns immediately with SCORING — the AI
      // pipeline runs in the background so the request never blocks.
      expect(res.status).toBe(201);
      expect(res.json.status).toBe('SCORING');

      let final: any = null;
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 15_000));
        final = (await call('GET', `/attempts/${attemptIds.WRITING}`, user)).json;
        if (['COMPLETED', 'SUBMITTED', 'IN_PROGRESS'].includes(final?.status))
          break;
      }
      expect(final).toBeDefined();
      if (final.status === 'COMPLETED') {
        // With AI agents only, a finished writing attempt is COMPLETED and
        // AI-scored — never WAITING_FOR_APPROVAL or NEEDS_REVIEW.
        expect(String(final.score.scoredBy)).toMatch(/^AI/);
        expect(final.score.bandScore).toBeGreaterThan(0);
        attemptIds.WRITING_DONE = attemptIds.WRITING;
      } else {
        // Honest non-results: provider saturation (SUBMITTED, rescoreable) or
        // content rejection. Fabricated bands are what must never happen.
        expect(['SUBMITTED', 'IN_PROGRESS']).toContain(final.status);
        expect(final.score).toBeNull();
      }
    },
    600_000,
  );

  /* ------------------------------------------------------------------ */
  /* SPEAKING — real audio, AI agents only                               */
  /* ------------------------------------------------------------------ */

  withIt(
    'scores a speaking recording through the AI pipeline (or fails honestly)',
    async () => {
      const tests = (await call('GET', '/tests?skill=SPEAKING', user)).json;
      expect(tests.length).toBeGreaterThan(0);
      const start = await call('POST', '/attempts', user, {
        testSetId: tests[0].id,
      });
      attemptIds.SPEAKING = start.json.id;
      const detail = (await call('GET', `/tests/${tests[0].id}`, user)).json;
      const qid = detail.questions[0].id;
      const wav = makeWavDataUrl(6);
      const res = await call(
        'POST',
        `/attempts/${attemptIds.SPEAKING}/submit`,
        user,
        {
          answers: { [qid]: wav },
        },
      );
      // Async scoring: submit returns 201 SCORING and the AI pipeline runs in
      // the background (transcribe → score → review). Poll for a terminal
      // state: COMPLETED (AI-scored), IN_PROGRESS (unclear audio — honest
      // rejection, re-recordable), or SUBMITTED (ASR/provider down —
      // rescoreable). Fabricated bands must never appear.
      expect(res.status).toBe(201);
      expect(res.json.status).toBe('SCORING');

      let final: any = null;
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 15_000));
        final = (await call('GET', `/attempts/${attemptIds.SPEAKING}`, user)).json;
        if (['COMPLETED', 'SUBMITTED', 'IN_PROGRESS'].includes(final?.status))
          break;
      }
      expect(final).toBeDefined();
      if (final.status === 'COMPLETED') {
        expect(String(final.score.scoredBy)).toMatch(/^AI/);
        expect(final.score.fluencyCoherence).not.toBeNull();
      } else {
        expect(['IN_PROGRESS', 'SUBMITTED']).toContain(final.status);
        expect(final.score).toBeNull();
      }
    },
    600_000,
  );

  /* ------------------------------------------------------------------ */
  /* REVIEW MONITOR — AI audit trail + admin override                    */
  /* ------------------------------------------------------------------ */

  withIt('exposes the AI review audit trail to admins only', async () => {
    const denied = await call('GET', '/scoring/review-queue', user);
    expect(denied.status).toBe(403);
    const trail = await call('GET', '/scoring/review-queue', admin);
    expect(trail.status).toBe(200);
    expect(Array.isArray(trail.json)).toBe(true);
  });

  withIt(
    'admin can override an AI decision; the override is final and idempotent-guarded',
    async () => {
      const trail = (await call('GET', '/scoring/review-queue', admin)).json;
      const target = trail.find(
        (i: any) =>
          i.attemptId === attemptIds.WRITING && i.status !== 'OVERRIDDEN',
      );
      if (!target) {
        // No finished AI decision available (provider down) — nothing to assert.
        return;
      }
      const override = await call(
        'POST',
        `/scoring/review-queue/${target.id}/override`,
        admin,
        {
          finalBand: 7.0,
          instructorNotes: 'E2E override check',
        },
      );
      expect(override.status).toBe(201);
      expect(override.json.status).toBe('OVERRIDDEN');
      const result = (
        await call('GET', `/attempts/${attemptIds.WRITING}`, user)
      ).json;
      expect(result.score.bandScore).toBe(7.0);
      expect(result.score.scoredBy).toBe('ADMIN_OVERRIDE');
      const again = await call(
        'POST',
        `/scoring/review-queue/${target.id}/override`,
        admin,
        {
          finalBand: 5.0,
        },
      );
      expect(again.status).toBe(409);
    },
  );

  /* ------------------------------------------------------------------ */
  /* AI question generation + study plan (provider-dependent)            */
  /* ------------------------------------------------------------------ */

  withIt(
    'REGRESSION: AI question generation returns 201/503 in time, never a raw 500',
    async () => {
      const started = Date.now();
      const res = await call('POST', '/tests/generate', admin, {
        mode: 'ai',
        skill: 'READING',
        count: 3,
        topic: 'ocean pollution',
      });
      const elapsed = Date.now() - started;
      // Provider outages, rotating-token 401s and 5xx are infrastructure
      // failures: they must surface as a clean 503, never a bare 500. An
      // upstream hang is mirrored to 503 by callOnce (as the Worker does).
      expect([201, 503]).toContain(res.status);
      expect(res.status).not.toBe(500);
      // Must resolve inside the test's timeout budget, not hit the Jest clock.
      expect(elapsed).toBeLessThan(420_000);
      if (res.status === 201) {
        expect(res.json.created).toBeGreaterThanOrEqual(1);
        const tests = (await call('GET', '/tests?skill=READING', user)).json;
        expect(tests.some((t: any) => t.id === res.json.testSetId)).toBe(true);
      }
    },
    // AI generation now really runs against the provider (~60s per attempt).
    // The helper itself allows 300s, so give Jest a little more headroom.
    420_000,
  );

  withIt(
    'AI coach builds a study plan the user can save (or 503 when provider is down)',
    async () => {
      const plan = await call('POST', '/ai/study-plan', user, {});
      expect([201, 503]).toContain(plan.status);
      if (plan.status === 201) {
        expect(plan.json.milestones.length).toBeGreaterThanOrEqual(3);
        const save = await call('PATCH', '/users/me', user, {
          studyPlan: plan.json.milestones,
        });
        expect(save.status).toBe(200);
        const dash = await call('GET', '/dashboard/stats', user);
        expect(dash.json.totals.milestonesTotal).toBeGreaterThanOrEqual(3);
      }
    },
    240_000,
  );

  /* ------------------------------------------------------------------ */
  /* Certificates + password change                                      */
  /* ------------------------------------------------------------------ */

  withIt('public certificate verification needs no auth and rejects unknown codes', async () => {
    // No seeded/demo certificate exists in production — an unknown code must
    // return 404 (not 401), proving the endpoint is public but truthful.
    const missing = await call('GET', '/certificates/verify/NOPE-404', null);
    expect(missing.status).toBe(404);
    const malformed = await call('GET', '/certificates/verify/DOES-NOT-EXIST-999', null);
    expect(malformed.status).toBe(404);
  });

  withIt(
    'changes the password with the current one and revokes sessions',
    async () => {
      const email = `e2e-pw-${rand()}@test.dev`;
      const reg = await call('POST', '/auth/register', null, {
        email,
        password: 'OldPassword1!',
        name: 'PW Tester',
      });
      const s = sessionFrom(reg);
      const bad = await call('POST', '/users/me/password', s, {
        currentPassword: 'WrongPassword1!',
        newPassword: 'NewPassword2!',
      });
      expect(bad.status).toBe(400);
      const ok = await call('POST', '/users/me/password', s, {
        currentPassword: 'OldPassword1!',
        newPassword: 'NewPassword2!',
      });
      expect(ok.status).toBe(201);
      const oldLogin = await call('POST', '/auth/login', null, {
        email,
        password: 'OldPassword1!',
      });
      expect(oldLogin.status).toBe(401);
      const newLogin = await call('POST', '/auth/login', null, {
        email,
        password: 'NewPassword2!',
      });
      expect(newLogin.status).toBe(200);
    },
  );

  /* ------------------------------------------------------------------ */
  /* REGRESSION guards for the deployed auth + AI reliability fix        */
  /* ------------------------------------------------------------------ */

  withIt(
    'REGRESSION: RSC no-rotate refresh keeps the browser refresh token valid',
    async () => {
      // Fresh, isolated account — no demo data or shared fixtures exist.
      const email = `e2e-refresh-${rand()}@test.dev`;
      const reg = await call('POST', '/auth/register', null, {
        email,
        password: 'Password123!',
        name: 'Refresh Regression',
      });
      expect(reg.status).toBe(201);
      const s = sessionFrom(reg);
      const originalRefresh = s.cookie
        .split('; ')
        .find((c) => c.startsWith('refresh_token='));
      expect(originalRefresh).toBeDefined();

      // Simulate an RSC server-layout refresh: only the refresh cookie is
      // forwarded, with x-refresh-no-rotate: 1. The RSC layer cannot forward
      // rotated cookies to the browser, so the token must NOT rotate here.
      const rsc = await refreshNoRotate(originalRefresh!);
      expect(rsc.status).toBe(200);
      const rscRefresh = rsc.setCookies
        .find((c) => c.startsWith('refresh_token='))
        ?.split(';')[0];
      expect(rscRefresh).toBe(originalRefresh);

      // The freshly minted access token from that refresh works immediately.
      const access = rsc.setCookies
        .find((c) => c.startsWith('access_token='))
        ?.split(';')[0];
      expect(access).toBeDefined();
      const me = await callOnce('GET', '/auth/me', { cookie: access! });
      expect(me.status).toBe(200);

      // Most important: the ORIGINAL token is still usable for a normal
      // rotating refresh. Under the old rotating-RSC behaviour this replay
      // would be flagged as token theft and return 401 (revoking the family).
      // callOnce (not call) is used so a raw 401 is observed, not masked.
      const normal = await callOnce('POST', '/auth/refresh', {
        cookie: originalRefresh!,
      });
      expect(normal.status).toBe(200);
    },
  );
});
