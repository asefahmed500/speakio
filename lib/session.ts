import { cookies } from "next/headers"
import { API_URL } from "@/lib/api-client"
import { isStaff, type SessionResult, type SessionUser } from "@/lib/user"

export type { SessionResult, SessionUser, StudyPlanMilestone } from "@/lib/user"
export { isStaff }

/**
 * Server-side session resolution. Verifies the httpOnly cookie against the
 * backend /auth/me endpoint — the client-side zustand store is never trusted.
 */
export async function getSessionUser(): Promise<SessionResult> {
  const cookieStore = await cookies()
  const token = cookieStore.get("access_token")?.value
  if (!token) return { status: "unauthenticated" }

  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Cookie: `access_token=${token}` },
      cache: "no-store",
    })
    if (res.status === 401) return { status: "unauthenticated" }
    if (!res.ok) return { status: "backend_unreachable" }
    const user = (await res.json()) as SessionUser
    return { status: "authenticated", user }
  } catch {
    return { status: "backend_unreachable" }
  }
}
