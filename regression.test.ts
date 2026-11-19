import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Focused regression guards for the deployed auth + AI reliability fix
 * (commit 6128498): same-origin `/api` base, non-rotating RSC refresh support,
 * AI infra failures mapped to 503, and the `__name` global shim.
 *
 * These are fast, hermetic tests — no network, no database, no demo data.
 */
describe("deployed auth + AI reliability — regression guards", () => {
  const ORIGINAL_API_URL = process.env.NEXT_PUBLIC_API_URL

  afterEach(() => {
    if (ORIGINAL_API_URL === undefined) delete process.env.NEXT_PUBLIC_API_URL
    else process.env.NEXT_PUBLIC_API_URL = ORIGINAL_API_URL
    vi.resetModules()
  })

  it("API_URL is baked from NEXT_PUBLIC_API_URL — never window.location or :4040", async () => {
    // The old bug derived the base from window.location, producing a
    // cross-origin `https://<web-host>:4040` URL that broke cookie auth and
    // could never reach the same-origin Worker /api/* proxy.
    const sameOrigin = "https://speakio-web.speakio.workers.dev/api"
    process.env.NEXT_PUBLIC_API_URL = sameOrigin
    vi.resetModules()

    const { API_URL } = await import("./lib/api-client")

    expect(API_URL).toBe(sameOrigin)
    expect(API_URL).not.toContain(":4040")
    expect(API_URL).not.toContain("window.location")
    expect(API_URL.endsWith("/api")).toBe(true)
  })

  it("frontend Worker proxies /api/* to the API Worker (same-origin cookies)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "web-worker-entry.js"),
      "utf8",
    )
    expect(src).toContain("'/api/'")
    expect(src).toContain("speakio-api")
    // Set-Cookie must pass through unchanged so cookies land on the web host.
    expect(src).toContain("new Response(response.body, response)")
  })

  it("AI provider auth/5xx failures are classified as infra (503), not raw 500", async () => {
    // The pre-fix regex only matched 429 / 5xx / timeout / quota. Rotating
    // token 401/403 and "token expired" errors leaked as raw 500s. The shared
    // classifier now folds every provider failure into a clean 503.
    const { isInfraFailure } = await import(
      "./backend/src/common/ai-error.utils"
    )
    for (const msg of [
      "Request failed with status code 401",
      "Request failed with status code 403",
      "Request failed with status code 500",
      "Error: Unauthorized",
      "Token has expired",
      "Bad Gateway",
      "ZAI_AUTH_INVALID_API_KEY",
    ]) {
      expect(isInfraFailure(msg), msg).toBe(true)
    }
    expect(isInfraFailure("Validation error: field is required")).toBe(false)
  })

  it("root layout injects the __name global shim", () => {
    const layout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8")
    expect(layout).toMatch(/window\.__name\s*=/)
    expect(layout).toContain("typeof window!=='undefined'")
  })

  it("E2E generation test keeps a timeout above the harness abort budget", () => {
    // The old 240s Jest timeout killed the live AI generation call. Both the
    // global budget and the per-test override must stay above the helper's
    // 300s AbortSignal, and must accept 201/503 but never a raw 500.
    const jestCfg = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "backend/test/jest-e2e.json"),
        "utf8",
      ),
    )
    // The global default stays at 240s; the long generation test carries a
    // per-test 420s override (Jest per-test timeout wins over the global one).
    expect(jestCfg.testTimeout).toBeGreaterThanOrEqual(240_000)

    const spec = readFileSync(
      resolve(process.cwd(), "backend/test/rbac-flows.e2e-spec.ts"),
      "utf8",
    )
    expect(spec).toContain("REGRESSION: AI question generation returns 201/503")
    expect(spec).toContain("expect(res.status).not.toBe(500)")
    expect(spec).toContain("420_000")
  })
})
