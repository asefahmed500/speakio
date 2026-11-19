"use client"

import React, { useCallback, useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, Search, ShieldCheck, UserCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import { apiFetch } from "@/lib/api-client"

interface ManagedUser {
  id: string
  email: string
  name: string
  role: "USER" | "ADMIN"
  status: "ACTIVE" | "SUSPENDED"
  targetBand: number | null
  subscriptionTier: string
  createdAt: string
  attemptsCount: number
  completedCount: number
  avgBand: number | null
  lastActivityAt: string | null
}

const ROLES = ["USER", "ADMIN"] as const

function formatDate(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" })
}

export default function UsersAdminPage() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [suspendError, setSuspendError] = useState<string | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<ManagedUser | null>(null)
  const [suspending, setSuspending] = useState(false)
  const [successInfo, setSuccessInfo] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (query.trim()) params.set("query", query.trim())
    if (roleFilter) params.set("role", roleFilter)
    if (statusFilter) params.set("status", statusFilter)
    const { data, error: fetchError } = await apiFetch<ManagedUser[]>(`/users?${params.toString()}`)
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load users.")
      setUsers(null)
    } else {
      setUsers(data)
    }
    setLoading(false)
  }, [query, roleFilter, statusFilter])

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchUsers()
    }, 250)
    return () => clearTimeout(t)
  }, [fetchUsers])

  const changeRole = async (user: ManagedUser, role: string) => {
    if (role === user.role) return
    setBusyId(user.id)
    setRowError(null)
    setSuccessInfo(null)
    const { error: patchError } = await apiFetch(`/users/${user.id}/role`, {
      method: "PATCH",
      json: { role },
    })
    setBusyId(null)
    if (patchError) {
      setRowError({ id: user.id, message: patchError.message })
      return
    }
    setSuccessInfo(`${user.name} is now ${role}`)
    void fetchUsers()
  }

  const confirmSuspend = async () => {
    if (!suspendTarget) return
    setSuspending(true)
    setSuspendError(null)
    const nextStatus = suspendTarget.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"
    const { error: statusError } = await apiFetch(`/users/${suspendTarget.id}/status`, {
      method: "PATCH",
      json: { status: nextStatus },
    })
    setSuspending(false)
    if (statusError) {
      // Keep the dialog open and show the real error — the admin can retry.
      setSuspendError(statusError.message)
      return
    }
    setSuccessInfo(
      nextStatus === "SUSPENDED"
        ? `${suspendTarget.name} has been suspended`
        : `${suspendTarget.name} has been reactivated`
    )
    setSuspendTarget(null)
    void fetchUsers()
  }

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">User Management</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Roles, access and account status across the platform.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-none border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground self-start">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
            ADMIN-only area
          </span>
        </div>

        {successInfo && (
          <div role="status" className="rounded-lg border border-success/30 bg-success/10 text-xs px-3 py-2.5 flex items-center gap-2 text-emerald-900">
            <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" aria-hidden />
            {successInfo}
          </div>
        )}

        {/* Filters */}
        <div className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search users by name or email"
              placeholder="Search name or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
          <select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-10 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
          >
            <option value="" className="bg-card text-foreground">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r} className="bg-card text-foreground">{r}</option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
          >
            <option value="" className="bg-card text-foreground">All statuses</option>
            <option value="ACTIVE" className="bg-card text-foreground">Active</option>
            <option value="SUSPENDED" className="bg-card text-foreground">Suspended</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => void fetchUsers()} disabled={loading} className="cursor-pointer h-10">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Refresh"}
          </Button>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchUsers()}>Retry</Button>
          </div>
        )}

        {loading && !users && (
          <div className="space-y-2" role="status" aria-live="polite">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            ))}
          </div>
        )}

        {!loading && users && users.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <h2 className="text-base font-semibold">No users match</h2>
            <p className="text-sm text-muted-foreground mt-1">Adjust the search or filters.</p>
          </div>
        )}

        {users && users.length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Activity</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Joined</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-border/60 last:border-0 align-middle">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{user.name}</span>
                        <span className="text-[11px] text-muted-foreground">{user.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Change role for ${user.name}`}
                        value={user.role}
                        disabled={busyId === user.id}
                        onChange={(e) => void changeRole(user, e.target.value)}
                        className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring cursor-pointer"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} className="bg-card text-foreground">{r}</option>
                        ))}
                      </select>
                      {rowError?.id === user.id && (
                        <p role="alert" className="mt-1 text-[10px] text-destructive max-w-[180px]">
                          {rowError.message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-none border px-2 py-0.5 text-[10px] font-medium ${
                          user.status === "ACTIVE"
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-destructive/30 bg-destructive/10 text-destructive"
                        }`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="text-xs text-muted-foreground">
                        {user.attemptsCount} attempts · {user.completedCount} completed
                        {user.avgBand != null && (
                          <span className="text-foreground font-medium"> · avg {user.avgBand.toFixed(1)}</span>
                        )}
                        <div className="text-[10px]">Last: {formatDate(user.lastActivityAt)}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant={user.status === "ACTIVE" ? "outline" : "default"}
                        size="sm"
                        disabled={busyId === user.id}
                        onClick={() => setSuspendTarget(user)}
                        className="cursor-pointer gap-1.5"
                      >
                        {busyId === user.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <UserCog className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {user.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={suspendTarget != null}
        title={suspendTarget?.status === "ACTIVE" ? "Suspend this account?" : "Reactivate this account?"}
        description={
          suspendTarget?.status === "ACTIVE"
            ? "The user will be signed out everywhere and blocked from signing in until reactivated."
            : "The user will be able to sign in and resume preparation immediately."
        }
        intent={suspendTarget?.status === "ACTIVE" ? "destructive" : "info"}
        confirmLabel={suspendTarget?.status === "ACTIVE" ? "Suspend account" : "Reactivate account"}
        cancelLabel="Cancel"
        isSubmitting={suspending}
        error={suspendError}
        onConfirm={() => void confirmSuspend()}
        onCancel={() => {
          setSuspendError(null)
          setSuspendTarget(null)
        }}
        details={suspendTarget ? `User: ${suspendTarget.name} (${suspendTarget.email}) | Role: ${suspendTarget.role}` : undefined}
      />
    </div>
  )
}
