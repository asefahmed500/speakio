"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight } from "lucide-react"
import { ButtonLink } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"

interface PlatformStats {
  users: { total: number; learners: number; admins: number; suspended: number }
  attempts: { total: number; completed: number }
  pendingReviews: number
  agentRuns: Array<{ status: string; count: number }>
  questions: number
  certificates: number
}

export default function OverviewPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      const { data, error: fetchError } = await apiFetch<PlatformStats>("/users/stats")
      if (!active) return
      if (fetchError || !data) {
        setError(fetchError?.message ?? "Failed to load platform stats.")
      } else {
        setStats(data)
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const runsByStatus = (status: string) =>
    stats?.agentRuns.find((r) => r.status === status)?.count ?? 0

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Platform Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live health of the learning, AI and operations layers.
          </p>
        </div>

        {loading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="status" aria-live="polite">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error}</p>
            <ButtonLink variant="outline" size="sm" href="/overview">Retry</ButtonLink>
          </div>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard label="Learners" value={stats.users.learners} sub={`${stats.users.admins} admins`} />
              <KpiCard label="Attempts" value={stats.attempts.total} sub={`${stats.attempts.completed} done`} />
              <KpiCard label="Questions" value={stats.questions} sub="bank" />
              <KpiCard label="Certificates" value={stats.certificates} sub="issued" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <h2 className="text-sm font-semibold">Escalated reviews</h2>
                <p className="text-3xl font-semibold tabular-nums">{stats.pendingReviews}</p>
                <ButtonLink variant="outline" size="sm" className="cursor-pointer" href="/review-queue">
                  Open reviews
                </ButtonLink>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <h2 className="text-sm font-semibold">Agent runs</h2>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <StatRow label="Done" value={runsByStatus("COMPLETED")} tone="text-success" />
                  <StatRow label="Running" value={runsByStatus("RUNNING")} tone="text-primary" />
                  <StatRow label="Failed" value={runsByStatus("FAILED")} tone="text-destructive" />
                </div>
                <ButtonLink variant="outline" size="sm" className="cursor-pointer" href="/agent-ops">
                  Open agent ops
                </ButtonLink>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <QuickLink href="/users" title="Users" />
              <QuickLink href="/question-bank" title="Question bank" />
              <QuickLink href="/students" title="Students" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string
  value: number
  sub: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</span>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </div>
  )
}

function StatRow({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}

function QuickLink({ href, title }: { href: string; title: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-border bg-card p-4 flex items-center justify-between hover:border-primary/40 transition-colors"
    >
      <span className="text-sm font-medium">{title}</span>
      <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
    </Link>
  )
}
