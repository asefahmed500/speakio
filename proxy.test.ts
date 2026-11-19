import { describe, it, expect } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { proxy, config } from "./proxy"

function request(path: string, cookieHeader?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  })
}

const follow = (res: NextResponse) => res.headers.get("location")

describe("proxy — optimistic role-based redirect gate", () => {
  it("redirects an anonymous visitor from a protected page to /login with next param", () => {
    const res = proxy(request("/dashboard"))
    expect(res.status).toBe(307)
    expect(follow(res)).toBe("http://localhost:3000/login?next=%2Fdashboard")
  })

  it("preserves deep paths and query strings in the next param", () => {
    const res = proxy(request("/results/some-attempt-id"))
    expect(follow(res)).toBe("http://localhost:3000/login?next=%2Fresults%2Fsome-attempt-id")
  })

  it("lets a refresh-only session through the optimistic gate (server layout refreshes)", () => {
    const res = proxy(request("/dashboard", "refresh_token=rt"))
    expect(res.status).toBe(200)
  })

  it("lets a full session through", () => {
    const res = proxy(request("/agent-ops", "access_token=at; refresh_token=rt"))
    expect(res.status).toBe(200)
  })

  it("redirects authenticated users away from /login to /dashboard", () => {
    const res = proxy(request("/login", "access_token=at"))
    expect(res.status).toBe(307)
    expect(follow(res)).toBe("http://localhost:3000/dashboard")
  })

  it("does NOT bounce a refresh-only visitor away from /login", () => {
    const res = proxy(request("/login", "refresh_token=rt"))
    expect(res.status).toBe(200)
  })

  it("redirects authenticated users away from /register", () => {
    const res = proxy(request("/register", "access_token=at"))
    expect(follow(res)).toBe("http://localhost:3000/dashboard")
  })

  it("never redirects the public landing page", () => {
    expect(proxy(request("/")).status).toBe(200)
  })

  it("never redirects the public verify page", () => {
    expect(proxy(request("/verify")).status).toBe(200)
  })

  it("covers every protected prefix in the matcher config", () => {
    const matcher = config.matcher
    const prefixes = ["/dashboard", "/study-plan", "/vocabulary", "/certificates", "/skills", "/results", "/test", "/agent-ops", "/review-queue"]
    for (const p of prefixes) {
      expect(matcher.some((m) => m === p || m.startsWith(p))).toBe(true)
    }
  })
})
