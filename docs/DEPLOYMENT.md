# Deployment — Speakio

## Live topology (free Cloudflare plan)

```
Browser
  → https://speakio-web.speakio.workers.dev   (Next.js 16 via OpenNext Worker + static assets)
  → https://speakio-api.speakio.workers.dev   (edge reverse-proxy Worker, api-proxy/)
  → Vercel serverless (speakio-api.vercel.app)
  → localhost:4040  NestJS API
  → PostgreSQL (Prisma cloud Postgres, db.prisma.io) — all 9 migrations applied
  → Cloudflare Workers AI (free models: @cf/zai-org/glm-4.7-flash + Whisper ASR)
```

Cloudflare resources provisioned: Hyperdrive `speakio-hyperdrive`
(id `524f57f8eaad42c89d9a3f385a6f6b78`) for Worker→Postgres connections and
R2 bucket `speakio-media` for future file storage (bound to the API Worker).
`ops/api-watchdog.ps1` is registered as a Windows scheduled task every 5
minutes: it verifies the public API and frontend endpoints and redeploys the
the API Worker's `API_ORIGIN` and redeploys it.

**No demo data exists**: seed only creates IELTS test content; accounts are
created through registration, and the first ADMIN is bootstrapped with
`ADMIN_EMAIL=... ADMIN_PASSWORD=<12+ chars> npm run create-admin`.

## Production architecture (current)

- **API**: NestJS on **Vercel** (`speakio-api` project, `backend/api/index.ts`,
  Node 24, `maxDuration: 60s`, 1024 MB) with Prisma cloud Postgres. Env vars
  live in Vercel's encrypted store (`vercel env ls production`). Coach,
  question-generation and paraphrase traffic routes to the fast
  `@cf/meta/llama-3.3-70b` model so HTTP-awaited AI calls finish inside
  Vercel's 60 s cap, while essay/speaking grading keeps the reasoning GLM
  model and runs inline (`VERCEL` makes scoring await instead of
  fire-and-forget — there is no background process on serverless).
- **Frontend**: Cloudflare Workers (`speakio-web`, OpenNext) — the only
  Cloudflare-hosted compute.
- **API proxy**: Cloudflare Worker `speakio-api` reverse-proxies `/api/*`
  from the frontend host to `https://speakio-api.vercel.app` (stable origin —
  the ephemeral quick tunnel is retired). Auth cookies are set on the
  frontend host, which is required because `workers.dev` is a Public Suffix.

Deploy everything with `powershell -File .\deploy.ps1` (Vercel backend,
API Worker repoint, frontend build + deploy, live verification).

## API client contract

`lib/api-client.ts` uses **only** the build-time `NEXT_PUBLIC_API_URL`. It never
derives the base from `window.location` and never appends `:4040` on cloud
origins — that bug caused cross-origin login/register timeouts and is fixed.
Default request timeout is 45 s for slow serverless hops.

Production builds set `NEXT_PUBLIC_API_URL=https://speakio-web.speakio.workers.dev/api`.
The frontend Worker (`web-worker-entry.js`) proxies `/api/*` to the API Worker,
so the API is **same-origin** with the pages: auth cookies are stored on the
frontend host and reach `proxy.ts` and the server layouts. This is required
because `workers.dev` is on the Public Suffix List — `speakio-web` and
`speakio-api` cannot share a `Domain=` cookie. In local dev the default
`http://localhost:4040` keeps cookies shared across ports as before.

### Session refresh across RSC navigations

`lib/session.ts` calls `/auth/refresh` with `x-refresh-no-rotate: 1` when the
access token has expired. RSC responses cannot forward rotated `Set-Cookie`
headers to the browser, so rotating during a server-side refresh invalidated
the browser's refresh token and the next navigation bounced to `/login`.
Non-rotating refresh keeps the browser cookie valid; browser-driven refreshes
in `lib/api-client.ts` still rotate normally.

## One-command deploy / recovery

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

`deploy.ps1` performs, in order:
1. Start/reuse the backend from `backend/dist` (health-checked).
2. Start/reuse `cloudflared` tunnel and read the fresh `*.trycloudflare.com` URL.
3. Update `api-proxy/wrangler.jsonc` `API_ORIGIN` and deploy `speakio-api`.
4. Build the frontend with `NEXT_PUBLIC_API_URL=https://speakio-web.speakio.workers.dev/api` (`npm run cf:build`) and deploy `speakio-web` (entrypoint `web-worker-entry.js`).

Run it to ship backend or frontend changes. Nothing else needs manual wiring.

## Manual commands

