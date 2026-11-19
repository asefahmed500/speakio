"use client"

import React, { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/auth-shell"
import { apiFetch } from "@/lib/api-client"

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(128),
    confirm: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  })
type FormData = z.infer<typeof schema>

function ResetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    const { error } = await apiFetch("/auth/reset-password", {
      method: "POST",
      json: { token, newPassword: data.password },
      timeoutMs: 45_000,
    })
    if (error) {
      setServerError(error.message)
      return
    }
    router.push("/login")
  }

  if (!token) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Invalid link</h1>
        <p className="text-xs text-neutral-600">This reset link is missing its token.</p>
        <Link href="/forgot-password" className="block text-xs font-medium underline underline-offset-4">
          Request a new link
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Choose a new password</h1>
        <p className="mt-1 text-xs text-neutral-500">The link expires in 30 minutes.</p>
      </div>

      {serverError && (
        <p role="alert" className="border-l-2 border-[#111111] bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          {serverError}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div>
          <label htmlFor="rp-password" className="text-xs font-medium">New password</label>
          <Input
            id="rp-password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            {...register("password")}
            className="mt-1 h-10 border-black/10 bg-white text-sm text-[#111111] placeholder:text-neutral-400"
          />
          {errors.password && <p className="mt-1 text-[11px] text-neutral-600">{errors.password.message}</p>}
        </div>
        <div>
          <label htmlFor="rp-confirm" className="text-xs font-medium">Confirm password</label>
          <Input
            id="rp-confirm"
            type="password"
            autoComplete="new-password"
            {...register("confirm")}
            className="mt-1 h-10 border-black/10 bg-white text-sm text-[#111111]"
          />
          {errors.confirm && <p className="mt-1 text-[11px] text-neutral-600">{errors.confirm.message}</p>}
        </div>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-10 w-full bg-[#111111] text-xs font-medium text-white hover:bg-black"
        >
          {isSubmitting ? "Updating…" : "Update password"}
        </Button>
      </form>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-sm text-neutral-400">Loading…</p>}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  )
}
