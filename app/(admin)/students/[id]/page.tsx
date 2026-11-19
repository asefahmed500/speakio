"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowLeft } from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"

interface StudentDetail {
  id: string
  email: string
  name: string
  status: "ACTIVE" | "SUSPENDED"
  targetBand: number | null
  examDate: string | null
  moduleType: string
  weakestSkill: string | null
  dailyCommitmentMinutes: number | null
  createdAt: string
  stats: {
    attemptsCount: number
    completedCount: number
    avgBand: number | null
    latestPerSkill: Record<string, number>
  }
  attempts: Array<{
    id: string
    status: string
    startedAt: string
    submittedAt: string | null
    testSet: { id: string; title: string; skill: string }
    scores: Array<{ bandScore: number; scoredBy: string; feedbackSummary: string | null }>
  }>
}

const SKILL_ORDER = ["LISTENING", "READING", "WRITING", "SPEAKING"] as const

const STATUS_TONE: Record<string, string> = {
  IN_PROGRESS: "border-primary/30 bg-primary/10 text-primary",
  SUBMITTED: "border-warning/30 bg-warning/10 text-warning",
  SCORING: "border-warning/30 bg-warning/10 text-warning",
  NEEDS_REVIEW: "border-warning/30 bg-warning/10 text-warning",
  COMPLETED: "border-success/30 bg-success/10 text-success",
}

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [studentId, setStudentId] = useState<string | null>(null)
  const [student, setStudent] = useState<StudentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void params.then((p) => setStudentId(p.id))
  }, [params])

  const fetchStudent = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await apiFetch<StudentDetail>(`/admin/students/${id}`)
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load this student.")
      setStudent(null)
    } else {
      setStudent(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Deferred to a microtask so the effect body never mutates state synchronously.
    if (!studentId) return
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchStudent(studentId)
    })
    return () => {
      active = false
    }
  }, [studentId, fetchStudent])

  if (!studentId || loading) {
    return (
      <div className="flex-1 bg-surface-subtle">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-3" role="status" aria-live="polite">
          <div className="h-24 rounded-xl bg-border/40 animate-pulse" aria-hidden />
          <div className="h-48 rounded-xl bg-border/40 animate-pulse" aria-hidden />
          <span className="sr-only">Loading student…</span>
        </div>
      </div>
    )
  }

  if (error || !student) {
    return (
      <div className="flex-1 bg-surface-subtle">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-4">
          <ButtonLink variant="outline" size="sm" href="/students" className="cursor-pointer">
            <ArrowLeft className="mr-2 h-3.5 w-3.5" aria-hidden /> All students
          </ButtonLink>
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error ?? "Student not found"}</p>
            {studentId && (
              <Button variant="outline" size="sm" onClick={() => void fetchStudent(studentId)}>
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <ButtonLink variant="outline" size="sm" href="/students" className="cursor-pointer">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" aria-hidden /> All students
        </ButtonLink>

        {/* Profile header */}
        <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{student.name}</h1>
              {student.status === "SUSPENDED" && (
                <span className="rounded-none border border-destructive/30 bg-destructive/10 text-destructive px-2 py-0.5 text-[10px]">
                  SUSPENDED
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{student.email}</p>
            <p className="text-xs text-muted-foreground">
              Joined {new Date(student.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              {student.examDate && (
                <> · Exam {new Date(student.examDate).toLocaleDateString(undefined, { dateStyle: "medium" })}</>
              )}
              {student.weakestSkill && <> · Focus: {student.weakestSkill}</>}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <MiniStat label="Attempts" value={String(student.stats.attemptsCount)} />
            <MiniStat label="Completed" value={String(student.stats.completedCount)} />
            <MiniStat
              label="Avg band"
              value={student.stats.avgBand != null ? student.stats.avgBand.toFixed(1) : "—"}
              highlight
            />
          </div>
        </div>

        {/* Latest band per skill */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SKILL_ORDER.map((skill) => {
            const band = student.stats.latestPerSkill[skill]
            const target = student.targetBand
            const meets = band != null && target != null && band >= target
            return (
              <div key={skill} className="rounded-xl border border-border bg-card p-4 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{skill}</p>
                <p className={`text-xl font-semibold tabular-nums ${band != null ? (meets ? "text-success" : "text-foreground") : "text-muted-foreground"}`}>
                  {band != null ? band.toFixed(1) : "—"}
                </p>
                {target != null && band != null && (
                  <p className={`text-[10px] ${meets ? "text-success" : "text-warning"}`}>
                    {meets ? "Target met" : `Target ${target.toFixed(1)}`}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Attempt history */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="text-sm font-semibold">Attempt history</h2>
          </div>
          {student.attempts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              This student has not started any tests yet.
            </p>
          ) : (
            <ul>
              {student.attempts.map((a) => {
                const score = a.scores[0]
                return (
                  <li key={a.id} className="px-5 py-3.5 border-b border-border/60 last:border-0 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{a.testSet.title}</span>
                        <span className={`rounded-none border px-1.5 py-0.5 text-[9px] ${STATUS_TONE[a.status] ?? "border-border bg-surface-subtle text-muted-foreground"}`}>
                          {a.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {a.testSet.skill} ·{" "}
                        {a.submittedAt
                          ? `submitted ${new Date(a.submittedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`
                          : `started ${new Date(a.startedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`}
                        {score && <> · graded by {score.scoredBy === "ADMIN_OVERRIDE" ? "admin" : score.scoredBy === "AUTO_GRADER" ? "auto-grader" : "AI"}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {score && (
                        <span className="text-sm font-semibold tabular-nums text-primary">
                          {score.bandScore.toFixed(1)}
                        </span>
                      )}
                      <Link
                        href={`/results/${a.id}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Details
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  )
}
