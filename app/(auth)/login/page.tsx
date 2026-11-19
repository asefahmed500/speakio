"use client"

import React, { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/auth-shell"
import { loginSchema, type LoginFormData } from "@/lib/validations/auth"
import { apiFetch } from "@/lib/api-client"
import { useAuthUiStore } from "@/stores/use-auth-ui-store"

interface LoginResponse {
  name: string
  email: string
  role: "USER" | "ADMIN"
  targetBand: number | null
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [serverError, setServerError] = useState<string | null>(null)
  const setEmailDraft = useAuthUiStore((s) => s.setEmailDraft)
  const clearEmailDraft = useAuthUiStore((s) => s.clearEmailDraft)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  React.useEffect(() => {
    void useAuthUiStore.persist.rehydrate()
    const draft = useAuthUiStore.getState().emailDraft
    if (draft) setValue("email", draft)
  }, [setValue])

  const nextPath = searchParams.get("next")
  const dashboardFor = (role: LoginResponse["role"]) =>
    role === "ADMIN" ? "/overview" : "/dashboard"

  const fillDemo = (email: string, password: string) => {
    setValue("email", email, { shouldValidate: true })
    setValue("password", password, { shouldValidate: true })
    setEmailDraft(email)
    setServerError(null)
  }

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null)
    const { data: user, error } = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      json: data,
      timeoutMs: 45_000,
    })
    if (error || !user) {
      setServerError(error?.message ?? "Could not sign in.")
      return
    }
    clearEmailDraft()
    const safeNext = nextPath && /^\/[^/\\]/.test(nextPath) ? nextPath : null
    router.push(safeNext ?? dashboardFor(user.role))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-xs text-neutral-500">Welcome back.</p>
      </div>

      {serverError && (
        <p role="alert" className="border-l-2 border-[#111111] bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          {serverError}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div>
          <label htmlFor="login-email" className="text-xs font-medium">Email</label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            {...register("email")}
            className="mt-1 h-10 border-black/10 bg-white text-sm"
          />
          {errors.email && <p className="mt-1 text-[11px] text-neutral-600">{errors.email.message}</p>}
        </div>
        <div>
          <label htmlFor="login-password" className="text-xs font-medium">Password</label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            {...register("password")}
            className="mt-1 h-10 border-black/10 bg-white text-sm"
          />
          {errors.password && <p className="mt-1 text-[11px] text-neutral-600">{errors.password.message}</p>}
        </div>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-10 w-full bg-[#111111] text-xs font-medium text-white hover:bg-black"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

        <div className="flex items-center justify-between border-t border-black/5 pt-4 text-[11px]">
          <Link href="/register" className="font-medium underline underline-offset-4">
            Create account
          </Link>
          <Link href="/forgot-password" className="text-neutral-500 hover:text-[#111111]">
            Forgot password?
          </Link>
        </div>

        <p className="border-t border-black/5 pt-4 text-center text-[11px] text-neutral-400">
          No sign-in required to <Link href="/verify" className="underline underline-offset-4">verify a certificate</Link>.
        </p>

      <div className="flex gap-2 text-[11px] text-neutral-400">
        <button type="button" onClick={() => fillDemo("user@speakio.com", "password123")} className="underline underline-offset-4 hover:text-[#111111]">
          Demo user
        </button>
        <span aria-hidden>·</span>
        <button type="button" onClick={() => fillDemo("admin@speakio.com", "password123")} className="underline underline-offset-4 hover:text-[#111111]">
          Demo admin
        </button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-sm text-neutral-400">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
