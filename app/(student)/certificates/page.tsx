"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  Award,
  Copy,
  Check,
  Download,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
} from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import { apiFetch, API_URL } from "@/lib/api-client"

interface Certificate {
  id: string
  certificateNumber: string
  overallBand: number
  verificationCode: string
  status: string
  issuedAt: string
  revokedAt: string | null
  revocationReason: string | null
}

export default function CertificatesPage() {
  const [certificates, setCertificates] = useState<Certificate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  // Download/revoke failures must not clobber the list-fetch error state —
  // the top-level error's "Retry" button refetches the list, not the action.
  const [actionError, setActionError] = useState<string | null>(null)

  const fetchCertificates = useCallback(async () => {
    const { data, error: fetchError } = await apiFetch<Certificate[]>("/certificates")
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load certificates.")
      setCertificates(null)
    } else {
      setCertificates(data)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Deferred to a microtask so the effect body never mutates state synchronously.
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchCertificates()
    })
    return () => {
      active = false
    }
  }, [fetchCertificates])

  const retry = () => {
    setLoading(true)
    void fetchCertificates()
  }

  const handleCopy = async (cert: Certificate) => {
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/verify/${cert.verificationCode}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(cert.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // Clipboard unavailable (insecure context) — fall back to prompt.
      window.prompt("Copy the verification link:", url)
    }
  }

  const handleDownload = async (cert: Certificate) => {
    setDownloadingId(cert.id)
    setActionError(null)
    try {
      const res = await fetch(`${API_URL}/certificates/${cert.id}/pdf`, {
        credentials: "include",
      })
      if (!res.ok) {
        setActionError(
          res.status === 409
            ? "PDF download is unavailable for revoked certificates."
            : "Failed to generate the PDF. Please try again.",
        )
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `speakio-certificate-${cert.certificateNumber}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      setActionError("The download was interrupted. Please check your connection and try again.")
    } finally {
      setDownloadingId(null)
    }
  }

  const handleConfirmRevoke = async () => {
    if (!revokingId) return
    setRevokeError(null)
    const { error: revokeError } = await apiFetch(`/certificates/${revokingId}/revoke`, {
      method: "POST",
      json: { reason: "Revoked by holder" },
    })
    if (revokeError) {
      // Keep the dialog open with the real error instead of faking success.
      setRevokeError(revokeError.message)
      return
    }
    setRevokingId(null)
    await fetchCertificates()
  }

  const handleIssue = async () => {
    setIssuing(true)
    setIssueError(null)
    const { error: issueErr } = await apiFetch<Certificate>("/certificates", { method: "POST" })
    if (issueErr) {
      setIssueError(issueErr.message)
    } else {
      await fetchCertificates()
    }
    setIssuing(false)
  }

  return (
    <div className="flex-1 bg-surface-subtle">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Certificates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete all four skills to issue a verifiable certificate of participation.
          </p>
        </div>

        {loading && (
          <div className="space-y-3" role="status" aria-live="polite">
            <div className="h-28 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            <div className="h-28 rounded-xl bg-border/40 animate-pulse" aria-hidden />
            <span className="sr-only">Loading certificates…</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => retry()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && certificates?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 sm:p-12 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-none bg-primary/10 flex items-center justify-center">
              <Award className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">No certificates yet</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Earn a certificate by completing one scored attempt in each of the four skills:
                listening, reading, writing and speaking.
              </p>
            </div>
            <ButtonLink className="cursor-pointer" href="/skills/listening">
              Start practising <ArrowRight className="ml-2 h-3.5 w-3.5" aria-hidden />
            </ButtonLink>
          </div>
        )}

        {!loading && !error && certificates && certificates.length > 0 && (
          <div className="space-y-4">
            <Button onClick={() => void handleIssue()} disabled={issuing} className="cursor-pointer">
              {issuing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Checking eligibility…
                </>
              ) : (
                <>
                  <Award className="mr-2 h-4 w-4" aria-hidden /> Issue new certificate
                </>
              )}
            </Button>
            {issueError && (
              <p role="alert" className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
                {issueError}
              </p>
            )}
            {actionError && (
              <p role="alert" className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                {actionError}
              </p>
            )}

            {certificates.map((cert) => {
              const isRevoked = cert.status !== "ACTIVE"
              return (
                <div
                  key={cert.id}
                  role="group"
                  aria-label={`Certificate ${cert.certificateNumber}`}
                  className="rounded-xl border border-border bg-card p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        {isRevoked ? (
                          <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden />
                        ) : (
                          <ShieldCheck className="h-5 w-5 text-success" aria-hidden />
                        )}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{cert.certificateNumber}</span>
                          <span
                            className={`rounded-none px-2 py-0.5 text-[10px] font-medium border ${
                              isRevoked
                                ? "border-destructive/30 bg-destructive/10 text-destructive"
                                : "border-success/30 bg-success/10 text-success"
                            }`}
                          >
                            {isRevoked ? "REVOKED" : "ACTIVE"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Overall band {cert.overallBand.toFixed(1)} · Issued{" "}
                          {new Date(cert.issuedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                          {isRevoked && cert.revocationReason && ` · ${cert.revocationReason}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="text-2xl font-semibold text-primary tabular-nums">
                        {cert.overallBand.toFixed(1)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Band</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
                    {!isRevoked && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDownload(cert)}
                        disabled={downloadingId === cert.id}
                        className="cursor-pointer"
                      >
                        {downloadingId === cert.id ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
                        )}
                        Download PDF
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCopy(cert)}
                      className="cursor-pointer"
                    >
                      {copiedId === cert.id ? (
                        <Check className="mr-2 h-3.5 w-3.5 text-success" aria-hidden />
                      ) : (
                        <Copy className="mr-2 h-3.5 w-3.5" aria-hidden />
                      )}
                      {copiedId === cert.id ? "Link copied" : "Copy verify link"}
                    </Button>
                    <span className="flex-1" />
                    <Link
                      href={`/verify/${cert.verificationCode}`}
                      className="text-xs text-primary font-medium hover:underline"
                    >
                      Public verification page
                    </Link>
                    {!isRevoked && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokingId(cert.id)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={revokingId != null}
        title="Revoke this certificate?"
        description="The certificate will be permanently marked as revoked. Anyone verifying its code will see the REVOKED status. This cannot be undone."
        intent="destructive"
        confirmLabel="Revoke Certificate"
        cancelLabel="Keep Certificate"
        onConfirm={handleConfirmRevoke}
        onCancel={() => {
          setRevokeError(null)
          setRevokingId(null)
        }}
        error={revokeError}
      />
    </div>
  )
}

