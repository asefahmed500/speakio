# Deployment — Speakio

## Live topology (free Cloudflare plan)

```
Browser
  → https://speakio-web.speakio.workers.dev   (Next.js 16 via OpenNext Worker + static assets)
  → https://speakio-api.speakio.workers.dev   (edge reverse-proxy Worker, api-proxy/)
  → Cloudflare Tunnel (trycloudflare.com)
  → localhost:4040  NestJS API
  → PostgreSQL 18 (local dev database)
  → Cloudflare Workers AI (free models: @cf/zai-org/glm-4.7-flash + Whisper ASR)
```

The frontend Worker auto-scales on Cloudflare's edge. The API Worker gives a
stable API hostname; only the tunnel origin is ephemeral (URL changes whenever
the tunnel restarts).

## One-command deploy / recovery

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

`deploy.ps1` performs, in order:
1. Start/reuse the backend from `backend/dist` (health-checked).
2. Start/reuse `cloudflared` tunnel and read the fresh `*.trycloudflare.com` URL.
3. Update `api-proxy/wrangler.jsonc` `API_ORIGIN` and deploy `speakio-api`.
4. Build the frontend with `NEXT_PUBLIC_API_URL=https://speakio-api.speakio.workers.dev` (`npm run cf:build`) and deploy `speakio-web`.

Run it after every machine reboot or tunnel drop. Nothing else needs manual wiring.

## Manual commands

| Task | Command |
|---|---|
| Backend build | `cd backend && npx nest build` |
| Backend run | `node dist/src/main.js` (port from `PORT`, default 4000; local `.env` uses 4040) |
| Frontend build | `npm run build` |
| Frontend Worker build+deploy | `npm run cf:build && npx wrangler deploy` |
| API proxy deploy | `cd api-proxy && npx wrangler deploy` |
| DB migrations | `cd backend && npx prisma migrate deploy` |
| Seed (accounts + demo) | `npx prisma db seed` |
| Seed free IELTS bank | `npx ts-node prisma/seed-free-bank.ts` (also part of `db seed`) |
| Backup | `powershell -File backend/scripts/backup.ps1` (pg_dump, 14-day retention) |
| Tests | `npm test` (root, Vitest), `npm --prefix backend test`, `npm --prefix backend run test:e2e` |

## Configuration

Secrets live in `.env` / `.env.local` (git-ignored). Worker variables:

- `speakio-web`: `NEXT_PUBLIC_API_URL` baked at build time (currently the API Worker).
- `speakio-api`: `API_ORIGIN` = current tunnel URL.
- Backend: `DATABASE_URL`, `JWT_SECRET`, `CF_AI_TOKEN` (Cloudflare API token used as `ZAI_API_KEY`), `FRONTEND_URL`, `COOKIE_SAMESITE=none` for cross-site auth cookies, optional `CF_EMAIL_API_TOKEN`/`CF_ACCOUNT_ID`/`CF_EMAIL_FROM` for password-reset email.
- AI provider: `ZAI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`, `ZAI_API_KEY=<CF token>`, all three `ZAI_MODEL_*` = `@cf/zai-org/glm-4.7-flash`, `ZAI_MODEL_ASR=@cf/openai/whisper-large-v3-turbo`. The `ZAI_*` names are kept as the provider contract; the transport is Cloudflare's OpenAI-compatible Workers AI endpoint. Reasoning models need ~8k `max_tokens` for structured JSON.

### Cloudflare database status (honest)

A D1 database `speakio-db` was provisioned on the account, but it is SQLite and
the application is PostgreSQL + Prisma (Postgres enums, partial indexes, raw
SQL migrations). It is **not wired into the app** — wiring it would be a real
port, not a config change. The live application database remains PostgreSQL.
A fully cloud-native backend additionally requires the Workers Paid plan
(Containers) plus a managed Postgres such as Neon (Hyperdrive or direct URL).

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
