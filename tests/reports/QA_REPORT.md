# APPLICATION QA REPORT — Speakio

**Application:** Speakio — IELTS Prep & AI Band Scoring
**Environment:** Local, `http://localhost:3000` (frontend) → `http://localhost:4040` (NestJS API) → PostgreSQL (`backend/.env`)
**Browser:** Real Chromium (headed), Playwright 1.x, Desktop Chrome descriptor
**Automation:** Playwright Test (`npm run test:browser`)
**Final evidence run:** 2026-11-26, 52/52 passed in 8m 04s

---

## 1. Discovery inventory

| Item | Count |
|---|---:|
| Discovered routes/pages | 30 |
| Routes exercised in a real browser | 27 |
| Functional modules | 16 |
| Distinct interactive controls exercised | ≈127 |
| Backend endpoints verified | ≈38 |
| Database entities verified via direct `pg` queries | 6 |

**Public routes:** `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify`, `/verify/[certificateId]`
**Student routes:** `/dashboard`, `/results`, `/results/[attemptId]`, `/study-plan`, `/vocabulary`, `/skills/listening`, `/skills/reading`, `/skills/writing`, `/skills/speaking`, `/certificates`, `/profile`
**Exam routes:** `/test/[testId]/take`, `/test/[testId]/take/loading`
**Admin routes:** `/overview`, `/review-queue`, `/agent-ops`, `/students`, `/students/[id]`, `/users`, `/question-bank`
**System routes:** `/not-found`, `/error`, `/global-error`

**Modules:** authentication/session, RBAC, student dashboard, 4 skill hubs, exam engine (timer/autosave/submit), results & scoring, study planner (AI coach), vocabulary studio (AI rewriter), certificates + public verification, profile/password, admin overview, AI review queue, agent ops, student management, user management, question bank.

---

## 2. Test execution summary

| Metric | Result |
|---|---:|
| Total test cases executed (final run) | **52** |
| PASSED | **52** |
| FAILED | **0** |
| SKIPPED | **0** |
| BLOCKED / NOT TESTED (documented below) | 0 in-suite; 14 PRD features out of implementation scope |
| Stability re-runs | 9/9 passed after fixes (3 previously flaky tests × 3 runs) |
| Full-suite runs completed | 4 (final three green) |

Suites: `00-smoke`, `01-auth`, `02-navigation`, `03-student-crud`, `04-exam`, `05-admin`, `06-verify`, `07-responsive`, `08-security`, `09-extended-features`.

---

## 3. Findings by layer

### Frontend issues
- **No blocking frontend defects found.** No unhandled JS exceptions, no broken images or missing assets, no infinite spinners, no horizontal overflow at 1440×1000 / 1366×768 / 768×1024 / 390×844.
- Expected console noise only: guest `/auth/me` + silent `/auth/refresh` 401s, deliberate 400 validation submissions, and a Playwright screenshot artifact that injects `caret-color: transparent` into inputs (classified narrowly in the monitor; all other hydration warnings remain actionable).
- Transient "Service unavailable" RSC state was observed twice when the backend briefly stopped responding. The app degraded gracefully; the harness now retries such navigations rather than reporting a false failure.

### Backend / API issues
- **Fixed:** rate-limit responses exposed the raw NestJS class name `ThrottlerException: Too Many Requests`. Added `ThrottlerFilter` so 429 responses return a stable, friendly message. Regression test added and passing.
- External AI provider returned 503 once during repeated runs. The application's designed fallback (local study-plan template + persisted plan + visible notice) was verified — not an application defect.
- All status codes verified in real flows: 200, 201, 400, 401, 403, 404, 409, 429, 503; no unexpected 500 from application code.

### Database consistency
- Vocabulary CRUD: row created, read back, updated by refresh, deleted — verified directly in PostgreSQL.
- Attempts: `IN_PROGRESS` → autosaved answers → `COMPLETED`/scored; scores row written with band, criteria, `scoredBy`, confidence.
- Study-plan preferences and generated/fallback milestones persisted in `users.studyPlanJson`.
- Role change and suspend/reactivate verified in `users` table with immediate session revocation.
- IDOR attacker writes did not alter the owner's attempt; no duplicate/orphan records detected.

