# Speakio — IELTS Prep & AI Band Scoring

Speakio is a role-based web platform for complete IELTS Academic preparation — **Listening, Reading, Writing, Speaking** — with a real exam-day test engine, **AI band scoring** through an agent orchestration layer, progress analytics, and **verifiable participation certificates** with a public verification page.

> Practice with honest band scores, not guesswork. Every certificate is publicly verifiable.

---

## Features

### Student
- **Skill practice** — Listening, Reading, Writing and Speaking modules with real seeded test sets
- **Exam engine** — timed sections with a *server-authoritative* clock, autosave/draft restore, word-count gates for essays, in-browser audio recording for speaking
- **AI band scoring** — essays are graded against the four official IELTS criteria (Task Achievement, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy) with per-criterion bands, an overall band and examiner-style feedback
- **AI agent review** — low-confidence first passes automatically trigger an independent second AI pass; the combined result publishes with no human in the loop
- **Dashboard** — overall band, per-skill progress, attempt history and empty-state onboarding
- **Study planner** — exam date, daily commitment, weakest-skill focus; plan persists to your account
- **Vocabulary studio** — save words with topic, collocations and synonyms
- **Certificates** — issued on milestone completion, each with a unique verification code and a public lookup page (`/verify`)

### Admin
- **AI Review Monitor** — audit trail of every automated band decision, with admin override where needed
- **Agent Ops dashboard** — live view of every AI agent run (queued / running / done / failed), confidence, token cost, latency, one-click retry

### Platform
- **Agent orchestration layer** — every AI operation (scoring, triage, review) runs as a registered agent job with logging, retries, confidence gating and cost tracking
- **Role-based access** — exactly two roles, `USER` and `ADMIN`, enforced by JWT guards on the API **and** server-side route protection in Next.js; role or suspension changes take effect immediately (session revocation + guard cache invalidation)
- **Public verification** — no login required; revoked certificates are flagged publicly

---

## Tech Stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui (Base UI), Zustand, react-hook-form + Zod |
| Backend | NestJS, TypeScript, Zod validation pipes |
| Database | PostgreSQL + Prisma ORM |
| AI | Cloudflare Workers AI (free GLM-4.7 reasoning + Llama-3.3-70b fast) — LangGraph scoring agents |
| Auth | JWT in httpOnly cookies (`secure` in production, `sameSite: lax`) |

### Design system
Sharp, editorial, **zero border-radius** across every component — cream/off-white surfaces (`#FAF9F4`) with gray-white cards, a single navy accent (`#2B4C7E`), semantic status tokens (`success`, `warning`, `destructive`) and the Speakio "speech equalizer" vector logo.

---

## Project Structure

```text
speakio/
├── app/                    # Next.js App Router
│   ├── page.tsx            # Landing (hero → skills → pipeline → calculator → verification → FAQ → CTA)
│   ├── (auth)/             # login / register — shared AuthShell, RHF + Zod
│   ├── (student)/          # dashboard, skills, study-plan, vocabulary, certificates, results
│   ├── (exam)/             # test-taking engine (server timer + autosave)
│   ├── (admin)/            # agent-ops, review-queue (server-side staff gate)
│   └── verify/             # public certificate lookup + result pages
├── components/
│   ├── ui/                 # shadcn/ui primitives
│   ├── landing/            # marketing sections
│   ├── auth/               # AuthShell (shared chrome)
│   └── logo.tsx            # Speakio vector mark
├── stores/                 # Zustand stores (exam draft, auth UI)
├── lib/                    # api-client, session, zod validation schemas
├── proxy.ts                # Next.js 16 proxy (optimistic cookie gate)
└── backend/
    ├── src/                # NestJS modules: auth, tests, attempts, scoring,
    │                       # agents (tool registry), ai, certificates,
    │                       # dashboard, users, vocabulary
    └── prisma/             # schema + additive SQL migrations + seed
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 14+

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, ZAI_API_KEY
npx prisma migrate dev      # apply migrations
npx prisma db seed          # seed IELTS test content (no demo accounts)
npm run start:dev           # http://localhost:4000
```

Health check: `GET http://localhost:4000/health` → `{"status":"ok","database":"up",…}`

### 2. Frontend

```bash
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:4040 for local backend
npm run dev                 # http://localhost:3000
```

### Environment variables

**Frontend (`.env.local`)**
| Key | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL (`http://localhost:4040` locally; the same-origin `/api` path in production) |

**Backend (`.env`)**
| Key | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | At least 32 random characters |
| `JWT_EXPIRES_IN` | Access-token TTL (default `15m`) |
| `ZAI_API_KEY` / `ZAI_BASE_URL` | Cloudflare Workers AI access (OpenAI-compatible endpoint) |
| `FRONTEND_URL` | Comma-separated CORS origins |

> Never commit real `.env` files — both are git-ignored; only `.env.example` placeholders are tracked.

---

## Scripts

| Where | Command | Purpose |
|---|---|---|
| root | `npm run dev` / `build` / `start` | Next.js dev / prod build / prod server |
| root | `npm run typecheck` / `lint` | TypeScript + ESLint (zero-warning policy) |
| backend | `npm run start:dev` | NestJS with watch mode |
| backend | `npm test` | Jest unit tests |
| backend | `npx prisma migrate dev` | Apply migrations |

---

## Verification & Quality Gates

- **TypeScript**: strict, `tsc --noEmit` clean on both apps
- **ESLint**: 0 errors / 0 warnings (React Compiler rules enabled)
- **Auth**: ownership enforced server-side (`getOwnedAttempt`), role guards on every protected controller, optimistic cookie gate in `proxy.ts`
- **Data**: additive-only SQL migrations; unique partial index guarantees at most one ACTIVE certificate per user

---

## License

Private project — © Asef Ahmed. All rights reserved.
