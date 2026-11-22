/**
 * Certificate verification service — the single client-side entry point for
 * the public verification workflow. The backend (CertificatesService.verify)
 * remains the source of truth; this service owns the transport contract and
 * the typed result so every consumer (server component, client form, or future
 *embed) uses identical logic instead of duplicating fetch calls.
 */
import { API_URL } from "@/lib/api-client"

export type PublicCertificateStatus = "ACTIVE" | "REVOKED"

export interface PublicCertificate {
  status: PublicCertificateStatus
  certificateNumber: string
  candidateName: string
  overallBand: number
  issuedAt: string
  revokedAt: string | null
}

export type VerificationResult =
  | { kind: "VALID"; certificate: PublicCertificate }
  | { kind: "NOT_FOUND" }
  | { kind: "UNREACHABLE" }

/**
 * Verifies a code without authentication. Never throws — transport and
 * server failures are represented as typed outcomes so callers always render
 * a real state instead of a fake success.
 */
export async function verifyCertificate(
  code: string,
): Promise<VerificationResult> {
  try {
    const response = await fetch(
      `${API_URL}/certificates/verify/${encodeURIComponent(code)}`,
      { cache: "no-store" },
    )
    if (response.status === 404) return { kind: "NOT_FOUND" }
    if (!response.ok) return { kind: "UNREACHABLE" }
    const raw = (await response.json()) as unknown
    // Validate the full shape: an unvalidated 200 (stub, proxy error page, or
    // partial API response) used to reach overallBand.toFixed() in the RSC
    // page and throw a 500 instead of the honest "service busy" state.
    if (!raw || typeof raw !== "object") return { kind: "UNREACHABLE" }
    const c = raw as Record<string, unknown>
    const valid =
      (c.status === "ACTIVE" || c.status === "REVOKED") &&
      typeof c.certificateNumber === "string" &&
      typeof c.candidateName === "string" &&
      typeof c.overallBand === "number" &&
      Number.isFinite(c.overallBand) &&
      typeof c.issuedAt === "string" &&
      (c.revokedAt === null || typeof c.revokedAt === "string")
    if (!valid) return { kind: "UNREACHABLE" }
    // Both ACTIVE and REVOKED are real verification outcomes — the badge is
    // rendered from certificate.status, never inferred from a fake state.
    return { kind: "VALID", certificate: raw as PublicCertificate }
  } catch {
    return { kind: "UNREACHABLE" }
  }
}
