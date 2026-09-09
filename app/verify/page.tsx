"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/auth-shell"
import {
  verifyLookupSchema,
  type VerifyLookupFormData,
} from "@/lib/validations/verify"

export default function VerifyLookupPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VerifyLookupFormData>({
    resolver: zodResolver(verifyLookupSchema),
    defaultValues: { code: "" },
  })

  const onSubmit = async ({ code }: VerifyLookupFormData) => {
    setServerError(null)
    router.push(`/verify/${encodeURIComponent(code)}`)
  }

  return (
    <AuthShell>
      <div className="w-full max-w-lg border border-border bg-card shadow-[0_1px_2px_rgba(28,27,24,0.05)]">
        <div className="border-b border-border px-6 py-5 sm:px-8">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
            <ShieldCheck className="size-3.5 text-primary" aria-hidden />
            Public verification
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Verify a certificate
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Enter the code printed on the certificate. No sign-in required — anyone
            can confirm a result in seconds.
          </p>
        </div>

        <div className="px-6 py-6 sm:px-8">
          {serverError && (
            <div role="alert" className="mb-4 border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="verify-code" className="text-xs font-medium text-foreground">
                Certificate code
              </label>
              <Input
                id="verify-code"
                type="text"
                autoComplete="off"
                spellCheck={false}
                {...register("code")}
                placeholder="SPK-2026-0000-000"
                aria-invalid={Boolean(errors.code)}
                className={`h-10 font-mono ${errors.code ? "border-destructive focus-visible:ring-destructive" : ""}`}
              />
              {errors.code && (
                <p className="text-xs leading-tight text-destructive">{errors.code.message}</p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting} className="h-10 w-full cursor-pointer">
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" data-icon="inline-start" aria-hidden />
                  Verifying…
                </>
              ) : (
                <>
                  Verify certificate
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </>
              )}
            </Button>
          </form>

          <p className="mt-5 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
            Certificates record participation in AI-assisted IELTS practice
            assessments with human examiner review — not an official test report
            form.
          </p>
        </div>
      </div>
    </AuthShell>
  )
}
