"use client"

import { createContext, useContext } from "react"
import type { SessionUser } from "@/lib/session"

interface UserSessionContextValue {
  user: SessionUser
}

const UserSessionContext = createContext<UserSessionContextValue | null>(null)

/**
 * Fed exclusively by server layouts that verified the session against the API.
 * Client components must never trust locally-persisted auth state.
 */
export function UserSessionProvider({
  user,
  children,
}: {
  user: SessionUser
  children: React.ReactNode
}) {
  return <UserSessionContext.Provider value={{ user }}>{children}</UserSessionContext.Provider>
}

export function useSessionUser(): SessionUser {
  const ctx = useContext(UserSessionContext)
  if (!ctx) throw new Error("useSessionUser must be used within UserSessionProvider")
  return ctx.user
}
