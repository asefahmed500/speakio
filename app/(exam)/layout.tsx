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

  return <>{children}</>
}
