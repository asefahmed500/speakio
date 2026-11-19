import { cookies } from "next/headers"
import { API_URL } from "@/lib/api-client"
import { isAdmin, type SessionResult, type SessionUser } from "@/lib/user"

export type { SessionResult, SessionUser, StudyPlanMilestone } from "@/lib/user"
export { isAdmin }

/**
 * Server-side session resolution. Verifies the httpOnly cookie against the
 * backend /auth/me endpoint — the client-side zustand store is never trusted.
 *
 * When the short-lived access token has expired, falls back to the backend
 * refresh endpoint (forwarding the refresh cookie) so RSC navigations survive
 * an expired access token instead of bouncing to /login.
 */
export async function getSessionUser(): Promise<SessionResult> {
  const cookieStore = await cookies()
  const token = cookieStore.get("access_token")?.value
  if (!token) return { status: "unauthenticated" }

  try {
    let res = await fetch(`${API_URL}/auth/me`, {
      headers: { Cookie: `access_token=${token}` },
      cache: "no-store",
    })

    if (res.status === 401) {
      const refreshToken = cookieStore.get("refresh_token")?.value
      if (refreshToken) {
        const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { Cookie: `refresh_token=${refreshToken}` },
          cache: "no-store",
        })
        if (refreshRes.ok) {
          // The rotated cookies ride back as Set-Cookie; pull the new access
          // token out for this request. (The browser picks the new cookies up
          // via its own direct /auth/refresh calls afterwards.)
          const setCookies =
            typeof refreshRes.headers.getSetCookie === "function"
              ? refreshRes.headers.getSetCookie()
              : []
          const accessCookie = setCookies.find((c) => c.startsWith("access_token="))
          const newToken = accessCookie
            ? accessCookie.split(";")[0].slice("access_token=".length)
            : null
          res = await fetch(`${API_URL}/auth/me`, {
            headers: { Cookie: `access_token=${newToken ?? token}` },
            cache: "no-store",
          })
        }
      }
    }

    if (res.status === 401) return { status: "unauthenticated" }
    if (!res.ok) return { status: "backend_unreachable" }
    const user = (await res.json()) as SessionUser
    return { status: "authenticated", user }
  } catch {
    return { status: "backend_unreachable" }
  }
}
