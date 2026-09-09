"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  ArrowLeft,
  FileText,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"

interface AttemptResult {
  id: string
  status: "IN_PROGRESS" | "SUBMITTED" | "SCORING" | "NEEDS_REVIEW" | "COMPLETED"
  startedAt: string
  submittedAt: string | null
  testSet: {
    id: string
    title: string
    skill: "LISTENING" | "READING" | "WRITING" | "SPEAKING" | "FULL_MOCK"
    timeLimitMinutes: number
  }
  score: {
    bandScore: number
    skill: string
    taskAchievement: number | null
    coherenceCohesion: number | null
    lexicalResource: number | null
    grammaticalAccuracy: number | null
    feedbackSummary: string | null
    inlineFeedbackJson: unknown
    scoredBy: string
    confidence: number | null
    createdAt: string
  } | null
  answerText: string | null
}

interface AutoGradeDetail {
  perQuestion?: Array<{ questionId: string; given: string; correct: boolean; expected?: string }>
  correctCount?: number
  total?: number
}

export default function ResultPage() {
  const params = useParams<{ attemptId: string }>()
  const attemptId = params?.attemptId

  const [result, setResult] = useState<AttemptResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [rescoring, setRescoring] = useState(false)

  const fetchResult = useCallback(async () => {
    if (!attemptId) return
    const { data, error: fetchError } = await apiFetch<AttemptResult>(`/attempts/${attemptId}`)
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load the result.")
      setErrorStatus(fetchError?.status ?? 0)
      setResult(null)
    } else {
      setResult(data)
      setError(null)
      setErrorStatus(null)
    }
    setLoading(false)
  }, [attemptId])

  useEffect(() => {
    // Deferred to a microtask so the effect body never mutates state synchronously.
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchResult()
    })
    return () => {
      active = false
    }
  }, [fetchResult])

  const router = useRouter()
  const inProgress = result?.status === "IN_PROGRESS"

  useEffect(() => {
    if (inProgress && result) {
      router.replace(`/test/${result.testSet.id}/take`)
    }
  }, [inProgress, result, router])

  const retryFetch = () => {
    setLoading(true)
    void fetchResult()
  }

  const rescore = async () => {
    setRescoring(true)
    const { error: rescoreError } = await apiFetch(`/attempts/${attemptId}/rescore`, { method: "POST" })
    if (rescoreError) {
      setError(rescoreError.message)
      setErrorStatus(null)
    } else {
      await fetchResult()
    }
    setRescoring(false)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh] bg-surface-subtle" role="status" aria-live="polite">
        <div className="text-center space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" aria-hidden />
          <p className="text-sm text-muted-foreground">Loading your result…</p>
        </div>
      </div>
    )
  }

  if (errorStatus === 404 || errorStatus === 403) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh] bg-surface-subtle">
        <div className="text-center space-y-3 max-w-md">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden />
          <h1 className="text-xl font-semibold">Result not available</h1>
          <p className="text-sm text-muted-foreground">
            {errorStatus === 404
              ? "This attempt does not exist."
              : "You do not have permission to view this attempt."}
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (error || !result) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh] bg-surface-subtle">
        <div className="text-center space-y-3 max-w-md">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" aria-hidden />
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">{error ?? "An unexpected error occurred."}</p>
          <Button onClick={() => retryFetch()}>Retry</Button>
        </div>
      </div>
    )
  }

  const score = result.score
  const isWriting = result.testSet.skill === "WRITING"
  const autoDetail = (score?.inlineFeedbackJson ?? null) as AutoGradeDetail | null

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Dashboard
          </Link>
          <span className="text-[11px] text-muted-foreground truncate">{result.testSet.title}</span>
        </div>

        {inProgress && (
          <div className="rounded-xl border border-border bg-card p-5 flex items-start gap-3" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-primary mt-0.5" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold">Returning to your test…</h2>
              <p className="text-xs text-muted-foreground mt-1">
                This attempt is still in progress. Opening the exam page — your saved answers are
                restored there.
              </p>
            </div>
          </div>
        )}

        {result.status === "SCORING" && (
          <div className="rounded-xl border border-primary/20 bg-primary/10 p-5 flex items-start gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary mt-0.5" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-blue-900">Scoring in progress</h2>
              <p className="text-xs text-primary mt-1">
                The AI examiner is evaluating your submission. This page will show your band score
                once scoring completes.
              </p>
            </div>
          </div>
        )}

        {result.status === "SUBMITTED" && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-warning mt-0.5" aria-hidden />
              <div>
                <h2 className="text-sm font-semibold text-amber-900">Awaiting scoring</h2>
                <p className="text-xs text-warning mt-1">
                  Your submission was received but scoring did not complete. You can retry scoring
                  below — your answers are safely stored.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => void rescore()} disabled={rescoring} className="cursor-pointer">
              {rescoring ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> Retrying…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden /> Retry scoring
                </>
              )}
            </Button>
          </div>
        )}

        {result.status === "NEEDS_REVIEW" && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-5">
            <h2 className="text-sm font-semibold text-amber-900">Pending examiner review</h2>
            <p className="text-xs text-warning mt-1">
              {isWriting
                ? "The AI scorer flagged this submission for human verification. A certified examiner will confirm your band shortly."
                : "A certified examiner will evaluate your recorded response. Your band will appear here once review is complete."}
            </p>
          </div>
        )}

        {result.status === "COMPLETED" && !score && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-warning mt-0.5" aria-hidden />
              <div>
                <h2 className="text-sm font-semibold text-amber-900">Score unavailable</h2>
                <p className="text-xs text-warning mt-1">
                  This attempt is marked complete but no score was recorded. You can retry scoring
                  below, or contact support if the problem persists.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => void rescore()} disabled={rescoring} className="cursor-pointer">
              {rescoring ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> Retrying…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden /> Retry scoring
                </>
              )}
            </Button>
          </div>
        )}

        {result.status === "COMPLETED" && score && (
          <div className="space-y-4">
            {/* Band summary */}
            <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-lg font-semibold">Your result</h1>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {result.testSet.skill} ·{" "}
                    {result.submittedAt
                      ? new Date(result.submittedAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-4xl font-semibold tracking-tight text-primary tabular-nums">
                      {score.bandScore.toFixed(1)}
                    </div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                      Band score
                    </div>
                  </div>
                </div>
              </div>

              {autoDetail?.correctCount != null && autoDetail.total != null && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {autoDetail.correctCount} of {autoDetail.total} questions correct · graded automatically
                </p>
              )}

              {score.scoredBy === "INSTRUCTOR" && (
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-none border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                  Verified by examiner
                </p>
              )}
            </div>

            {/* Writing criteria breakdown */}
            {isWriting && score.taskAchievement != null && (
              <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-4">
                <h2 className="text-sm font-semibold">Criteria breakdown</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: "Task Achievement / Response", value: score.taskAchievement },
                    { label: "Coherence & Cohesion", value: score.coherenceCohesion },
                    { label: "Lexical Resource", value: score.lexicalResource },
                    { label: "Grammatical Range & Accuracy", value: score.grammaticalAccuracy },
                  ].map(
                    (c) =>
                      c.value != null && (
                        <div key={c.label} className="rounded-lg bg-surface-subtle border border-border p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{c.label}</span>
                            <span className="text-sm font-semibold tabular-nums">{c.value.toFixed(1)}</span>
                          </div>
                          <div className="mt-2 h-1.5 rounded-none bg-border overflow-hidden" aria-hidden>
                            <div
                              className="h-full rounded-none bg-primary"
                              style={{ width: `${(c.value / 9) * 100}%` }}
                            />
                          </div>
                        </div>
                      ),
                  )}
                </div>
                {score.feedbackSummary && (
                  <div className="pt-1">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Examiner summary
                    </h3>
                    <p className="text-sm leading-relaxed text-foreground/90">{score.feedbackSummary}</p>
                  </div>
                )}
              </div>
            )}

            {/* Auto-graded per-question review */}
            {autoDetail?.perQuestion && autoDetail.perQuestion.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-3">
                <h2 className="text-sm font-semibold">Question review</h2>
                <ul className="space-y-2">
                  {autoDetail.perQuestion.map((q, i) => (
                    <li
                      key={q.questionId}
                      className="flex items-start justify-between gap-3 rounded-lg bg-surface-subtle border border-border px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-medium">Question {i + 1}</span>
                        <p className="text-xs text-muted-foreground truncate">
                          Your answer: {q.given || "—"}
                          {!q.correct && q.expected ? ` · Correct: ${q.expected}` : ""}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-none px-2 py-0.5 text-[10px] font-medium border ${
                          q.correct
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-destructive/30 bg-destructive/10 text-destructive"
                        }`}
                      >
                        {q.correct ? "Correct" : "Incorrect"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Essay text */}
            {result.answerText && (
              <details className="rounded-xl border border-border bg-card p-5">
                <summary className="text-sm font-medium cursor-pointer flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                  View your submission
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                  {result.answerText.startsWith("data:") ? "Recorded audio response." : result.answerText}
                </p>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

