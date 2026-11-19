import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { AuthShell } from "@/components/auth/auth-shell"
import {
  verifyCertificate,
  type PublicCertificate,
} from "@/lib/services/certificate-verification"

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ certificateId: string }>
}) {
  const { certificateId } = await params
  const result = await verifyCertificate(certificateId)

  return (
    <AuthShell>
      <div className="space-y-6 text-[#111111]">
        {result.kind === "NOT_FOUND" ? (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Result</p>
            <h1 className="text-lg font-semibold tracking-[-0.02em]">Not found</h1>
            <p className="break-all text-xs leading-relaxed text-neutral-600">
              No certificate matches <span className="font-mono">{certificateId}</span>.
            </p>
          </div>
        ) : result.kind === "UNREACHABLE" ? (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Result</p>
            <h1 className="text-lg font-semibold tracking-[-0.02em]">Service busy</h1>
            <p className="text-xs leading-relaxed text-neutral-600">Please refresh and try again.</p>
          </div>
        ) : (
          <VerificationCard certificate={result.certificate} />
        )}

        <div className="flex items-center justify-between border-t border-black/5 pt-4 text-xs">
          <Link href="/verify" className="flex items-center gap-1 font-medium underline underline-offset-4">
            <ArrowLeft className="size-3" aria-hidden /> Another code
          </Link>
          <Link href="/" className="text-neutral-500 hover:text-[#111111]">
            Home
          </Link>
        </div>
      </div>
    </AuthShell>
  )
}

function VerificationCard({ certificate }: { certificate: PublicCertificate }) {
  const revoked = certificate.status === "REVOKED"
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Certificate</p>
        <h1 className="text-lg font-semibold tracking-[-0.02em]">
          {revoked ? "Revoked" : "Verified"}
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          {revoked && certificate.revokedAt
            ? `Revoked ${new Date(certificate.revokedAt).toLocaleDateString()}`
            : "Valid credential"}
        </p>
      </div>

      <dl className="divide-y divide-black/5 border-y border-black/5 text-sm">
        <Row label="Candidate" value={certificate.candidateName} />
        <Row label="Band" value={certificate.overallBand.toFixed(1)} />
        <Row label="Number" value={certificate.certificateNumber} mono />
        <Row
          label="Issued"
          value={new Date(certificate.issuedAt).toLocaleDateString(undefined, {
            dateStyle: "medium",
          })}
        />
      </dl>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={`text-right text-xs font-medium ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  )
}
