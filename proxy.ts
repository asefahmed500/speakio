import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Optimistic cookie-presence gate (Next.js 16 Proxy — formerly middleware).
 * Real authorization is enforced server-side in layouts and by the API.
 */

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
  // Optimistic gate: an expired access_token still pairs with a valid
  // refresh_token, and the server layouts call /auth/refresh on their own —
  // so either cookie is enough to reach the RSC layer, which decides for real.
  const hasSessionCookie =
    request.cookies.has("access_token") || request.cookies.has("refresh_token")

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )

  if (isProtected && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url)
    // Keep deep links intact — a filtered review list must survive the login.
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated users skip the auth screens. Only a live access_token
  // counts here: a refresh-only visitor still needs to (re)establish a
  // session through the login form rather than bounce between screens.
  if (
    request.cookies.has("access_token") &&
    (pathname === "/login" || pathname === "/register")
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
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
