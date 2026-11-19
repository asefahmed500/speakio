"use client"

import React, { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/auth-shell"
import { registerSchema, type RegisterFormData } from "@/lib/validations/auth"
import { apiFetch } from "@/lib/api-client"
import { useAuthUiStore } from "@/stores/use-auth-ui-store"

const BANDS = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0]

interface RegisterResponse {
  name: string
  email: string
  role: "USER" | "ADMIN"
  targetBand: number | null
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
    defaultValues: { name: "", email: "", password: "", targetBand: 7.5 },
  })

  const currentBand = useWatch({ control, name: "targetBand" })

  const onSubmit = async (data: RegisterFormData) => {
    setServerError(null)
    const { data: user, error } = await apiFetch<RegisterResponse>("/auth/register", {
      method: "POST",
      json: data,
    })
    if (error || !user) {
      setServerError(error?.message ?? "Could not create the account.")
      return
    }
    clearEmailDraft()
    router.push("/dashboard")
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Create account</h1>
          <p className="mt-1 text-xs text-neutral-500">Start practising in under a minute.</p>
        </div>

        {serverError && (
          <p role="alert" className="border-l-2 border-[#111111] bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
            {serverError}
          </p>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div>
            <label htmlFor="reg-name" className="text-xs font-medium">Name</label>
            <Input
              id="reg-name"
              autoComplete="name"
              placeholder="Your name"
              {...register("name")}
              className="mt-1 h-10 border-black/10 bg-white text-sm text-[#111111] placeholder:text-neutral-400"
            />
            {errors.name && <p className="mt-1 text-[11px] text-neutral-600">{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="reg-email" className="text-xs font-medium">Email</label>
            <Input
              id="reg-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...register("email", { onChange: (e) => setEmailDraft(e.target.value) })}
              className="mt-1 h-10 border-black/10 bg-white text-sm text-[#111111] placeholder:text-neutral-400"
            />
            {errors.email && <p className="mt-1 text-[11px] text-neutral-600">{errors.email.message}</p>}
          </div>
          <div>
            <div className="flex justify-between">
              <label htmlFor="reg-password" className="text-xs font-medium">Password</label>
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="text-[11px] text-neutral-500 hover:text-[#111111]"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <Input
              id="reg-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              {...register("password")}
              className="mt-1 h-10 border-black/10 bg-white text-sm text-[#111111] placeholder:text-neutral-400"
            />
            {errors.password && <p className="mt-1 text-[11px] text-neutral-600">{errors.password.message}</p>}
          </div>
          <div>
            <p className="text-xs font-medium">Target band</p>
            <div className="mt-1 flex gap-1.5">
              {BANDS.map((band) => (
                <button
                  key={band}
                  type="button"
                  onClick={() => setValue("targetBand", band)}
                  aria-pressed={currentBand === band}
                  className={`flex-1 border py-1.5 text-xs font-medium transition-colors ${
                    currentBand === band
                      ? "border-[#111111] bg-[#111111] text-white"
                      : "border-black/10 bg-white text-neutral-600 hover:border-black/30"
                  }`}
                >
                  {band.toFixed(1)}
                </button>
              ))}
            </div>
          </div>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-10 w-full bg-[#111111] text-xs font-medium text-white hover:bg-black"
          >
            {isSubmitting ? "Creating…" : "Create account"}
          </Button>
        </form>

        <p className="border-t border-black/5 pt-4 text-center text-xs text-neutral-500">
          Have an account?{" "}
          <Link href="/login" className="font-medium text-[#111111] underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
