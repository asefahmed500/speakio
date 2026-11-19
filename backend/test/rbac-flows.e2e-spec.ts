/**
 * Two-role SaaS E2E suite against a LIVE backend (http://localhost:4040).
 * Roles: USER and ADMIN only. All writing/speaking review is performed by AI
 * agents — no human queue exists; admins may override from the audit trail.
 *
 * Skips gracefully when the server is unreachable so CI without a database
 * does not fail. Every test exercises real HTTP + real database state.
 *
 * Run: npm run test:e2e   (from backend/)
 */
import { describe, beforeAll, it, expect } from '@jest/globals';

const API = process.env.E2E_API_URL ?? 'http://localhost:4040';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'password123';

let serverUp = false;
const withIt = (name: string, fn: () => unknown, timeout?: number) =>
  it(
    name,
    async () => {
      if (!serverUp) {
        console.warn(`[e2e] skipped: "${name}" (backend unreachable)`);
        return;
      }
      await fn();
    },
    timeout,
  );

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
  const res = await fetch(`${API}${path}`, {
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

async function login(
  email: string,
  password = SEED_PASSWORD,
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
    try {
      const health = await fetch(`${API}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      serverUp = health.ok;
    } catch {
      serverUp = false;
    }
    if (!serverUp) {
      console.warn(`[e2e] backend not reachable at ${API} — suite skipped`);
      return;
    }
    admin = await login('admin@speakio.com');
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
      email: 'user@speakio.com',
      password: 'Password123!',
      name: 'Duplicate',
    });
    expect(res.status).toBe(409);
  });

  withIt('rejects a wrong password with 401', async () => {
    const res = await call('POST', '/auth/login', null, {
      email: 'user@speakio.com',
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
    'admin generates AI questions into the bank (or 503 when provider is down)',
    async () => {
      const res = await call('POST', '/tests/generate', admin, {
        mode: 'ai',
        skill: 'READING',
        count: 3,
        topic: 'ocean pollution',
      });
      expect([201, 503]).toContain(res.status);
      if (res.status === 201) {
        expect(res.json.created).toBeGreaterThanOrEqual(1);
        const tests = (await call('GET', '/tests?skill=READING', user)).json;
        expect(tests.some((t: any) => t.id === res.json.testSetId)).toBe(true);
      }
    },
    240_000,
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

  withIt('verifies a certificate publicly without auth', async () => {
    const res = await call('GET', '/certificates/verify/SPK-VERIFY-8891', null);
    expect(res.status).toBe(200);
    expect(res.json.certificateNumber).toBe('SPK-2026-8891-B80');
    const missing = await call('GET', '/certificates/verify/NOPE-404', null);
    expect(missing.status).toBe(404);
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
});
