"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  Headphones,
  BookOpen,
  FileText,
  Mic,
  Award,
  Target,
} from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { useSessionUser } from "@/components/user-session-provider"
import { apiFetch } from "@/lib/api-client"

interface DashboardStats {
  overallBand: number
  targetBand: number | null
  examDate: string | null
  weakestSkill: string | null
  perSkill: Partial<Record<"LISTENING" | "READING" | "WRITING" | "SPEAKING", number>>
  totals: {
    attempts: number
    completed: number
    certificates: number
    milestonesCompleted: number
    milestonesTotal: number
  }
  recentAttempts: Array<{
    id: string
    status: string
    title: string
    skill: string
    submittedAt: string | null
    bandScore: number | null
  }>
  activeCertificate: {
    id: string
    certificateNumber: string
    overallBand: number
  } | null
}

const SKILL_META: Record<string, { label: string; icon: React.ElementType; href: string }> = {
  LISTENING: { label: "Listening", icon: Headphones, href: "/skills/listening" },
  READING: { label: "Reading", icon: BookOpen, href: "/skills/reading" },
  WRITING: { label: "Writing", icon: FileText, href: "/skills/writing" },
  SPEAKING: { label: "Speaking", icon: Mic, href: "/skills/speaking" },
}

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  SCORING: "Scoring",
  NEEDS_REVIEW: "In review",
  COMPLETED: "Completed",
}

export default function DashboardPage() {
  const user = useSessionUser()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    const { data, error: fetchError } = await apiFetch<DashboardStats>("/dashboard/stats")
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load your dashboard.")
      setStats(null)
    } else {
      setStats(data)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Deferred to a microtask so the effect body never mutates state synchronously.
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchStats()
    })
    return () => {
      active = false
    }
  }, [fetchStats])

  const retry = () => {
    setLoading(true)
    void fetchStats()
  }

  const firstName = user.name.split(" ")[0]
  const hasAnyData =
    stats != null && (stats.totals.attempts > 0 || stats.totals.milestonesTotal > 0)

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
              Welcome back, {firstName}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Target: Band {(user.targetBand ?? 7.0).toFixed(1)}
              {stats?.examDate && (
                <>
                  {" · "}Exam{" "}
                  {new Date(stats.examDate).toLocaleDateString(undefined, { dateStyle: "medium" })}
                </>
              )}
            </p>
          </div>
          <ButtonLink className="cursor-pointer self-start sm:self-auto" href="/skills/listening">
              Start practising <ArrowRight className="ml-2 h-3.5 w-3.5" aria-hidden />
            </ButtonLink>
        </div>

        {loading && (
          <div className="space-y-4" role="status" aria-live="polite">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-border/40 animate-pulse" aria-hidden />
              ))}
            </div>
            <div className="h-64 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            <span className="sr-only">Loading dashboard…</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && !hasAnyData && (
          <div className="rounded-xl border border-border bg-card p-8 sm:p-12 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-none bg-primary/10 flex items-center justify-center">
              <Target className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Start your IELTS journey</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                You haven&apos;t taken any tests yet. Complete your first practice test to see your
                band scores, progress tracking and personalized feedback here.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <ButtonLink className="cursor-pointer" href="/skills/listening">
              Take a practice test
            </ButtonLink>
              <ButtonLink variant="outline" className="cursor-pointer" href="/study-plan">
              Build a study plan
            </ButtonLink>
            </div>
          </div>
        )}

        {!loading && !error && hasAnyData && stats && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Overall band</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                  {stats.overallBand > 0 ? stats.overallBand.toFixed(1) : "—"}
                </p>
                {stats.targetBand != null && stats.overallBand > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {stats.overallBand >= stats.targetBand
                      ? "Target reached"
                      : `${(stats.targetBand - stats.overallBand).toFixed(1)} to target`}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Tests taken</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums">{stats.totals.attempts}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {stats.totals.completed} completed
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Study plan</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                  {stats.totals.milestonesCompleted}/{stats.totals.milestonesTotal || "—"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">milestones done</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Certificates</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums">{stats.totals.certificates}</p>
                {stats.activeCertificate ? (
                  <Link href="/certificates" className="text-[11px] text-primary hover:underline mt-1 inline-flex items-center gap-0.5">
                    View <ArrowRight className="h-2.5 w-2.5" aria-hidden />
                  </Link>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-1">Complete all 4 skills</p>
                )}
              </div>
            </div>

            {/* Skill bands */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold mb-4">Skill breakdown</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(SKILL_META).map(([skill, meta]) => {
                  const band = stats.perSkill[skill as keyof typeof stats.perSkill]
                  const Icon = meta.icon
                  return (
                    <Link
                      key={skill}
                      href={meta.href}
                      className="flex items-center justify-between rounded-lg bg-surface-subtle border border-border px-3.5 py-3 hover:bg-card transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <div>
                          <p className="text-sm font-medium">{meta.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {band != null ? "Latest score" : "Not attempted yet"}
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {band != null ? band.toFixed(1) : "—"}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Recent attempts */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">Recent attempts</h2>
                {stats.recentAttempts.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">Latest {stats.recentAttempts.length}</span>
                )}
              </div>
              {stats.recentAttempts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No attempts yet — take your first practice test to see results here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {stats.recentAttempts.map((attempt) => (
                    <li key={attempt.id}>
                      <Link
                        href={`/results/${attempt.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg bg-surface-subtle border border-border px-3.5 py-3 hover:bg-card transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{attempt.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {SKILL_META[attempt.skill]?.label ?? attempt.skill}
                            {attempt.submittedAt && ` · ${new Date(attempt.submittedAt).toLocaleDateString()}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className={`rounded-none px-2 py-0.5 text-[10px] font-medium border ${
                              attempt.status === "COMPLETED"
                                ? "border-success/30 bg-success/10 text-success"
                                : attempt.status === "NEEDS_REVIEW" || attempt.status === "SCORING"
                                  ? "border-warning/30 bg-warning/10 text-warning"
                                  : "border-border bg-card text-muted-foreground"
                            }`}
                          >
                            {STATUS_LABEL[attempt.status] ?? attempt.status}
                          </span>
                          <span className="text-sm font-semibold tabular-nums w-8 text-right">
                            {attempt.bandScore != null ? attempt.bandScore.toFixed(1) : "—"}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Certificate CTA */}
            {stats.totals.certificates === 0 && stats.totals.completed > 0 && (
              <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Award className="h-5 w-5 text-primary mt-0.5" aria-hidden />
                  <div>
                    <p className="text-sm font-medium">Working towards your certificate</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Complete all four skills to issue a verifiable certificate.
                    </p>
                  </div>
                </div>
                <ButtonLink variant="outline" className="cursor-pointer self-start sm:self-auto" href="/certificates">
              View progress
            </ButtonLink>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
