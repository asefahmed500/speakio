import { z } from "zod"

/** Certificate codes look like SPK-2026-8891-B80 — letters, digits and dashes. */
export const verifyLookupSchema = z.object({
  code: z
    .string()
    .min(1, "Enter the certificate code")
    .regex(
      /^[A-Za-z0-9-]{6,40}$/,
      "Codes contain only letters, numbers and dashes (e.g. SPK-2026-8891-B80)"
    )
    .transform((value) => value.trim().toUpperCase()),
})

export type VerifyLookupFormData = z.infer<typeof verifyLookupSchema>
