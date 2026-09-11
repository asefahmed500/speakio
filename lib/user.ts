/**
 * Server-safe session types and pure helpers. No `next/headers` here —
 * this module is importable from both server and client components.
 */

export interface SessionUser {
  id: string
  email: string
  name: string
  role: "STUDENT" | "INSTRUCTOR" | "ADMIN" | "SUPER_ADMIN"
  targetBand: number | null
  examDate: string | null
  moduleType: "ACADEMIC" | "GENERAL"
  subscriptionTier: string
  dailyCommitmentMinutes: number | null
  weakestSkill: string | null
  studyPlanJson: StudyPlanMilestone[] | null
  createdAt: string
}

export interface StudyPlanMilestone {
  id: string
  day: number
  title: string
  skill: "LISTENING" | "READING" | "WRITING" | "SPEAKING" | "MOCK"
  durationMinutes: number
  isCompleted: boolean
  taskDetails: string
}

export type SessionResult =
  | { status: "authenticated"; user: SessionUser }
  | { status: "unauthenticated" }
  | { status: "backend_unreachable" }

export function isStaff(role: SessionUser["role"]): boolean {
  return role === "INSTRUCTOR" || role === "ADMIN" || role === "SUPER_ADMIN"
}

export function isAdmin(role: SessionUser["role"]): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN"
}
