import Link from "next/link"
import { ShieldCheck, ShieldX, ShieldAlert } from "lucide-react"

import { API_URL } from "@/lib/api-client"
import { SpeakioLogo } from "@/components/logo"

interface VerifyResult {
  status: "ACTIVE" | "REVOKED"
  certificateNumber: string
  candidateName: string
  overallBand: number
  issuedAt: string
  revokedAt: string | null
}

async function verifyCertificate(code: string): Promise<VerifyResult | "NOT_FOUND" | "UNREACHABLE"> {
  try {
    const res = await fetch(`${API_URL}/certificates/verify/${encodeURIComponent(code)}`, {
      cache: "no-store",
    })
    if (res.status === 404) return "NOT_FOUND"
    if (!res.ok) return "UNREACHABLE"
    return (await res.json()) as VerifyResult
  } catch {
    return "UNREACHABLE"
  }
}

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ certificateId: string }>
}) {
  const { certificateId } = await params
  const result = await verifyCertificate(certificateId)

  return (
    <div className="min-h-screen bg-surface-subtle text-foreground flex flex-col font-sans">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        <SpeakioLogo />
        <span className="text-xs text-muted-foreground">Certificate verification</span>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-lg">
          {result === "NOT_FOUND" ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
              <div className="mx-auto w-14 h-14 rounded-none bg-destructive/10 border border-destructive/30 flex items-center justify-center">
                <ShieldX className="h-7 w-7 text-destructive" aria-hidden />
              </div>
              <h1 className="text-xl font-semibold">Certificate not found</h1>
              <p className="text-sm text-muted-foreground">
                No certificate matches the code{" "}
                <span className="font-medium text-foreground break-all">{certificateId}</span>. Check
                the code and try again, or ask the holder to share their verification link.
              </p>
            </div>
          ) : result === "UNREACHABLE" ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
              <div className="mx-auto w-14 h-14 rounded-none bg-warning/10 border border-warning/30 flex items-center justify-center">
                <ShieldAlert className="h-7 w-7 text-warning" aria-hidden />
              </div>
              <h1 className="text-xl font-semibold">Verification unavailable</h1>
              <p className="text-sm text-muted-foreground">
                The verification service is temporarily unavailable. Please try again shortly.
              </p>
            </div>
          ) : result.status === "REVOKED" ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
              <div className="mx-auto w-14 h-14 rounded-none bg-destructive/10 border border-destructive/30 flex items-center justify-center">
                <ShieldX className="h-7 w-7 text-destructive" aria-hidden />
              </div>
              <h1 className="text-xl font-semibold">Certificate revoked</h1>
              <p className="text-sm text-muted-foreground">
                This certificate existed but has been revoked and is no longer valid
                {result.revokedAt &&
                  ` (revoked ${new Date(result.revokedAt).toLocaleDateString(undefined, { dateStyle: "medium" })})`}
                .
              </p>
              <dl className="text-left text-sm space-y-2 rounded-xl bg-surface-subtle border border-border p-4">
                <Row label="Certificate no." value={result.certificateNumber} />
                <Row label="Holder" value={result.candidateName} />
                <Row label="Overall band" value={result.overallBand.toFixed(1)} />
              </dl>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="mx-auto w-14 h-14 rounded-none bg-success/10 border border-success/30 flex items-center justify-center">
                  <ShieldCheck className="h-7 w-7 text-success" aria-hidden />
                </div>
                <h1 className="text-xl font-semibold">Valid certificate</h1>
                <p className="inline-flex items-center gap-1.5 rounded-none border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">
                  ACTIVE
                </p>
              </div>

              <dl className="text-sm space-y-3 rounded-xl bg-surface-subtle border border-border p-4">
                <Row label="Holder" value={result.candidateName} />
                <Row label="Overall band" value={result.overallBand.toFixed(1)} />
                <Row label="Certificate no." value={result.certificateNumber} />
                <Row
                  label="Issued"
                  value={new Date(result.issuedAt).toLocaleDateString(undefined, { dateStyle: "long" })}
                />
              </dl>

              <p className="text-[11px] text-muted-foreground leading-relaxed text-center">
                This certificate records participation in AI-assisted IELTS practice assessments
                with human examiner review. It is not an official IELTS test report form.
              </p>
            </div>
          )}

          <p className="mt-6 flex items-center justify-center gap-4 text-xs">
            <Link href="/verify" className="font-medium text-primary hover:underline">
              Verify another certificate
            </Link>
            <span aria-hidden className="text-border">
              |
            </span>
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              Speakio home
            </Link>
          </p>
        </div>
      </main>

      <footer className="h-12 border-t border-border bg-card px-4 sm:px-6 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>&copy; {new Date().getFullYear()} Speakio Academic</span>
        <span>Public verification service</span>
      </footer>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right break-all">{value}</dd>
    </div>
  )
}
