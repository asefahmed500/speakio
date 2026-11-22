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
} from "lucide-react"
import { Button } from "@/components/ui/button"
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

const SKILLS = [
  {
    key: "LISTENING",
    label: "Listening",
    icon: Headphones,
    href: "/skills/listening",
    desc: "4 sections · 40 audio questions",
  },
  {
    key: "READING",
    label: "Reading",
    icon: BookOpen,
    href: "/skills/reading",
    desc: "3 passages · 40 comprehension items",
  },
  {
    key: "WRITING",
    label: "Writing",
    icon: FileText,
    href: "/skills/writing",
    desc: "Task 1 (150w) & Task 2 (250w)",
  },
  {
    key: "SPEAKING",
    label: "Speaking",
    icon: Mic,
    href: "/skills/speaking",
    desc: "Parts 1, 2 & 3 examiner interview",
  },
]

export default function DashboardPage() {
  const user = useSessionUser()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    const { data, error: fetchError } = await apiFetch<DashboardStats>("/dashboard/stats")
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load dashboard data.")
      setStats(null)
    } else {
      setStats(data)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchStats()
    })
    return () => {
      active = false
    }
  }, [fetchStats])

  const firstName = user.name.split(" ")[0]
  const targetBand = user.targetBand ?? 7.0

  return (
    <div className="flex-1 bg-background text-foreground min-h-0">
      <div className="mx-auto w-full px-4 sm:px-6 py-8 space-y-6">
        {/* Simple Clean Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Candidate Dashboard
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Welcome back, {firstName} · Target Band {targetBand.toFixed(1)}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link
              href="/skills/listening"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white text-black px-4 py-2 text-xs font-semibold hover:bg-neutral-200 transition-colors"
            >
              Start Practice <ArrowRight className="size-3.5" />
            </Link>
            <Link
              href="/study-plan"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-subtle text-foreground px-3.5 py-2 text-xs font-medium hover:bg-card transition-colors"
            >
              Study Plan
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 flex items-center justify-between text-xs text-red-600">
            <span className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true)
                void fetchStats()
              }}
              className="h-7 text-xs border-border bg-card text-foreground hover:bg-white/20"
            >
              Retry
            </Button>
          </div>
        )}

        {/* 3 Metric Pills */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-surface-subtle p-4 text-center">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Overall Band</p>
            <p className="text-2xl font-bold font-mono text-black mt-1">
              {stats?.overallBand && stats.overallBand > 0 ? stats.overallBand.toFixed(1) : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-subtle p-4 text-center">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Tests Completed</p>
            <p className="text-2xl font-bold font-mono text-foreground mt-1">
              {stats?.totals.completed ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-subtle p-4 text-center">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Target Goal</p>
            <p className="text-2xl font-bold font-mono text-black mt-1">
              {targetBand.toFixed(1)}
            </p>
          </div>
        </div>

        {/* 4 Clean Skill Cards */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Practice Modules</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SKILLS.map((skill) => {
              const Icon = skill.icon
              const score = stats?.perSkill[skill.key as keyof typeof stats.perSkill]
              return (
                <Link
                  key={skill.key}
                  href={skill.href}
                  className="rounded-xl border border-border bg-surface-subtle hover:bg-white/[0.06] hover:border-border transition-all p-4 flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{skill.label}</h3>
                      <p className="text-[11px] text-muted-foreground">{skill.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded border border-border bg-surface-subtle text-muted-foreground">
                      {score != null && score > 0 ? `Band ${score.toFixed(1)}` : "Not taken"}
                    </span>
                    <ArrowRight className="size-4 text-foreground/30 group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Recent Attempts */}
        <div className="rounded-xl border border-border bg-surface-subtle p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent Attempts</h2>
            <Link href="/results" className="text-xs text-muted-foreground hover:text-foreground">
              View all results
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2 py-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-surface-subtle border border-border animate-pulse" />
              ))}
            </div>
          ) : !stats?.recentAttempts || stats.recentAttempts.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              No tests completed yet. Select a practice module above to start.
            </div>
          ) : (
            <div className="space-y-2">
              {stats.recentAttempts.slice(0, 5).map((attempt) => (
                <Link
                  key={attempt.id}
                  href={`/results/${attempt.id}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-subtle hover:bg-surface-subtle p-3 text-xs transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{attempt.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {attempt.skill}
                      {attempt.submittedAt && ` · ${new Date(attempt.submittedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded border border-border text-muted-foreground">
                      {attempt.status}
                    </span>
                    <span className="font-mono font-semibold text-black">
                      {attempt.bandScore != null ? attempt.bandScore.toFixed(1) : "—"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
