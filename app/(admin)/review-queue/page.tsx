"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowLeft, Check, Loader2 } from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api-client"

interface ReviewItem {
  id: string
  attemptId: string
  skill: "WRITING" | "SPEAKING" | "LISTENING" | "READING"
  status: string
  proposedBand: number | null
  instructorNotes: string | null
  createdAt: string
  attempt: {
    id: string
    answersJson: Record<string, string> | null
    user: { name: string; email: string }
    testSet: { title: string; skill: string }
  }
}

const BANDS = [5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0]

function extractAnswer(answersJson: Record<string, string> | null): { text: string | null; audio: string | null } {
  if (!answersJson) return { text: null, audio: null }
  let text: string | null = null
  let audio: string | null = null
  for (const value of Object.values(answersJson)) {
    if (typeof value !== "string" || !value) continue
    if (value.startsWith("data:audio")) audio = audio ?? value
    else text = text ?? value
  }
  return { text, audio }
}

export default function ReviewQueuePage() {
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedBand, setSelectedBand] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [resolvedInfo, setResolvedInfo] = useState<{ band: number; id: string } | null>(null)

  const fetchQueue = useCallback(async () => {
    const { data, error: fetchError } = await apiFetch<ReviewItem[]>("/scoring/review-queue")
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load the review queue.")
      setItems(null)
    } else {
      setItems(data)
      setSelectedBand(data[0]?.proposedBand ?? null)
      setNotes("")
      setResolvedInfo(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Deferred to a microtask so the effect body never mutates state synchronously.
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchQueue()
    })
    return () => {
      active = false
    }
  }, [fetchQueue])

  const retryFetch = () => {
    setLoading(true)
    void fetchQueue()
  }

  const current = items?.[0] ?? null
  const currentAnswer = current ? extractAnswer(current.attempt.answersJson) : { text: null, audio: null }

  const resolve = async (action: "APPROVE" | "OVERRIDE") => {
    if (!current) return
    const finalBand = action === "APPROVE" ? (current.proposedBand ?? selectedBand) : selectedBand
    if (finalBand == null) {
      setResolveError("Select a band score first.")
      return
    }
    setResolving(true)
    setResolveError(null)
    const { error: resolveErr } = await apiFetch(`/scoring/review-queue/${current.id}/resolve`, {
      method: "POST",
      json: { action, finalBand, instructorNotes: notes || undefined },
    })
    setResolving(false)
    if (resolveErr) {
      setResolveError(resolveErr.message)
      return
    }
    setResolvedInfo({ band: finalBand, id: current.attemptId })
    setItems((prev) => (prev ? prev.slice(1) : prev))
    setSelectedBand(items?.[1]?.proposedBand ?? null)
    setNotes("")
  }

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Review Queue</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {loading ? "Loading…" : `${items?.length ?? 0} pending`}
            </p>
          </div>
          <ButtonLink variant="outline" size="sm" className="cursor-pointer" href="/agent-ops">
              <ArrowLeft className="mr-2 h-3.5 w-3.5" aria-hidden /> Agent Ops
            </ButtonLink>
        </div>

        {loading && (
          <div className="space-y-3" role="status" aria-live="polite">
            <div className="h-40 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            <div className="h-24 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            <span className="sr-only">Loading queue…</span>
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

        {!loading && !error && resolvedInfo && (
          <div
            role="status"
            className="rounded-xl border border-success/30 bg-success/10 p-4 flex items-center gap-3"
          >
            <Check className="h-5 w-5 text-success shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-medium text-emerald-900">
                Band {resolvedInfo.band.toFixed(1)} recorded
              </p>
              <Link href={`/results/${resolvedInfo.id}`} className="text-xs text-success hover:underline">
                View the graded result
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && items && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center space-y-2">
            <h2 className="text-base font-semibold">Queue is clear</h2>
            <p className="text-sm text-muted-foreground">
              No submissions are waiting for examiner review.
            </p>
          </div>
        )}

        {!loading && current && (
          <div className="space-y-4">
            {/* Submission */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{current.attempt.user.name}</h2>
                  <p className="text-[11px] text-muted-foreground">
                    {current.attempt.testSet.title} · {current.skill}
                  </p>
                </div>
                <span className="rounded-none border border-warning/30 bg-warning/10 text-warning px-2 py-0.5 text-[10px] font-medium">
                  {current.skill === "SPEAKING" ? "Awaiting review" : `AI proposed ${current.proposedBand?.toFixed(1) ?? "—"}`}
                </span>
              </div>

              {currentAnswer.audio && (
                <audio controls src={currentAnswer.audio} className="w-full" />
              )}
              {currentAnswer.text && (
                <div className="rounded-lg bg-surface-subtle border border-border p-3.5 text-xs leading-relaxed whitespace-pre-line max-h-72 overflow-y-auto">
                  {currentAnswer.text}
                </div>
              )}
            </div>

            {/* Decision */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium mb-2">Final band</legend>
                <div className="grid grid-cols-5 sm:grid-cols-9 gap-1.5">
                  {BANDS.map((band) => (
                    <button
                      key={band}
                      type="button"
                      onClick={() => setSelectedBand(band)}
                      aria-pressed={selectedBand === band}
                      className={`rounded-lg py-2 text-xs font-medium border transition-colors cursor-pointer ${
                        selectedBand === band
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-surface-subtle hover:bg-card"
                      }`}
                    >
                      {band.toFixed(1)}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-1.5">
                <label htmlFor="rq-notes" className="text-xs font-medium">
                  Notes for the student (optional)
                </label>
                <Textarea
                  id="rq-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Brief feedback…"
                  className="min-h-[64px] text-sm"
                />
              </div>

              {resolveError && (
                <p role="alert" className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {resolveError}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void resolve("APPROVE")}
                  disabled={resolving || current.proposedBand == null}
                  title={current.proposedBand == null ? "No AI band to approve — use Override" : undefined}
                  className="cursor-pointer"
                >
                  {resolving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Approve {current.proposedBand != null ? current.proposedBand.toFixed(1) : ""}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void resolve("OVERRIDE")}
                  disabled={resolving || selectedBand == null}
                  className="cursor-pointer"
                >
                  Override to {selectedBand != null ? selectedBand.toFixed(1) : "—"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

