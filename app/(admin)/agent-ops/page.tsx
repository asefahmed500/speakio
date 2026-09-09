"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ChevronLeft, Loader2, RefreshCw, RotateCcw, X } from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"

interface AgentStep {
  id: string
  stepName: string
  status: string
  durationMs: number
}

interface AgentRun {
  id: string
  agentType: string
  attemptId: string | null
  status: "QUEUED" | "RUNNING" | "WAITING_FOR_APPROVAL" | "COMPLETED" | "FAILED"
  confidence: number | null
  costTokens: number
  durationMs: number
  error: string | null
  createdAt: string
  completedAt: string | null
  steps: AgentStep[]
}

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: "border-success/30 bg-success/10 text-success",
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
  RUNNING: "border-primary/20 bg-primary/10 text-primary",
  QUEUED: "border-border bg-surface-subtle text-muted-foreground",
  WAITING_FOR_APPROVAL: "border-warning/30 bg-warning/10 text-warning",
}

export default function AgentOpsPage() {
  const [runs, setRuns] = useState<AgentRun[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentRun | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)

  const fetchRuns = useCallback(async () => {
    const { data, error: fetchError } = await apiFetch<AgentRun[]>("/scoring/runs")
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load agent runs.")
    } else {
      setRuns(data)
    }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    // Deferred to a microtask so the effect body never mutates state synchronously.
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchRuns()
    })
    return () => {
      active = false
    }
  }, [fetchRuns])

  const refresh = () => {
    setRefreshing(true)
    void fetchRuns()
  }

  const retryFetch = () => {
    setLoading(true)
    void fetchRuns()
  }

  const openDetail = async (run: AgentRun) => {
    setDetailLoading(true)
    setDetail(run) // optimistic
    const { data, error: fetchError } = await apiFetch<AgentRun>(`/scoring/runs/${run.id}`)
    if (!fetchError && data) setDetail(data)
    setDetailLoading(false)
  }

  const retry = async (runId: string) => {
    setRetryingId(runId)
    setRetryMessage(null)
    const { error: retryError } = await apiFetch(`/scoring/runs/${runId}/retry`, { method: "POST" })
    setRetryMessage(
      retryError ? retryError.message : "Run re-executed successfully."
    )
    setRetryingId(null)
    await fetchRuns()
  }

  const totals = runs
    ? {
        failed: runs.filter((r) => r.status === "FAILED").length,
        completed: runs.filter((r) => r.status === "COMPLETED").length,
        avgMs: runs.length
          ? Math.round(runs.reduce((acc, r) => acc + r.durationMs, 0) / runs.length)
          : 0,
        tokens: runs.reduce((acc, r) => acc + r.costTokens, 0),
      }
    : null

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Agent Ops</h1>
            <p className="text-sm text-muted-foreground mt-1">AI scoring runs and telemetry</p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <ButtonLink variant="outline" size="sm" className="cursor-pointer" href="/review-queue">
              Review queue
            </ButtonLink>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh()}
              disabled={refreshing}
              className="cursor-pointer"
            >
              {refreshing ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
              )}
              Refresh
            </Button>
          </div>
        </div>

        {loading && (
          <div className="space-y-3" role="status" aria-live="polite">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            ))}
            <span className="sr-only">Loading runs…</span>
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

        {!loading && !error && runs && runs.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center space-y-2">
            <h2 className="text-base font-semibold">No agent runs yet</h2>
            <p className="text-sm text-muted-foreground">
              Runs appear here once students submit writing tests for AI scoring.
            </p>
          </div>
        )}

        {!loading && !error && totals && runs && runs.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Completed" value={String(totals.completed)} />
              <Stat label="Failed" value={String(totals.failed)} highlight={totals.failed > 0} />
              <Stat label="Avg duration" value={`${(totals.avgMs / 1000).toFixed(1)}s`} />
              <Stat label="Tokens used" value={totals.tokens.toLocaleString()} />
            </div>

            {retryMessage && (
              <p
                role="status"
                className={`rounded-lg border px-3 py-2 text-xs ${
                  retryMessage.includes("successfully")
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                {retryMessage}
              </p>
            )}

            <ul className="space-y-2">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{run.id.slice(0, 8)}</span>
                      <span
                        className={`rounded-none border px-2 py-0.5 text-[10px] font-medium ${
                          STATUS_STYLE[run.status] ?? STATUS_STYLE.QUEUED
                        }`}
                      >
                        {run.status.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{run.agentType}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}
                      {run.error && <span className="text-destructive"> · {run.error.slice(0, 80)}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => void openDetail(run)} className="cursor-pointer">
                      Details
                    </Button>
                    {run.status === "FAILED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void retry(run.id)}
                        disabled={retryingId === run.id}
                        className="cursor-pointer"
                      >
                        {retryingId === run.id ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden />
                        )}
                        Retry
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Run detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Run details">
          <button
            type="button"
            aria-label="Close details"
            className="absolute inset-0 bg-black/30"
            onClick={() => setDetail(null)}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-card border-l border-border p-5 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold font-mono">{detail.id.slice(0, 12)}</h2>
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {detailLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
            <dl className="text-xs space-y-2">
              <Row label="Status" value={detail.status.replace(/_/g, " ")} />
              <Row label="Type" value={detail.agentType} />
              <Row label="Attempt" value={detail.attemptId ?? "—"} />
              <Row label="Confidence" value={detail.confidence != null ? detail.confidence.toFixed(2) : "—"} />
              <Row label="Tokens" value={detail.costTokens.toLocaleString()} />
              <Row label="Duration" value={`${(detail.durationMs / 1000).toFixed(2)}s`} />
            </dl>
            {detail.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2">
                {detail.error}
              </div>
            )}
            {detail.steps.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Steps
                </h3>
                <ul className="space-y-1.5">
                  {detail.steps.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-center justify-between rounded-lg bg-surface-subtle border border-border px-3 py-2 text-xs"
                    >
                      <span className="font-mono">{step.stepName}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {step.status} · {step.durationMs}ms
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail.status === "FAILED" && (
              <Button
                size="sm"
                onClick={() => void retry(detail.id)}
                disabled={retryingId === detail.id}
                className="cursor-pointer"
              >
                {retryingId === detail.id ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden />
                )}
                Retry run
              </Button>
            )}
            <Link
              href="/agent-ops"
              onClick={() => setDetail(null)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ChevronLeft className="h-3 w-3" aria-hidden /> Back to runs
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${highlight ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right truncate max-w-[60%]">{value}</dd>
    </div>
  )
}

