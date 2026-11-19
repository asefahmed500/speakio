"use client"

import React, { useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, KeyRound, Loader2, UserCog, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSessionUser } from "@/components/user-session-provider"
import { apiFetch } from "@/lib/api-client"

export default function ProfilePage() {
  const user = useSessionUser()
  const [name, setName] = useState(user.name)
  const [targetBand, setTargetBand] = useState(String(user.targetBand ?? 7.0))

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const [profileSaving, setProfileSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const profileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const passwordTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const profileRef = profileTimer
    const passwordRef = passwordTimer
    return () => {
      if (profileRef.current) clearTimeout(profileRef.current)
      if (passwordRef.current) clearTimeout(passwordRef.current)
    }
  }, [])

  const flash = (
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  ) => {
    setter(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setter(false), 2500)
  }

  const saveProfile = async () => {
    const band = Number(targetBand)
    if (name.trim().length < 2) {
      setProfileError("Name must be at least 2 characters.")
      return
    }
    if (!Number.isFinite(band) || band < 4 || band > 9 || (band * 2) % 1 !== 0) {
      setProfileError("Target band must be between 4.0 and 9.0 in 0.5 steps.")
      return
    }
    setProfileSaving(true)
    setProfileError(null)
    const { error } = await apiFetch("/users/me", {
      method: "PATCH",
      json: { name: name.trim(), targetBand: band },
    })
    setProfileSaving(false)
    if (error) {
      setProfileError(error.message)
      return
    }
    flash(setProfileSaved, profileTimer)
  }

  const changePassword = async () => {
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.")
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.")
      return
    }
    if (newPassword === currentPassword) {
      setPasswordError("The new password must be different from the current one.")
      return
    }
    setPasswordSaving(true)
    setPasswordError(null)
    const { error } = await apiFetch("/users/me/password", {
      method: "POST",
      json: { currentPassword, newPassword },
    })
    setPasswordSaving(false)
    if (error) {
      setPasswordError(error.message)
      return
    }
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
    flash(setPasswordSaved, passwordTimer)
  }

  return (
    <div className="relative min-h-0 bg-background text-foreground">
      {/* Ambient Lighting Orbs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-[130px]" />
        <div className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full bg-indigo-500/10 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-3 py-1 text-[11px] font-mono tracking-widest text-cyan-300 uppercase">
            <ShieldCheck className="size-3.5 text-cyan-400" />
            <span>Candidate Credentials</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-2">
            Profile & Security
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {user.email} · Role: <span className="font-mono text-cyan-300">{user.role}</span>
          </p>
        </div>

        {/* Profile Details */}
        <section className="rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <UserCog className="size-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-foreground">Candidate Details</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="pr-name" className="text-xs font-medium text-muted-foreground">
                Full Name
              </label>
              <Input
                id="pr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pr-band" className="text-xs font-medium text-muted-foreground">
                Target IELTS Band
              </label>
              <select
                id="pr-band"
                value={targetBand}
                onChange={(e) => setTargetBand(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-subtle px-3 text-xs text-foreground outline-none focus:border-cyan-400"
              >
                {[5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0].map((b) => (
                  <option key={b} value={b.toFixed(1)} className="bg-[#121927] text-foreground">
                    Band {b.toFixed(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {profileError && (
            <p role="alert" className="text-xs text-rose-300 flex items-center gap-1.5">
              <AlertCircle className="size-3.5" /> {profileError}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              size="sm"
              onClick={() => void saveProfile()}
              disabled={profileSaving}
              className="cursor-pointer rounded-xl bg-white px-4 py-2 text-xs font-medium text-black hover:bg-neutral-200"
            >
              {profileSaving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
              Save Profile
            </Button>
            {profileSaved && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-mono">
                <CheckCircle2 className="size-3.5" /> Saved
              </span>
            )}
          </div>
        </section>

        {/* Password */}
        <section className="rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <KeyRound className="size-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-foreground">Security & Password</h2>
          </div>

          <p className="text-xs text-muted-foreground">
            Changing your password revokes existing sessions across other devices.
          </p>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="pr-current" className="text-xs font-medium text-muted-foreground">
                Current Password
              </label>
              <Input
                id="pr-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="pr-new" className="text-xs font-medium text-muted-foreground">
                  New Password
                </label>
                <Input
                  id="pr-new"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pr-confirm" className="text-xs font-medium text-muted-foreground">
                  Confirm Password
                </label>
                <Input
                  id="pr-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
                />
              </div>
            </div>
          </div>

          {passwordError && (
            <p role="alert" className="text-xs text-rose-300 flex items-center gap-1.5">
              <AlertCircle className="size-3.5" /> {passwordError}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              size="sm"
              onClick={() => void changePassword()}
              disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
              className="cursor-pointer rounded-xl bg-white px-4 py-2 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-40"
            >
              {passwordSaving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
              Update Password
            </Button>
            {passwordSaved && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-mono">
                <CheckCircle2 className="size-3.5" /> Password updated
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