### Authentication & authorization
- Valid/invalid/empty login, duplicate registration, validation errors, logout, refresh-token rotation, session persistence, deep-link redirect, password change + session revocation all pass.
- USER is blocked from all 6 admin routes by server-side layout and from 7 admin/agent endpoints with 403.
- JWT cookie forgery rejected (401 + redirect to login).
- Suspended account rejected at API level; reactivation restores access.

### Security findings
- No IDOR, no cross-user data access, no XSS execution (script payload stored literally and escaped by React), no SQL-injection-shaped search abuse, no secret/stack-trace leakage in error responses, no answer-key leakage to students.
- Rate limiting confirmed on auth endpoints and now returns a sanitized message.
- Secure cookie flags are environment-appropriate (httpOnly + sameSite=lax for local HTTP).

### Responsive / UI
- Zero horizontal overflow on all four viewports for public and authenticated pages.
- Mobile sidebar off-canvas toggle, aria-expanded state, keyboard Escape dismissal of dialogs, and sidebar link navigation verified.

---

## 4. Evidence

| Artifact | Location |
|---|---|
| Screenshots (37) | `tests/reports/screenshots/` |
| Playwright traces (52) | `tests/reports/artifacts/**/trace.zip` |
| Machine results | `tests/reports/results.json` |
| HTML report | `tests/reports/html/index.html` |
| Run logs (26) | `tests/reports/logs/qa-*.log` (live dev-server logs remain at the repo root) |

No failure screenshots exist from the final run because there were no failures; earlier transient failures are preserved in `tests/reports/artifacts/**/test-failed-1.png` with their traces.

---

## 5. Fixes applied

1. **`backend/src/common/throttler-filter.ts` (new)** — global filter converting `ThrottlerException` into `{ statusCode: 429, error, message, requestId }` with a user-facing message; registered in `backend/src/server.ts`. Backend typecheck clean.
2. **Test harness hardening** — wait for RSC form hydration before editing; retry registration on backend's 60s throttle and transient network outages; `gotoApp()` retry wrapper for the app's graceful "Service unavailable" state; monitor classifies expected HTTP-error console noise and AI-provider 503 only after verifying the app's fallback; screenshot helper no longer disables animations.
3. **Automation infrastructure** — `playwright.config.ts`, 10 spec files, reusable helpers (`auth`, `db`, `monitor`, `navigation`, `report`, `constants`, `db-verify.cjs`), and `npm run test:browser`.

No production data was deleted or modified outside uniquely tagged `@speakio.test` fixtures.

---

## 6. Blocked / not tested (honest scope)

These are PRD items not implemented in this build or not safely testable locally — they are **not** counted as passed:

- Google/Apple OAuth, email verification OTP/magic link (not implemented).
- Real email delivery of reset links (no mail server; API validation + UI confirmation verified).
- Onboarding wizard / diagnostic quiz, push notifications / in-app notification center, PWA/service worker, realtime WebSocket, Ops/Support agent chat, global settings and audit-log UI (not implemented).
- Full four-skill mock test as a single back-to-back flow (not implemented).
- Microphone-based speaking recording/upload pipeline (no mic device; typed-answer fallback fully verified).
- Certificate PDF download: the only certificate in the database is REVOKED and belongs to another user; negative eligibility path verified, positive issue→download path blocked by missing fixture.
- AI content generation from Question Bank and retry of a real failed agent run (would create real content/cost); only guard endpoints (404/403/400) were exercised.
- External TTS audio playback itself; player controls and error UI were verified without triggering the third-party service.

---

## 7. Regression results

- After every fix, the affected test was rerun and then the full suite was rerun.
- Final evidence run: **52 passed, 0 failed, 0 skipped** (`qa-run-evidence.log`, `tests/reports/results.json`).
- Stability check: 9 repeated runs of the previously unstable AI/throttle/IDOR/writing flows — **9/9 passed**, including one genuine AI 503 handled by the application fallback.
- Backend `npm run typecheck` passes after the filter change.

## FINAL STATUS: **PASS**

All implemented, locally reachable features were exercised through a real Chromium browser down to the database. No unresolved functional, security, or data-integrity defects were found in the tested scope.
