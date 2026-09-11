import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/session"

/**
 * Server-side guard for the exam route group. Mirrors the student layout:
 * unauthenticated visitors are bounced before any exam page renders.
 */
export default async function ExamLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSessionUser()

  if (session.status === "unauthenticated") {
    redirect("/login")
  }
  if (session.status === "backend_unreachable") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Service unavailable</h1>
          <p className="text-sm text-muted-foreground">
            We could not verify your session because the Speakio service is not
            responding. Please try again in a moment.
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

  return <>{children}</>
}
