"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, BookOpen, FileText, Headphones, Mic } from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api-client"

interface TestSetSummary {
  id: string
  title: string
  skill: string
  moduleType: string
  timeLimitMinutes: number
  isMock: boolean
  questionCount: number
}

interface SkillSummary {
  latestBand: number | null
  attemptsCount: number
  attempts: Array<{
    id: string
    title: string
    status: string
    submittedAt: string | null
    bandScore: number | null
  }>
  bandHistory: Array<{ band: number; date: string }>
}

export type SkillKey = "LISTENING" | "READING" | "WRITING" | "SPEAKING"

const SKILL_CONFIG: Record<
  SkillKey,
  {
    title: string
    description: string
    cta: string
    icon: React.ElementType
    /** Shows a supplementary note for skills with special grading. */
    note?: string
  }
> = {
  LISTENING: {
    title: "Listening",
    description:
      "Practice sets graded automatically against official-style marking. Answer every question, then submit to see your band instantly.",
    cta: "Start listening test",
    icon: Headphones,
  },
  READING: {
    title: "Reading",
    description:
      "Timed reading passages with automatic scoring. Correct answers and explanations are revealed after submission.",
    cta: "Start reading test",
    icon: BookOpen,
  },
  WRITING: {
    title: "Writing",
    description:
      "Task 1 and Task 2 essays evaluated by the AI examiner against all four official IELTS criteria. Borderline scores go to a human examiner.",
    cta: "Write essay",
    icon: FileText,
    note: "Requires a minimum of 20 words per essay. The AI examiner usually returns your band within a couple of minutes.",
  },
  SPEAKING: {
    title: "Speaking",
    description:
      "Record your response to cue-card prompts using your microphone. Certified examiners review recordings and publish your band.",
    cta: "Record response",
    icon: Mic,
    note: "Your recording is uploaded securely and reviewed by a certified examiner.",
  },
}

export function SkillTestsPage({ skill }: { skill: SkillKey }) {
  const config = SKILL_CONFIG[skill]
  const Icon = config.icon

  const [tests, setTests] = useState<TestSetSummary[] | null>(null)
  const [summary, setSummary] = useState<SkillSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSkillData = useCallback(async () => {
    const [testsResult, summaryResult] = await Promise.all([
      apiFetch<TestSetSummary[]>(`/tests?skill=${skill}`),
      apiFetch<SkillSummary>(`/dashboard/skills/${skill}`),
    ])
    if (testsResult.error || !testsResult.data) {
      setError(testsResult.error?.message ?? "Failed to load practice tests.")
      setTests(null)
    } else {
      // Draft/empty test sets (0 questions) are not takeable — never list them.
      setTests(testsResult.data.filter((t) => t.questionCount > 0))
      setError(null)
    }
    if (!summaryResult.error && summaryResult.data) {
      setSummary(summaryResult.data)
    }
    setLoading(false)
  }, [skill])

  useEffect(() => {
    // Deferred to a microtask so the effect body never mutates state synchronously.
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchSkillData()
    })
    return () => {
      active = false
    }
  }, [fetchSkillData])

  const retryFetch = () => {
    setLoading(true)
    void fetchSkillData()
  }

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{config.title}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{config.description}</p>
          </div>
        </div>

        {/* Personal stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Latest band</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {loading ? "…" : summary?.latestBand != null ? summary.latestBand.toFixed(1) : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Attempts</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {loading ? "…" : (summary?.attemptsCount ?? 0)}
            </p>
          </div>
        </div>

        {config.note && (
          <p className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs text-muted-foreground">
            {config.note}
          </p>
        )}

        {loading && (
          <div className="space-y-3" role="status" aria-live="polite">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <span className="sr-only">Loading tests…</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => retryFetch()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && tests && tests.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center space-y-2">
            <h2 className="text-base font-semibold">No practice tests available yet</h2>
            <p className="text-sm text-muted-foreground">
              New {config.title.toLowerCase()} tests are being prepared. Check back soon.
            </p>
          </div>
        )}

        {!loading && !error && tests && tests.length > 0 && (
          <ul className="space-y-3">
            {tests.map((test) => (
              <li
                key={test.id}
                className="rounded-xl border border-border bg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold truncate">{test.title}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {test.questionCount} {test.questionCount === 1 ? "question" : "questions"} ·{" "}
                    {test.timeLimitMinutes} min · {test.moduleType}
                  </p>
                </div>
                <ButtonLink size="sm" className="cursor-pointer self-start sm:self-auto shrink-0" href={`/test/${test.id}/take`}>
                  {config.cta} <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}

        {/* Attempt history */}
        {!loading && summary && summary.attempts.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold mb-3">Recent {config.title.toLowerCase()} attempts</h2>
            <ul className="space-y-2">
              {summary.attempts.slice(0, 5).map((attempt) => (
                <li key={attempt.id}>
                  <Link
                    href={`/results/${attempt.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-subtle border border-border px-3.5 py-2.5 hover:bg-card transition-colors"
                  >
                    <span className="text-xs font-medium truncate">{attempt.title}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {attempt.submittedAt && (
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(attempt.submittedAt).toLocaleDateString()}
                        </span>
                      )}
                      <span className="text-xs font-semibold tabular-nums">
                        {attempt.bandScore != null ? attempt.bandScore.toFixed(1) : "—"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

