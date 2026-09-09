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
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSessionCookie = request.cookies.has("access_token")

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p === "/test" ? "/test/" : p}`),
  )

  if (isProtected && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated users skip the auth screens.
  if (hasSessionCookie && (pathname === "/login" || pathname === "/register")) {
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
    "/login",
    "/register",
  ],
}
