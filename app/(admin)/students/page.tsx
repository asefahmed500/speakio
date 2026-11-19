"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiFetch } from "@/lib/api-client"

interface StudentRow {
  id: string
  email: string
  name: string
  status: "ACTIVE" | "SUSPENDED"
  targetBand: number | null
  createdAt: string
  attemptsCount: number
  completedCount: number
  avgBand: number | null
  lastActivityAt: string | null
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const fetchStudents = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ""
    const { data, error: fetchError } = await apiFetch<StudentRow[]>(`/admin/students${params}`)
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load the student roster.")
      setStudents(null)
    } else {
      setStudents(data)
    }
    setLoading(false)
  }, [query])

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchStudents()
    }, 250)
    return () => clearTimeout(t)
  }, [fetchStudents])

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Students</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Roster, engagement and band progress across your student body.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search students by name or email"
              placeholder="Search name or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchStudents()}>Retry</Button>
          </div>
        )}

        {loading && !students && (
          <div className="space-y-2" role="status" aria-live="polite">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            ))}
          </div>
        )}

        {!loading && students && students.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <h2 className="text-base font-semibold">No students found</h2>
            <p className="text-sm text-muted-foreground mt-1">
              New registrations appear here automatically.
            </p>
          </div>
        )}

        {students && students.length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Attempts</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Avg band</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Last activity</th>
                  <th className="px-4 py-3 font-medium text-right">Profile</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex flex-col">
                          <span className="font-medium">{s.name}</span>
                          <span className="text-[11px] text-muted-foreground">{s.email}</span>
                        </span>
                        {s.status === "SUSPENDED" && (
                          <span className="rounded-none border border-destructive/30 bg-destructive/10 text-destructive px-1.5 py-0.5 text-[9px]">
                            SUSPENDED
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {s.targetBand != null ? (
                        <span className="font-medium text-primary">Band {s.targetBand.toFixed(1)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                      {s.attemptsCount} ({s.completedCount} completed)
                    </td>
                    <td className="px-4 py-3 text-xs hidden lg:table-cell">
                      {s.avgBand != null ? (
                        <span className="font-medium tabular-nums">{s.avgBand.toFixed(1)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                      {s.lastActivityAt
                        ? new Date(s.lastActivityAt).toLocaleDateString(undefined, { dateStyle: "medium" })
                        : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/students/${s.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        View <ArrowRight className="h-3 w-3" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {loading && students && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>
    </div>
  )
}
