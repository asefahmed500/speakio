"use client"

import React, { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowRight,
  BadgeCheck,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/auth-shell"
import { registerSchema, type RegisterFormData } from "@/lib/validations/auth"
import { apiFetch } from "@/lib/api-client"
import { useAuthUiStore } from "@/stores/use-auth-ui-store"

const BAND_OPTIONS = [
  { band: 6.0, cefr: "B2", desc: "Competent user" },
  { band: 6.5, cefr: "B2/C1", desc: "Good operational" },
  { band: 7.0, cefr: "C1", desc: "Proficient" },
  { band: 7.5, cefr: "C1+", desc: "Advanced academic" },
  { band: 8.0, cefr: "C2", desc: "Very good" },
  { band: 8.5, cefr: "C2+", desc: "Expert command" },
  { band: 9.0, cefr: "C2 Expert", desc: "Mastery" },
]

interface RegisterResponse {
  name: string
  email: string
  role: "STUDENT" | "INSTRUCTOR" | "ADMIN" | "SUPER_ADMIN"
  targetBand: number | null
}

function getPasswordStrength(pass: string): { score: number; label: string } {
  if (!pass) return { score: 0, label: "" }
  let s = 0
  if (pass.length >= 8) s += 1
  if (pass.length >= 12) s += 1
  if (/[A-Z]/.test(pass) && /[0-9]/.test(pass)) s += 1
  if (/[^A-Za-z0-9]/.test(pass)) s += 1

  if (s <= 1) return { score: 1, label: "Weak" }
  if (s <= 3) return { score: 2, label: "Good" }
  return { score: 3, label: "Strong" }
}

const STRENGTH_COLOR: Record<number, string> = {
  1: "bg-destructive",
  2: "bg-warning",
  3: "bg-success",
}

const STRENGTH_TEXT: Record<number, string> = {
  1: "text-destructive",
  2: "text-warning",
  3: "text-success",
}

export default function RegisterPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const setEmailDraft = useAuthUiStore((s) => s.setEmailDraft)
  const clearEmailDraft = useAuthUiStore((s) => s.clearEmailDraft)

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      targetBand: 7.5,
    },
  })

  // The persisted draft rehydrates after mount so SSR and the hydration
  // render agree — prefilling during render would mismatch the server HTML.
  React.useEffect(() => {
    void useAuthUiStore.persist.rehydrate()
    const draft = useAuthUiStore.getState().emailDraft
    if (draft) setValue("email", draft)
  }, [setValue])

  const watchPassword = useWatch({ control, name: "password", defaultValue: "" })
  const watchTargetBand = useWatch({ control, name: "targetBand", defaultValue: 7.5 })
  const strength = getPasswordStrength(watchPassword || "")

  const onSubmit = async (data: RegisterFormData) => {
    setServerError(null)

    const { data: user, error } = await apiFetch<RegisterResponse>("/auth/register", {
      method: "POST",
      json: data,
    })

    if (error || !user) {
      setServerError(error?.message ?? "Registration failed. Please verify your details.")
      return
    }

    clearEmailDraft()
    router.push("/dashboard")
  }

  return (
    <AuthShell>
      <div className="grid w-full max-w-6xl grid-cols-1 overflow-hidden border border-border bg-card shadow-[0_1px_2px_rgba(28,27,24,0.05)] lg:grid-cols-12">
        {/* Left column — form */}
        <div className="flex flex-col justify-between space-y-6 p-6 sm:p-10 md:p-12 lg:col-span-7">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <p className="flex items-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
                <span aria-hidden className="inline-block size-1.5 bg-primary" />
                Candidate onboarding
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Create your account
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Set your target band and start practising with AI-assisted scoring.
              </p>
            </div>

            {serverError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive"
              >
                <div className="space-y-1">
                  <div className="leading-relaxed">{serverError}</div>
                  {serverError.includes("already exists") && (
                    <Link
                      href="/login"
                      className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Sign in to your existing account <ArrowRight className="size-3" />
                    </Link>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label htmlFor="register-name" className="text-xs font-medium text-foreground">
                  Full name
                </label>
                <Input
                  id="register-name"
                  type="text"
                  autoComplete="name"
                  {...register("name")}
                  placeholder="Your full name"
                  aria-invalid={Boolean(errors.name)}
                  className={`h-10 ${errors.name ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {errors.name && (
                  <p className="text-xs leading-tight text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="register-email" className="text-xs font-medium text-foreground">
                  Email address
                </label>
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  {...register("email", {
                    onChange: (event) => setEmailDraft(event.target.value),
                  })}
                  placeholder="you@example.com"
                  aria-invalid={Boolean(errors.email)}
                  className={`h-10 ${errors.email ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {errors.email && (
                  <p className="text-xs leading-tight text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="register-password" className="text-xs font-medium text-foreground">
                    Create password
                  </label>
                  <span className="text-[11px] text-muted-foreground">Minimum 8 characters</span>
                </div>
                <div className="relative">
                  <Input
                    id="register-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    {...register("password")}
                    placeholder="Use a mix of letters, numbers and symbols"
                    aria-invalid={Boolean(errors.password)}
                    className={`h-10 pr-10 ${errors.password ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {watchPassword && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Strength</span>
                      <span
                        aria-live="polite"
                        className={`font-medium ${STRENGTH_TEXT[strength.score] ?? ""}`}
                      >
                        {strength.label}
                      </span>
                    </div>
                    <div className="grid h-1 grid-cols-3 gap-1" aria-hidden>
                      {[1, 2, 3].map((level) => (
                        <div
                          key={level}
                          className={`h-full ${
                            strength.score >= level ? STRENGTH_COLOR[strength.score] : "bg-border"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {errors.password && (
                  <p className="text-xs leading-tight text-destructive">{errors.password.message}</p>
                )}
              </div>

              <fieldset className="space-y-2 pt-1">
                <legend className="text-xs font-medium text-foreground">
                  Target IELTS band score
                </legend>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                  {BAND_OPTIONS.map((opt) => {
                    const isSelected = watchTargetBand === opt.band
                    return (
                      <button
                        key={opt.band}
                        type="button"
                        onClick={() => setValue("targetBand", opt.band, { shouldValidate: true })}
                        aria-pressed={isSelected}
                        title={opt.desc}
                        className={`cursor-pointer border py-2 text-center transition-colors duration-150 ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-surface-subtle text-foreground hover:border-primary/40 hover:bg-card"
                        }`}
                      >
                        <span className="block text-xs font-medium">{opt.band.toFixed(1)}</span>
                        <span
                          className={`block truncate text-[9px] ${
                            isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {opt.cefr}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {errors.targetBand && (
                  <p className="text-xs leading-tight text-destructive">
                    {errors.targetBand.message}
                  </p>
                )}
              </fieldset>

              <Button type="submit" disabled={isSubmitting} className="h-10 w-full cursor-pointer">
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" data-icon="inline-start" aria-hidden />
                    Creating account…
                  </>
                ) : (
                  <>
                    Create account
                    <ArrowRight data-icon="inline-end" aria-hidden />
                  </>
                )}
              </Button>
            </form>
          </div>

          <div className="border-t border-border pt-3 text-center text-xs text-muted-foreground">
            Already registered?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in to your account
            </Link>
          </div>
        </div>

        {/* Right column — trust panel */}
        <div className="hidden flex-col justify-between border-l border-border bg-surface-subtle p-8 lg:flex lg:col-span-5">
          <div className="space-y-6">
            <div className="space-y-2 border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
                <ShieldCheck className="size-4 text-primary" aria-hidden />
                <span>Official rubric calibration</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Every essay is evaluated across all four official IELTS criteria with
                half-band precision, and borderline results are reviewed by an
                examiner.
              </p>
            </div>

            <div className="space-y-2 border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
                <BadgeCheck className="size-4 text-primary" aria-hidden />
                <span>Full skill coverage</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Listening, reading, writing and speaking practice with server-graded
                results, attempt history, and progress tracking.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4 text-[10px] tracking-widest text-muted-foreground uppercase">
            <span>Zero tracking</span>
            <span>Strict privacy</span>
          </div>
        </div>
      </div>
    </AuthShell>
  )
}
