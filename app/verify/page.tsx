"use client"

import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/auth-shell"
import { verifyLookupSchema, type VerifyLookupFormData } from "@/lib/validations/verify"

export default function VerifyLookupPage() {
  const router = useRouter()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VerifyLookupFormData>({
    resolver: zodResolver(verifyLookupSchema),
    defaultValues: { code: "" },
  })

  const onSubmit = ({ code }: VerifyLookupFormData) =>
    router.push(`/verify/${encodeURIComponent(code)}`)

  return (
    <AuthShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Verify a certificate</h1>
          <p className="mt-1 text-xs text-neutral-500">Enter the code on the certificate.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div>
            <label htmlFor="verify-code" className="text-xs font-medium">Verification code</label>
            <Input
              id="verify-code"
              autoComplete="off"
              spellCheck={false}
              placeholder="SPK-2026-0000-000"
              {...register("code")}
              aria-invalid={Boolean(errors.code)}
              className="mt-1 h-10 border-black/10 bg-white font-mono text-sm text-[#111111] placeholder:text-muted-foreground"
            />
            {errors.code && <p className="mt-1 text-[11px] text-neutral-600">{errors.code.message}</p>}
          </div>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-10 w-full bg-[#111111] text-xs font-medium text-white hover:bg-black"
          >
            {isSubmitting ? "Checking…" : "Verify"}
          </Button>
        </form>

        <p className="border-t border-black/5 pt-4 text-center text-[11px] text-muted-foreground">
          No sign-in required.
        </p>
      </div>
    </AuthShell>
  )
}
