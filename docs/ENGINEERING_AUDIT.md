# Speakio — Production Systems Audit & Engineering Decisions

**Date:** 2026-11-18 · **Scope:** full-stack IELTS SaaS (Next.js 16 + NestJS 11 + PostgreSQL 18 + Cloudflare Workers + Z.AI free tier)

## 1. Complete Feature Inventory

| Feature | State | Purpose | Fixes applied | Verification |
|---|---|---|---|---|
| Auth (register/login/refresh/logout/password) | Complete | Secure sessions | SameSite=None cross-origin, rotation/theft detection, 45 s login timeout | E2E auth + RBAC |
| Roles (USER/ADMIN) | Complete | SaaS two-role access | Enum migration, instant invalidation, TOCTOU-safe last-admin demotion | E2E role matrix |
| Exam engine (timer/autosave/resume) | Complete | Exam-day simulation | Server clock, conditional autosave, snapshot questions | E2E + browser |
| Writing AI scoring + two-pass review | Complete | Honest bands | Async job, circuit breaker, bounded backoff, audit trail | E2E + live AI (band 6.0) |
| Speaking real audio → ASR → scoring | Complete (ASR paid) | Real speaking practice | WAV segments, header parse, 30 s cap, honest 503 | E2E honest-failure path |
| AI question generation + auto top-up | Complete | Fresh questions per user | Fingerprint dedup, AgentRun telemetry, cooldown | E2E + live (3 questions) |
| AI study plan (coach) | Complete | Personalized plan | 429 backoff, fallback template, circuit classification | E2E |
| Review monitor + admin override | Complete | Audit + human lever | Conditional claim, idempotent double-override 409 | E2E |
| Certificates + public verify | Complete | Verifiable participation | Unique partial index, 6-digit code | E2E + browser |
| Vocabulary / profile / results / dashboard | Complete | Student workflows | CRUD, speaking criteria, ASR transcript display | Browser smoke |
| Cloudflare deployment | Complete for frontend; tunnel for API | Public access | OpenNext Worker, one-command deploy.ps1 | HTTPS API 200 + CORS |

## 2. Architecture Audit

| Area | Architecture | Problem | Change | Implemented |
|---|---|---|---|---|
| AI scoring latency | Synchronous in submit | HTTP held open minutes; 10k users exhaust connections | Submit → SCORING, background agents, results polling | Yes |
| AI dependency failures | Retries only | Outage hammered provider | In-process circuit breaker (5 failures → 60 s cooldown, half-open probe) | Yes |
| Job recovery | Process-local promises | Restart strands SCORING attempts | Startup sweep resets >10 min SCORING → SUBMITTED (rescore path) | Yes |
| Observability | Nest Logger only | Cannot trace a user report | Request ID middleware + structured JSON request logs | Yes |
| Backup | None | Data loss risk | pg_dump script + 14-day retention | Yes (script) |
| Dependency advisories | 22 front / 6 back | Known CVEs | `npm audit fix` partial; install repaired; remaining = upstream/tooling | Deferred with evidence |

## 3. Engineering Concepts Audit (decisions)

| Concept | Needed? | Evidence | Decision |
|---|---|---|---|
| Queues / workers | Yes (AI scoring) | LLM calls 10–200 s | **KEEP EXISTING** background promise pattern + SCORING state/polling; durable external queue DEFERRED (single-process, recovery path exists) |
| Retries + exponential backoff | Yes | Free-tier 429s measured | **IMPLEMENTED** bounded 15/30 s + SDK retries |
| Circuit breaker | Yes | Sustained provider outage | **IMPLEMENTED** in ZaiProvider |
| Timeouts | Yes | Hung fetches | **IMPLEMENTED** everywhere incl. 45 s login, 300 s E2E |
| Idempotency | Yes | Double submit/override | **IMPLEMENTED** conditional updateMany + unique indexes |
| Concurrency control | Yes | Double submit, admin race | **IMPLEMENTED** partial unique index, FOR UPDATE tx, conditional claims |
| Transactions | Yes | Override, token rotation, question batch | **KEEP EXISTING** |
| Connection pooling | Yes | 10k users | Prisma default pool; explicit `connection_limit` = config task for managed DB (DEFER) |
| Indexing | Yes | Listing queries | **KEEP EXISTING** 10+ indexes incl. partial unique guards |
| Pagination | Partial | `take` caps 100/200 | Adequate at current scale; cursor pagination DEFER |
| Caching | Marginal | JWT guard status cache only | **KEEP EXISTING** 30 s cache + invalidation; no Redis (no shared-state need) |
| Rate limiting | Yes | Login/submit/AI endpoints | **KEEP EXISTING** global 120/min + per-route |
| Load balancing / horizontal scaling | Frontend yes / API no | Workers auto-scale; API single node | Workers scale; API scale-out requires Containers (paid) — DEFER with documented path |
| Health checks | Yes | /health with DB ping | **KEEP EXISTING** (liveness + DB readiness) |
| Graceful shutdown | Yes | Deploy/restart | **KEEP EXISTING** enableShutdownHooks + startup recovery |
| Realtime | No | Polling every 10 s only while SCORING | **KEEP POLLING** — WebSocket would add architecture for little benefit |
| Request cancellation/debounce | Yes | Search + stale responses | **IMPLEMENTED** AbortSignal, seq guards, 250 ms debounce |
| Object storage | No (yet) | Audio ≤6 MB in JSON | DEFER — R2 migration needed only if average audio payload grows |
| Structured logging/metrics/tracing | Partial | Request IDs added; no Pino/OTel | **IMPLEMENTED** request IDs; full tracing DEFER (single service) |
| Backups/recovery | Yes | Local Postgres | **IMPLEMENTED** pg_dump script; managed PITR needs managed DB |
| Feature flags | No | Env-driven config suffices | **NOT NEEDED** |
| API versioning | No | Single first-party client | **NOT NEEDED** |

