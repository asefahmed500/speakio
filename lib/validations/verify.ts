import { z } from "zod"

/** Certificate codes look like SPK-2026-8891-B80 — letters, digits and dashes. */
export const verifyLookupSchema = z.object({
  // Normalize BEFORE validating — a pasted code with surrounding whitespace
  // used to be rejected by the regex even though the transform would have
  // cleaned it afterwards.
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Enter the certificate code")
    .regex(
      /^[A-Z0-9-]{6,40}$/,
      "Codes contain only letters, numbers and dashes (e.g. SPK-2026-8891-B80)"
    ),
})

export type VerifyLookupFormData = z.infer<typeof verifyLookupSchema>