| Task | Command |
|---|---|
| Backend build | `cd backend && npx nest build` |
| Backend run | `node dist/src/main.js` (port from `PORT`, default 4000; local `.env` uses 4040) |
| Frontend build | `npm run build` |
| Frontend Worker build+deploy | `npm run cf:build && npx wrangler deploy` |
| API proxy deploy | `cd api-proxy && npx wrangler deploy` |
| DB migrations | `cd backend && npx prisma migrate deploy` |
| Seed (IELTS content only, no demo accounts) | `npx prisma db seed` |
| Seed free IELTS bank | `npx ts-node prisma/seed-free-bank.ts` (also part of `db seed`) |
| Backup | `powershell -File backend/scripts/backup.ps1` (pg_dump, 14-day retention) |
| Tests | `npm test` (root, Vitest), `npm --prefix backend test`, `npm --prefix backend run test:e2e` |

## Configuration

Secrets live in `.env` / `.env.local` (git-ignored). Worker variables:

- `speakio-web`: `NEXT_PUBLIC_API_URL` baked at build time (currently the same-origin `/api` path on the frontend Worker).
- `speakio-api`: `API_ORIGIN` = current tunnel URL.
- Backend: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `COOKIE_SAMESITE=lax` (same-origin after the `/api` proxy; `none` only for genuinely cross-site setups), optional `CF_EMAIL_API_TOKEN`/`CF_ACCOUNT_ID`/`CF_EMAIL_FROM` for password-reset email.
- AI provider: `ZAI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`, `ZAI_API_KEY`, all three `ZAI_MODEL_*` = `@cf/zai-org/glm-4.7-flash`, `ZAI_MODEL_ASR=@cf/openai/whisper-large-v3-turbo`. The `ZAI_*` names are kept as the provider contract; transport is Cloudflare's OpenAI-compatible Workers AI endpoint.

`backend/src/common/ai-token.ts` resolves the AI credential at call time:
it reads wrangler's OAuth token (which Cloudflare rotates) from the local
wrangler config and falls back to `ZAI_API_KEY`. The credential is never
cached across rotations, and a provider 401 triggers one refresh-and-retry.
`ops/api-watchdog.ps1` also runs `wrangler whoami` each cycle to keep that
token fresh. For a non-wrangler deployment, set `ZAI_API_KEY` to a dedicated
API token with Workers AI permission.

Study-plan generation deliberately asks for 5–7 short milestones with
`maxTokens: 4000` and `timeoutMs: 90_000`: longer prompts overflowed the token
budget and retried past Cloudflare's 100 s edge timeout (524).

### CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` needs two repository secrets:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with Workers Scripts:Edit
  and Workers Static Assets:Edit for this account.
- `CLOUDFLARE_ACCOUNT_ID` — the account ID (`1945c662…` for this project).

CI builds and deploys **only the frontend Worker**. It deliberately does NOT
deploy `speakio-api`: that Worker's `API_ORIGIN` is an ephemeral
`trycloudflare.com` URL rewritten on the Windows host by
`ops/api-watchdog.ps1`, so a CI deploy would bake a dead origin. Run
`deploy.ps1` on the host after a reboot or tunnel change to update the origin
and redeploy the API Worker. A fresh clone cannot deploy a working backend
from CI alone — the NestJS process and tunnel still run on the host (Containers
require the paid Cloudflare plan; Vercel Hobby caps serverless at 60 s).

### Cloudflare database status

The live database is now **Prisma cloud Postgres** (`db.prisma.io`), not local:
`npx prisma migrate deploy` applied all 9 migrations and `npx prisma db seed`
loaded the test content. Hyperdrive `speakio-hyperdrive` is configured for
Worker access. D1 `speakio-db` exists but remains unwired (SQLite vs Postgres).

## Cloudflare Containers (requires Workers Paid plan)

`backend/Dockerfile` + `backend/wrangler.api.jsonc` + `backend/api-worker/src/worker.ts`
are a ready-made Container deployment: Wrangler builds the NestJS image, a
Durable Object starts it with the environment secrets, and all API requests are
forwarded to port 8080. This account is on the **Free** plan, so
`wrangler containers list` returns:
`Unauthorized: You do not have access to Cloudflare Containers. Deploying containers requires the Workers Paid plan.`

After upgrading, deploy with:

```bash
cd backend
npx wrangler secret put DATABASE_URL --config wrangler.api.jsonc   # cloud Postgres URL
npx wrangler secret put JWT_SECRET --config wrangler.api.jsonc
npx wrangler secret put ZAI_API_KEY --config wrangler.api.jsonc
npx wrangler deploy --config wrangler.api.jsonc
```

A managed Postgres (e.g. Neon free tier) is required for a fully cloud-native
backend — import the existing data with `pg_restore` from a `backend/scripts/backup.ps1` dump.

## Verification evidence (2026-11-19)

- Deployed-stack E2E: **30/30** checks — public pages, auth+CORS+cookies, RBAC,
  tests, exam auto-grade, AI typed-speaking report, admin routes, reviews,
  question bank, certificates, forgot-password.
- Local gates: backend typecheck + 14/14 unit + 22/22 live E2E; frontend
  typecheck, lint (0 warnings), production build.