## 4. Reliability Report

| Failure | Behavior | Fix | Verification |
|---|---|---|---|
| Z.AI 429/outage | Bounded backoff → 503, attempt recoverable | Circuit breaker + classification | E2E honest-failure path |
| Process restart mid-scoring | Attempt stuck SCORING | Startup recovery → SUBMITTED | Unit + code review |
| Audit write fails post-publish | Previously regressed COMPLETED | Best-effort telemetry + score-count guard | E2E |
| Duplicate overrides | 409 | Conditional claim in transaction | E2E |
| Tunnel drop | Frontend URL stale | deploy.ps1 rebuilds & redeploys with new URL | Manual rerun |
| Quick-tunnel 502 | Transient browser login timeout | 45 s login timeout + one-command redeploy | Direct HTTPS 200 verified |

## 5. Performance Report

| Flow | Problem | Fix | After |
|---|---|---|---|
| Writing/speaking submit | 10–200 s HTTP hold | Async submit → SCORING | Immediate 201 |
| Free-tier AI saturation | 429 storm | Backoff + circuit breaker | Fail fast during outage |
| Listing attempts/questions | Unbounded reads | take caps + indexes | Bounded |
| Exam autosave | 15 s interval, 5 MB payload | Audio excluded from draft | localStorage safe |

## 6. Security Report

| Issue | Risk | Fix | Verification |
|---|---|---|---|
| Privilege escalation | Role self-declaration | Server-assigned roles, stale-token 401 | E2E |
| IDOR | Foreign attempts | Ownership checks on every attempt route | E2E 403 |
| Cross-site cookies | Missing auth on deployed origin | SameSite=None; Secure + CORS allowlist | HTTPS 200 + 2 cookies |
| Secrets | .env in repo | Gitignored, .env.example only | Repo scan |
| Brute force | Login spam | Throttler 10/min + global 120/min | E2E |
| Dependency CVEs | Known advisories | npm audit fix partial; rebuild verified | `npm audit` (remaining deferred to upstream) |

## 7. Role/User Flow Report

| Role | Flow | Scope | Failure handling |
|---|---|---|---|
| USER | Register → practice → AI scoring → results → certificate | Own attempts only | SCORING poll, SUBMITTED retry, IN_PROGRESS re-record |
| ADMIN | Overview → users/students/questions/reviews/agents | Platform-wide | Role/suspend changes revoke sessions immediately; override guarded |

## 8. Database Report

- Models: User, RefreshToken, Attempt, Question, TestSet, UserQuestionHistory, Score, Certificate, AgentRun, AgentStep, ReviewQueueItem, VocabularyItem.
- Constraints: unique email/score(attempt,skill)/cert numbers; partial unique active-attempt + active-certificate; FKs with cascade/set-null.
- Indexes: 10+ (listings, history, agent runs); enum swap migration data-preserving and validated locally.
- Concurrency: conditional updates for submit/autosave/override; FOR UPDATE for last-admin demotion.
- Gaps: audio stored as base64 JSON (R2 migration path documented), cursor pagination deferred.

## 9. Final Test Report

| Test | Result |
|---|---|
| Backend tsc / unit | PASS (14/14) |
| Frontend tsc / lint / production build | PASS |
| Live API E2E (2 roles + AI + failure paths) | PASS 22/22 in 124 s (`.e2e-accept.log`) |
| Deployed stack HTTPS (auth, CORS, cookies, data) | PASS — 200/200/2 cookies/6 sets |
| Cloudflare Worker deploy | PASS — `speakio-web.speakio.workers.dev` |
| Live AI (free glm-4.7-flash) | Writing band 6.0 two-pass; 3 questions generated; coach executed |
| Deployed stack E2E | PASS 30/30 (frontend Worker → API Worker → tunnel → DB) |
| Cloudflare Containers | BLOCKED — account is Free plan (API config is ready in backend/wrangler.api.jsonc) |

## 10. Remaining Issues (genuine)

1. **Quick-tunnel API URL is ephemeral** — free plan has no zone for a named tunnel; `deploy.ps1` restores after each reboot. Permanent fix: add a domain (named tunnel) or Workers paid + Containers.
2. **Speaking ASR (`glm-asr-2512`) is paid** — returns honest 503 until Z.AI is recharged.
3. **Managed Postgres required for PITR/connection scaling** at full 10k-user production load — local Postgres is development-grade.
4. **Remaining npm advisories** (tooling transitive deps) — upstream fixes pending; app runtime paths verified.
5. **No distributed queue** — acceptable single-process; scale-out to multiple API instances would require moving the AI job runner to Cloudflare Queues/Containers.
