"use client"

import React, { useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { AlertCircle, CheckCircle2, KeyRound, Loader2, UserCog, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSessionUser } from "@/components/user-session-provider"
import { apiFetch } from "@/lib/api-client"

const BANDS = [5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0]

const profileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  targetBand: z
    .number()
    .min(4, "Target band must be between 4.0 and 9.0")
    .max(9, "Target band must be between 4.0 and 9.0")
    .refine((v) => (v * 2) % 1 === 0, "Use 0.5 increments"),
})
type ProfileData = z.infer<typeof profileSchema>

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "At least 8 characters").max(128),
    confirmPassword: z.string().min(1, "Confirm the new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "The new password must be different from the current one",
    path: ["newPassword"],
  })
type PasswordData = z.infer<typeof passwordSchema>

export default function ProfilePage() {
  const user = useSessionUser()
  const [profileSaving, setProfileSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const profileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const passwordTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const p = profileTimer
    const q = passwordTimer
    return () => {
      if (p.current) clearTimeout(p.current)
      if (q.current) clearTimeout(q.current)
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

  // Option values are "7.0"-style strings. Initialising from String(7) gives
  // "7", which matches no <option> and makes the browser fall back to 5.0.
  const profile = useForm<ProfileData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user.name,
      targetBand: user.targetBand != null ? user.targetBand : 7.0,
    },
  })
  const password = useForm<PasswordData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  })

  const saveProfile = async (data: ProfileData) => {
    setProfileSaving(true)
    setProfileError(null)
    const { error } = await apiFetch("/users/me", {
      method: "PATCH",
      json: { name: data.name.trim(), targetBand: data.targetBand },
    })
    setProfileSaving(false)
    if (error) {
      setProfileError(error.message)
      return
    }
    flash(setProfileSaved, profileTimer)
  }

  const changePassword = async (data: PasswordData) => {
    setPasswordSaving(true)
    setPasswordError(null)
    const { error } = await apiFetch("/users/me/password", {
      method: "POST",
      json: { currentPassword: data.currentPassword, newPassword: data.newPassword },
    })
    setPasswordSaving(false)
    if (error) {
      setPasswordError(error.message)
      return
    }
    password.reset()
    flash(setPasswordSaved, passwordTimer)
  }

  return (
    <div className="relative min-h-0 bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-primary/5 blur-[130px]" />
        <div className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full bg-primary/5 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      <div className="w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-3 py-1 text-[11px] font-mono tracking-widest text-muted-foreground uppercase">
            <ShieldCheck className="size-3.5 text-muted-foreground" />
            <span>Candidate Credentials</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-2">
            Profile &amp; Security
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {user.email} · Role: <span className="font-mono text-muted-foreground">{user.role}</span>
          </p>
        </div>

        <section className="rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <UserCog className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Candidate Details</h2>
          </div>

          <form onSubmit={(e) => void profile.handleSubmit(saveProfile)(e)} noValidate className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="pr-name" className="text-xs font-medium text-muted-foreground">
                  Full Name
                </label>
                <Input
                  id="pr-name"
                  {...profile.register("name")}
                  className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
                />
                {profile.formState.errors.name && (
                  <p role="alert" className="text-[11px] text-red-600">
                    {profile.formState.errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pr-band" className="text-xs font-medium text-muted-foreground">
                  Target IELTS Band
                </label>
                <select
                  id="pr-band"
                  {...profile.register("targetBand", { valueAsNumber: true })}
                  className="h-10 w-full rounded-xl border border-border bg-surface-subtle px-3 text-xs text-foreground outline-none focus:border-primary"
                >
                  {BANDS.map((b) => (
                    <option key={b} value={b} className="bg-card text-foreground">
                      Band {b.toFixed(1)}
                    </option>
                  ))}
                </select>
                {profile.formState.errors.targetBand && (
                  <p role="alert" className="text-[11px] text-red-600">
                    {profile.formState.errors.targetBand.message}
                  </p>
                )}
              </div>
            </div>

            {profileError && (
              <p role="alert" className="text-xs text-red-600 flex items-center gap-1.5">
                <AlertCircle className="size-3.5" /> {profileError}
              </p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="submit"
                size="sm"
                disabled={profileSaving}
                className="cursor-pointer rounded-xl bg-white px-4 py-2 text-xs font-medium text-black hover:bg-neutral-200"
              >
                {profileSaving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                Save Profile
              </Button>
              {profileSaved && (
                <span role="status" className="inline-flex items-center gap-1 text-xs text-emerald-700 font-mono">
                  <CheckCircle2 className="size-3.5" /> Saved
                </span>
              )}
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <KeyRound className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Security &amp; Password</h2>
          </div>

          <p className="text-xs text-muted-foreground">
            Changing your password revokes existing sessions across other devices.
          </p>

          <form onSubmit={(e) => void password.handleSubmit(changePassword)(e)} noValidate className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="pr-current" className="text-xs font-medium text-muted-foreground">
                Current Password
              </label>
              <Input
                id="pr-current"
                type="password"
                autoComplete="current-password"
                {...password.register("currentPassword")}
                className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
              />
              {password.formState.errors.currentPassword && (
                <p role="alert" className="text-[11px] text-red-600">
                  {password.formState.errors.currentPassword.message}
                </p>
              )}
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
                  {...password.register("newPassword")}
                  className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
                />
                {password.formState.errors.newPassword && (
                  <p role="alert" className="text-[11px] text-red-600">
                    {password.formState.errors.newPassword.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pr-confirm" className="text-xs font-medium text-muted-foreground">
                  Confirm Password
                </label>
                <Input
                  id="pr-confirm"
                  type="password"
                  autoComplete="new-password"
                  {...password.register("confirmPassword")}
                  className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground"
                />
                {password.formState.errors.confirmPassword && (
                  <p role="alert" className="text-[11px] text-red-600">
                    {password.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>
            </div>

            {passwordError && (
              <p role="alert" className="text-xs text-red-600 flex items-center gap-1.5">
                <AlertCircle className="size-3.5" /> {passwordError}
              </p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="submit"
                size="sm"
                disabled={passwordSaving}
                className="cursor-pointer rounded-xl bg-white px-4 py-2 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-40"
              >
                {passwordSaving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                Update Password
              </Button>
              {passwordSaved && (
                <span role="status" className="inline-flex items-center gap-1 text-xs text-emerald-700 font-mono">
                  <CheckCircle2 className="size-3.5" /> Password updated
                </span>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
