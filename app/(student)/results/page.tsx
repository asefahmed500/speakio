"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"

interface AttemptRow {
  id: string
  status: "IN_PROGRESS" | "SUBMITTED" | "SCORING" | "NEEDS_REVIEW" | "COMPLETED"
  testSet: { id: string; title: string; skill: string; timeLimitMinutes: number }
  startedAt: string
  submittedAt: string | null
  bandScore: number | null
}

// Monochrome status tones — the label carries the meaning, not a hue.
const STATUS_TONE: Record<AttemptRow["status"], string> = {
  IN_PROGRESS: "border-black/15 bg-white text-black/60",
  SUBMITTED: "border-black/20 bg-[#fafafa] text-black/70",
  SCORING: "border-black/15 bg-white text-black animate-pulse",
  NEEDS_REVIEW: "border-black/20 bg-[#fafafa] text-black/70",
  COMPLETED: "border-black bg-black text-white",
}

const STATUS_LABEL: Record<AttemptRow["status"], string> = {
  IN_PROGRESS: "In Progress",
  SUBMITTED: "Awaiting AI Review",
  SCORING: "AI Evaluating",
  NEEDS_REVIEW: "Senior Re-evaluation",
  COMPLETED: "Official Scorecard Ready",
}

function rowAction(a: AttemptRow): { href: string; label: string } {
  if (a.status === "IN_PROGRESS") {
    return { href: `/test/${a.testSet.id}/take`, label: "Resume Test" }
  }
  return { href: `/results/${a.id}`, label: "View TRF Scorecard" }
}

export default function ResultsIndexPage() {
  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAttempts = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setError(null)
    const { data, error: fetchError } = await apiFetch<AttemptRow[]>("/attempts")
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load your results.")
      setAttempts(null)
    } else {
      setAttempts(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchAttempts(true)
    })
    return () => {
      active = false
    }
  }, [fetchAttempts])

  // Poll only while a submission is awaiting/publishing a band, so SCORING
  // rows update without a manual reload.
  const hasPending = attempts?.some(
    (a) => a.status === "SCORING" || a.status === "SUBMITTED" || a.status === "NEEDS_REVIEW"
  ) ?? false
  useEffect(() => {
    if (!hasPending) return
    const id = setInterval(() => void fetchAttempts(), 8_000)
    return () => clearInterval(id)
  }, [hasPending, fetchAttempts])

  return (
    <div className="flex-1 bg-background text-foreground min-h-0 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute -top-40 right-1/4 h-96 w-96 rounded-full bg-muted blur-[120px]" />
      <div className="pointer-events-none absolute top-1/3 -left-20 h-96 w-96 rounded-full bg-black/5 blur-[140px]" />

      <div className="relative w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#fafafa] px-3 py-1 text-xs font-mono uppercase tracking-widest text-black/60 mb-3">
              Official IELTS Record Vault
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              My Examination Records
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every simulated test attempt across all 4 skills with AI diagnostic band scores and TRF breakdowns.
            </p>
          </div>
          <Link
            href="/skills/listening"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white text-black px-4 py-2 text-xs font-semibold hover:bg-white/90 transition-all shrink-0 shadow-lg shadow-white/5"
          >
            Take New Practice Test <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {error && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center space-y-3 backdrop-blur-md">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchAttempts(true)}>
              Retry
            </Button>
          </div>
        )}

        {loading && !attempts && (
          <div className="space-y-3" role="status" aria-live="polite">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-surface-subtle border border-border animate-pulse" aria-hidden />
            ))}
            <span className="sr-only">Loading results…</span>
          </div>
        )}

        {!loading && attempts && attempts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-surface-subtle p-12 text-center space-y-4 backdrop-blur-md">
            <div className="h-12 w-12 rounded-full bg-surface-subtle border border-border flex items-center justify-center mx-auto text-muted-foreground">
              <ArrowRight className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">No attempts recorded yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Complete an authentic IELTS computer-delivered mock test to unlock AI diagnostic analytics and criteria scorecards.
            </p>
            <Link
              href="/skills/listening"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-white/15 transition-all"
            >
              Select Skill and Start Practice
            </Link>
          </div>
        )}

        {attempts && attempts.length > 0 && (
          <div className="space-y-3">
            {attempts.map((a) => {
              const action = rowAction(a)
              return (
                <div
                  key={a.id}
                  className="rounded-2xl border border-border bg-surface-subtle hover:bg-white/[0.06] hover:border-border transition-all p-5 flex flex-wrap items-center justify-between gap-4 backdrop-blur-md group"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-sm font-semibold text-foreground group-hover:text-foreground transition-colors truncate max-w-xs sm:max-w-md">
                        {a.testSet.title}
                      </span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${STATUS_TONE[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-muted-foreground uppercase tracking-wider text-[11px]">{a.testSet.skill}</span>
                      <span>·</span>
                      <span>
                        {a.submittedAt
                          ? `Submitted on ${new Date(a.submittedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                          : `Started on ${new Date(a.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-5 shrink-0">
                    {a.bandScore != null && (
                      <div className="text-right">
                        <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">IELTS Band</div>
                        <div className="text-2xl font-bold font-mono tabular-nums text-black">
                          {a.bandScore.toFixed(1)}
                        </div>
                      </div>
                    )}
                    <Link
                      href={action.href}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-subtle hover:bg-white/15 px-3.5 py-2 text-xs font-semibold text-foreground transition-all shadow-sm"
                    >
                      {action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {loading && attempts && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>
    </div>
  )
}
