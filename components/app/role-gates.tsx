import { redirect } from "next/navigation"
import { getSessionUser, isAdmin } from "@/lib/session"

function ServiceUnavailable() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-xl font-semibold">Service unavailable</h1>
        <p className="text-sm text-muted-foreground">
          We could not verify your session because the Speakio service is not responding.
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </a>
      </div>
    </div>
  )
}

/**
 * Server-side role gate for ADMIN-only pages (mirrors the backend Roles guard
 * so privileged pages redirect instead of rendering a 403).
 */
export async function AdminGate({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser()
  if (session.status === "unauthenticated") redirect("/login")
  if (session.status === "backend_unreachable") return <ServiceUnavailable />
  if (!isAdmin(session.user.role)) redirect("/dashboard")
  return <>{children}</>
}
