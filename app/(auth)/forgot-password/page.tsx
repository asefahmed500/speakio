"use client"

import React, { useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/auth-shell"
import { apiFetch } from "@/lib/api-client"

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
})
type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    const { error } = await apiFetch("/auth/forgot-password", {
      method: "POST",
      json: data,
      timeoutMs: 45_000,
    })
    if (error) {
      setServerError(error.message)
      return
    }
    // Always the same message — the server never reveals account existence.
    setSent(true)
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Reset password</h1>
          <p className="mt-1 text-xs text-neutral-500">We&apos;ll email you a reset link.</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <p className="border-l-2 border-[#111111] bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-700">
              If an account exists for that email, a reset link has been sent. Check your inbox and spam folder.
            </p>
            <Link href="/login" className="block text-center text-xs font-medium underline underline-offset-4">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            {serverError && (
              <p role="alert" className="border-l-2 border-[#111111] bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                {serverError}
              </p>
            )}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
              <div>
                <label htmlFor="fp-email" className="text-xs font-medium">Email</label>
                <Input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...register("email")}
                  className="mt-1 h-10 border-black/10 bg-white text-sm text-[#111111] placeholder:text-neutral-400"
                />
                {errors.email && <p className="mt-1 text-[11px] text-neutral-600">{errors.email.message}</p>}
              </div>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-10 w-full bg-[#111111] text-xs font-medium text-white hover:bg-black"
              >
                {isSubmitting ? "Sending…" : "Send reset link"}
              </Button>
            </form>
            <p className="border-t border-black/5 pt-4 text-center text-xs text-neutral-500">
              Remembered it?{" "}
              <Link href="/login" className="font-medium text-[#111111] underline underline-offset-4">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </AuthShell>
  )
}
