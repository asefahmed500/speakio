"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AlertCircle, Loader2 } from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api-client"
import { TabStrip } from "@/components/app/page-container"

interface ReviewItem {
  id: string
  attemptId: string
  skill: "WRITING" | "SPEAKING" | "LISTENING" | "READING"
  status: string
  proposedBand: number | null
  finalBand: number | null
  instructorNotes: string | null
  createdAt: string
  reviewedAt: string | null
  attempt: {
    id: string
    user: { name: string; email: string }
    testSet: { title: string; skill: string }
  }
}

const BANDS = [4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0]

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "AI_APPROVED", label: "AI approved" },
  { value: "AI_ESCALATED", label: "Escalated" },
  { value: "OVERRIDDEN", label: "Overridden" },
] as const

const STATUS_BADGE: Record<string, string> = {
  AI_APPROVED: "border-success/30 bg-success/10 text-success",
  AI_ESCALATED: "border-warning/30 bg-warning/10 text-warning",
  OVERRIDDEN: "border-primary/30 bg-primary/10 text-primary",
  APPROVED: "border-success/30 bg-success/10 text-success",
  PENDING: "border-warning/30 bg-warning/10 text-warning",
}

const STATUS_LABEL: Record<string, string> = {
  AI_APPROVED: "AI approved",
  AI_ESCALATED: "AI escalated",
  OVERRIDDEN: "Admin override",
  APPROVED: "Approved",
  PENDING: "Legacy pending",
}

export default function AiReviewMonitorPage() {
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusTab, setStatusTab] = useState<string>("")
  const [notice, setNotice] = useState<string | null>(null)

  const [overriding, setOverriding] = useState<ReviewItem | null>(null)
  const [overrideBand, setOverrideBand] = useState<number | null>(null)
  const [overrideNotes, setOverrideNotes] = useState("")
  const [overrideBusy, setOverrideBusy] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const overrideDialogRef = useRef<HTMLDivElement | null>(null)

  // Focus the dialog when it opens so keyboard users land inside it.
  useEffect(() => {
    if (overriding) overrideDialogRef.current?.focus()
  }, [overriding != null]) // eslint-disable-line react-hooks/exhaustive-deps -- boolean gate only

  const fetchSeqRef = React.useRef(0)

  const fetchQueue = useCallback(async (tab: string) => {
    const seq = ++fetchSeqRef.current
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await apiFetch<ReviewItem[]>(
      `/scoring/review-queue${tab ? `?status=${tab}` : ""}`,
    )
    // A newer request (tab switch / refresh) supersedes this response.
    if (seq !== fetchSeqRef.current) return
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load the AI review trail.")
      setItems(null)
    } else {
      setItems(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchQueue("")
    })
    return () => {
      active = false
    }
  }, [fetchQueue])

  const switchTab = (tab: string) => {
    setStatusTab(tab)
    void fetchQueue(tab)
  }

  const submitOverride = async () => {
    if (!overriding || overrideBand == null) {
      setOverrideError("Select a band first.")
      return
    }
    setOverrideBusy(true)
    setOverrideError(null)
    const { error: overrideErr } = await apiFetch(
      `/scoring/review-queue/${overriding.id}/override`,
      {
        method: "POST",
        json: { finalBand: overrideBand, instructorNotes: overrideNotes || undefined },
      },
    )
    setOverrideBusy(false)
    if (overrideErr) {
      setOverrideError(overrideErr.message)
      return
    }
    setNotice(`Override recorded: ${overriding.attempt.user.name} → Band ${overrideBand.toFixed(1)}`)
    setOverriding(null)
    setOverrideNotes("")
    setOverrideBand(null)
    void fetchQueue(statusTab)
  }

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">AI Reviews</h1>
          </div>
          <ButtonLink variant="outline" size="sm" className="cursor-pointer" href="/agent-ops">
            Agent Ops
          </ButtonLink>
        </div>

        {notice && (
          <div role="status" className="rounded-lg border border-success/30 bg-success/10 text-xs px-3 py-2.5 text-emerald-900 flex items-center gap-2">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchQueue(statusTab)}>
              Retry
            </Button>
          </div>
        )}

        <TabStrip label="Review status filter" value={statusTab} onChange={switchTab} tabs={STATUS_TABS} />

        {loading && !items && (
          <div className="space-y-2" role="status" aria-live="polite">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            ))}
            <span className="sr-only">Loading review trail…</span>
          </div>
        )}

        {!loading && items && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <h2 className="text-base font-semibold">No AI reviews yet</h2>
          </div>
        )}

        {items && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.attempt.user.name}</span>
                      <span className={`rounded-none border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[item.status] ?? "border-border bg-surface-subtle text-muted-foreground"}`}>
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {item.attempt.testSet.title} · {item.skill}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm tabular-nums">
                    {item.proposedBand != null && (
                      <span className="text-muted-foreground text-xs">AI {item.proposedBand.toFixed(1)}</span>
                    )}
                    {item.finalBand != null && (
                      <span className="font-semibold text-primary">{item.finalBand.toFixed(1)}</span>
                    )}
                  </div>
                </div>

                {item.instructorNotes && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-3">
                    {item.instructorNotes}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <Link href={`/results/${item.attemptId}`} className="text-xs font-medium text-primary hover:underline">
                    View result
                  </Link>
                  {item.status !== "OVERRIDDEN" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer gap-1.5"
                      onClick={() => {
                        setOverriding(item)
                        setOverrideBand(item.finalBand ?? item.proposedBand)
                        setOverrideNotes("")
                        setOverrideError(null)
                      }}
                    >
                      Override
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {loading && items && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>

      {/* Override modal (inline panel) */}
      {overriding && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Override AI band"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOverriding(null)
          }}
        >
          <div
            ref={overrideDialogRef}
            tabIndex={-1}
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4 outline-none"
          >
            <div>
              <h2 className="text-sm font-semibold">Override AI band</h2>
              <p className="text-xs text-muted-foreground mt-1">
                {overriding.attempt.user.name} · {overriding.skill} · AI final{" "}
                {overriding.finalBand?.toFixed(1) ?? "—"}
              </p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium mb-2">Final band</legend>
              <div className="grid grid-cols-6 gap-1.5">
                {BANDS.map((band) => (
                  <button
                    key={band}
                    type="button"
                    onClick={() => setOverrideBand(band)}
                    aria-pressed={overrideBand === band}
                    className={`rounded-lg py-2 text-xs font-medium border transition-colors cursor-pointer ${
                      overrideBand === band
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface-subtle hover:bg-card"
                    }`}
                  >
                    {band.toFixed(1)}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor="ov-notes" className="text-xs font-medium">
                Notes (optional)
              </label>
              <Textarea
                id="ov-notes"
                value={overrideNotes}
                onChange={(e) => setOverrideNotes(e.target.value)}
                placeholder="Why is the band being overridden?"
                className="min-h-[64px] text-sm"
              />
            </div>
            {overrideError && (
              <p role="alert" className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {overrideError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setOverriding(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="cursor-pointer"
                disabled={overrideBusy || overrideBand == null}
                onClick={() => void submitOverride()}
              >
                {overrideBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
                Publish override
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
