import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Optimistic cookie-presence gate (Next.js 16 Proxy — formerly middleware).
 * Real authorization is enforced server-side in layouts and by the API.
 */

/**
 * Decode only the `exp` claim so the edge gate can tell a live access token
 * from an expired one. Signature verification stays server-side; a malformed
 * or opaque token keeps the previous optimistic behaviour.
 */
function accessTokenIsFresh(token: string | undefined): boolean {
  if (!token) return false
  const parts = token.split(".")
  if (parts.length !== 3) return true
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const payload = JSON.parse(atob(base64)) as { exp?: number }
    if (typeof payload.exp !== "number") return true
    return payload.exp > Math.floor(Date.now() / 1000) + 30
  } catch {
    return true
  }
}

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/study-plan",
  "/vocabulary",
  "/certificates",
  "/skills",
  "/results",
  "/test",
  "/agent-ops",
  "/review-queue",
  "/overview",
  "/users",
  "/question-bank",
  "/students",
  "/profile",
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const accessToken = request.cookies.get("access_token")?.value
  // Optimistic gate: an expired access_token still pairs with a valid
  // refresh_token, and the server layouts call /auth/refresh on their own —
  // so either cookie is enough to reach the RSC layer, which decides for real.
  const hasSessionCookie = Boolean(accessToken) || request.cookies.has("refresh_token")

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )

  if (isProtected && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url)
    // Keep deep links intact — a filtered review list must survive the login.
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated users skip the auth screens. Only a *fresh* access_token
  // counts: an expired token that the server rejected used to bounce
  // /login -> /dashboard -> /login forever. A one-shot guard absorbs that
  // bounce: consuming it is enough to land on /login, because the login page
  // never redirects back to a protected route on its own. The auth cookies
  // are deliberately LEFT INTACT — a user with a valid session who revisits
  // /login within the guard's TTL must not be silently logged out; stale
  // cookies are harmless here (the server layouts re-check every request),
  // and a fresh login overwrites them.
  if (pathname === "/login" || pathname === "/register") {
    if (request.cookies.has("auth_redirect_guard")) {
      const response = NextResponse.next()
      response.cookies.delete("auth_redirect_guard")
      return response
    }
    if (accessTokenIsFresh(accessToken)) {
      const response = NextResponse.redirect(new URL("/dashboard", request.url))
      response.cookies.set("auth_redirect_guard", "1", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Only needs to survive the single /login -> /dashboard -> /login
        // bounce; a short TTL bounds how long a deliberate revisit to the
        // login screen is treated as a server-induced bounce.
        maxAge: 10,
      })
      return response
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/study-plan",
    "/vocabulary",
    "/certificates/:path*",
    "/skills/:path*",
    "/results/:path*",
    "/test/:path*",
    "/agent-ops",
    "/review-queue",
    "/overview",
    "/users/:path*",
    "/question-bank",
    "/students/:path*",
    "/profile",
    "/login",
    "/register",
  ],
}
