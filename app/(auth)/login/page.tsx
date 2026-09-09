"use client"

import React, { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
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
import { loginSchema, type LoginFormData } from "@/lib/validations/auth"
import { apiFetch } from "@/lib/api-client"
import { useAuthUiStore } from "@/stores/use-auth-ui-store"

interface LoginResponse {
  name: string
  email: string
  role: "STUDENT" | "INSTRUCTOR" | "ADMIN" | "SUPER_ADMIN"
  targetBand: number | null
}

const TRUST_POINTS = [
  {
    icon: ShieldCheck,
    title: "AI band scoring",
    body: "Writing responses are evaluated against the four official IELTS criteria. Borderline results are routed to a certified examiner.",
  },
  {
    icon: BadgeCheck,
    title: "Verifiable certificates",
    body: "Completing all four skills issues a participation certificate with a public verification URL anyone can check.",
  },
]

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const { emailDraft, setEmailDraft, clearEmailDraft } = useAuthUiStore()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: emailDraft, password: "" },
  })

  const nextPath = searchParams.get("next")

  const dashboardFor = (role: LoginResponse["role"]): string => {
    if (role === "INSTRUCTOR") return "/review-queue"
    if (role === "ADMIN" || role === "SUPER_ADMIN") return "/agent-ops"
    return "/dashboard"
  }

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null)

    const { data: user, error } = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      json: data,
    })

    if (error || !user) {
      setServerError(error?.message ?? "Authentication failed. Please try again.")
      return
    }

    // Successful session — stop pre-filling the draft email.
    clearEmailDraft()

    // Only redirect to same-origin relative paths to avoid open redirects.
    // Rejects protocol-relative ("//host") and backslash tricks ("/\host"),
    // which browsers normalize into a scheme-relative URL.
    const safeNext = nextPath && /^\/[^/\\]/.test(nextPath) ? nextPath : null
    router.push(safeNext ?? dashboardFor(user.role))
  }

  return (
    <div className="grid w-full max-w-6xl grid-cols-1 overflow-hidden border border-border bg-card shadow-[0_1px_2px_rgba(28,27,24,0.05)] lg:grid-cols-12">
      {/* Left column — form */}
      <div className="flex flex-col justify-between space-y-8 p-6 sm:p-10 md:p-12 lg:col-span-7">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
              <span aria-hidden className="inline-block size-1.5 bg-primary" />
              Candidate portal
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Sign in
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Access your practice modules, AI band scoring, and study plan.
            </p>
          </div>

          {serverError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive"
            >
              <p className="leading-relaxed">{serverError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-xs font-medium text-foreground">
                Email
              </label>
              <Input
                id="login-email"
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
                <label htmlFor="login-password" className="text-xs font-medium text-foreground">
                  Password
                </label>
                {/* Password reset is handled by support in v1. */}
                <span className="text-[11px] text-muted-foreground">Minimum 6 characters</span>
              </div>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  {...register("password")}
                  placeholder="Your password"
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
              {errors.password && (
                <p className="text-xs leading-tight text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting} className="h-10 w-full cursor-pointer">
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" data-icon="inline-start" aria-hidden />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </>
              )}
            </Button>
          </form>
        </div>

        <div className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
          New to Speakio?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create a candidate account
          </Link>
        </div>
      </div>

      {/* Right column — trust panel */}
      <div className="hidden flex-col justify-between border-l border-border bg-surface-subtle p-8 lg:flex lg:col-span-5">
        <div className="space-y-6">
          {TRUST_POINTS.map((point) => {
            const Icon = point.icon
            return (
              <div key={point.title} className="space-y-2 border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
                  <Icon className="size-4 text-primary" aria-hidden />
                  <span>{point.title}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{point.body}</p>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4 text-[10px] tracking-widest text-muted-foreground uppercase">
          <span>Speakio Academic</span>
          <span>Secure sign-in</span>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
