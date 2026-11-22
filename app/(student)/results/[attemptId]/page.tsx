"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  ArrowLeft,
  FileText,
  ArrowRight,
  ShieldCheck,
  Bot,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"

interface AttemptResult {
  id: string
  status: "IN_PROGRESS" | "SUBMITTED" | "SCORING" | "NEEDS_REVIEW" | "COMPLETED"
  startedAt: string
  submittedAt: string | null
  testSet: {
    id: string
    title: string
    skill: "LISTENING" | "READING" | "WRITING" | "SPEAKING" | "FULL_MOCK"
    timeLimitMinutes: number
  }
  score: {
    bandScore: number
    skill: string
    taskAchievement: number | null
    coherenceCohesion: number | null
    lexicalResource: number | null
    grammaticalAccuracy: number | null
    fluencyCoherence: number | null
    pronunciation: number | null
    feedbackSummary: string | null
    inlineFeedbackJson: unknown
    scoredBy: string
    confidence: number | null
    createdAt: string
  } | null
  questions: Array<{ id: string; prompt: string; questionType: string }>
  answers: Record<string, string> | null
  answerText: string | null
}

interface AutoGradeDetail {
  perQuestion?: Array<{ questionId: string; given: string; correct: boolean; expected?: string }>
  correctCount?: number
  total?: number
}

interface InlineCorrection {
  originalText: string
  correctedText: string
  explanation: string
}

interface WritingFeedback {
  criterionFeedback?: Partial<
    Record<
      | "taskAchievement"
      | "coherenceCohesion"
      | "lexicalResource"
      | "grammaticalAccuracy"
      | "fluencyCoherence"
      | "pronunciation",
      string
    >
  >
  transcript?: string
  inlineCorrections?: InlineCorrection[]
}

function getCefrLevel(band: number): string {
  if (band >= 8.5) return "C2 Mastery / Native Proficiency"
  if (band >= 7.0) return "C1 Operational / Advanced"
  if (band >= 5.5) return "B2 Independent / Upper Intermediate"
  if (band >= 4.0) return "B1 Threshold / Intermediate"
  return "A2 Waystage / Elementary"
}

export default function ResultPage() {
  const params = useParams<{ attemptId: string }>()
  const attemptId = params?.attemptId

  const [result, setResult] = useState<AttemptResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreError, setRescoreError] = useState<string | null>(null)

  const fetchResult = useCallback(async () => {
    if (!attemptId) return
    const { data, error: fetchError } = await apiFetch<AttemptResult>(`/attempts/${attemptId}`)
    if (fetchError || !data) {
      setError(fetchError?.message ?? "Failed to load the result.")
      setErrorStatus(fetchError?.status ?? 0)
      setResult(null)
    } else {
      setResult(data)
      setError(null)
      setErrorStatus(null)
    }
    setLoading(false)
  }, [attemptId])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchResult()
    })
    return () => {
      active = false
    }
  }, [fetchResult])

  // While AI scoring is in flight, poll every 8 seconds until completed
  useEffect(() => {
    if (result?.status !== "SCORING" && result?.status !== "NEEDS_REVIEW") return
    const interval = setInterval(() => void fetchResult(), 8_000)
    return () => clearInterval(interval)
  }, [result?.status, fetchResult])

  const router = useRouter()
  const inProgress = result?.status === "IN_PROGRESS"

  useEffect(() => {
    if (inProgress && result) {
      router.replace(`/test/${result.testSet.id}/take`)
    }
  }, [inProgress, result, router])

  const retryFetch = () => {
    setLoading(true)
    void fetchResult()
  }

  const rescore = async () => {
    setRescoring(true)
    setRescoreError(null)
    const { error: rescoreError } = await apiFetch(`/attempts/${attemptId}/rescore`, {
      method: "POST",
      timeoutMs: 0,
    })
    if (rescoreError) {
      setRescoreError(rescoreError.message)
    } else {
      await fetchResult()
    }
    setRescoring(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-col items-center justify-center bg-background text-foreground p-4">
        <div className="text-center space-y-4">
          <Loader2 className="size-8 animate-spin text-muted-foreground mx-auto" aria-hidden />
          <p className="text-sm text-muted-foreground">Retrieving official diagnostic result…</p>
        </div>
      </div>
    )
  }

  if (errorStatus === 404 || errorStatus === 403) {
    return (
      <div className="flex min-h-0 flex-col items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="size-10 text-muted-foreground mx-auto" aria-hidden />
          <h1 className="text-xl font-semibold text-foreground">Diagnostic Record Not Available</h1>
          <p className="text-sm text-muted-foreground">
            {errorStatus === 404
              ? "This examination attempt was not found."
              : "You do not have authorization to view this diagnostic record."}
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-black hover:bg-neutral-200"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (error || !result) {
    return (
      <div className="flex min-h-0 flex-col items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="size-10 text-red-700 mx-auto" aria-hidden />
          <h1 className="text-xl font-semibold text-foreground">Something Went Wrong</h1>
          <p className="text-sm text-red-700">{error ?? "An unexpected error occurred."}</p>
          <Button onClick={retryFetch} className="rounded-xl bg-white text-black hover:bg-neutral-200">
            Retry Connection
          </Button>
        </div>
      </div>
    )
  }

  const score = result.score
  const isWriting = result.testSet.skill === "WRITING"
  const isSpeaking = result.testSet.skill === "SPEAKING"
  const autoDetail = (score?.inlineFeedbackJson ?? null) as AutoGradeDetail | null
  const writingFeedback = (score?.inlineFeedbackJson ?? null) as WritingFeedback | null
  const inlineCorrections = writingFeedback?.inlineCorrections ?? []
  const criterionFeedback = writingFeedback?.criterionFeedback ?? {}

  return (
    <div className="relative min-h-0 bg-background text-foreground pb-16">
      {/* Ambient Lighting Orbs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-primary/5 blur-[130px]" />
        <div className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full bg-primary/5 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      <div className="w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Top Breadcrumb */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>RETURN TO DASHBOARD</span>
          </Link>

          <span className="text-xs font-mono text-muted-foreground truncate">
            EXAM ID: {result.id.slice(0, 8).toUpperCase()}
          </span>
        </div>

        {/* Evaluation In-Flight States */}
        {result.status === "SCORING" && (
          <div className="rounded-3xl border border-primary/30 bg-muted p-6 backdrop-blur-xl flex items-start gap-4">
            <Loader2 className="size-6 animate-spin text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">AI Examiner Evaluation in Progress</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Autonomous LangGraph review agents are evaluating your submission across all four official
                IELTS criteria. This page updates automatically once your band score is finalized.
              </p>
            </div>
          </div>
        )}

        {result.status === "NEEDS_REVIEW" && (
          <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 backdrop-blur-xl flex items-start gap-4">
            <Clock className="size-6 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">Senior Re-evaluation in Progress</h2>
              <p className="text-xs text-amber-700 leading-relaxed">
                Your submission was flagged for an additional review pass. This page updates automatically
                as soon as the final band is published.
              </p>
            </div>
          </div>
        )}

        {result.status === "SUBMITTED" && (
          <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 backdrop-blur-xl space-y-4">
            <div className="flex items-start gap-3.5">
              <Clock className="size-6 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">Submission Stored — Ready for Scoring</h2>
                <p className="text-xs text-amber-700">
                  Your exam answers are safely persisted. Trigger the AI examiner scoring engine below.
                </p>
              </div>
            </div>

            {rescoreError && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700">
                {rescoreError}
              </p>
            )}

            {result.testSet.skill === "FULL_MOCK" ? (
              <p className="text-xs text-amber-700">
                Full mock re-scoring is not available on this deployment. Your answers are safely stored.
              </p>
            ) : (
            <Button
              onClick={() => void rescore()}
              disabled={rescoring}
              className="rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-medium cursor-pointer"
            >
              {rescoring ? (
                <>
                  <Loader2 className="size-3.5 mr-2 animate-spin" /> Scoring in progress…
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5 mr-2" /> Start AI Evaluation
                </>
              )}
            </Button>
            )}
          </div>
        )}

        {/* Completed Score Report Form */}
        {result.status === "COMPLETED" && score && (
          <div className="space-y-6">
            {/* TRF Official Hero Card */}
            <div className="relative overflow-hidden rounded-3xl border border-border bg-surface-subtle p-6 sm:p-8 backdrop-blur-2xl shadow-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-6 border-b border-border">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-3 py-1 text-[11px] font-mono tracking-widest text-muted-foreground uppercase">
                    <ShieldCheck className="size-3.5 text-muted-foreground" />
                    <span>Official IELTS Diagnostic TRF</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    {result.testSet.title}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    Module: <span className="text-foreground font-medium">{result.testSet.skill}</span> · Completed{" "}
                    {result.submittedAt
                      ? new Date(result.submittedAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "—"}
                  </p>
                </div>

                {/* Overall Band Score Pill Badge */}
                <div className="flex flex-col items-start sm:items-end">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">OVERALL</span>
                    <span className="text-5xl font-extrabold tracking-tight font-mono text-foreground tabular-nums">
                      {score.bandScore.toFixed(1)}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground mt-1">
                    {getCefrLevel(score.bandScore)}
                  </span>
                </div>
              </div>

              {/* Verified Badges and Meta */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  {score.scoredBy === "ADMIN_OVERRIDE" && (
                    <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-0.5 text-[11px] font-mono text-emerald-700">
                      VERIFIED BY SENIOR INSTRUCTOR
                    </span>
                  )}
                  {score.scoredBy === "AI_REVIEW_GLM" && (
                    <span className="rounded-full border border-primary/40 bg-muted px-3 py-0.5 text-[11px] font-mono text-muted-foreground">
                      DUAL-PASS LANGGRAPH AGENT REVIEW
                    </span>
                  )}
                  {autoDetail?.correctCount != null && autoDetail.total != null && (
                    <span className="rounded-full border border-border bg-surface-subtle px-3 py-0.5 text-[11px] font-mono text-muted-foreground">
                      {autoDetail.correctCount} OF {autoDetail.total} ITEMS CORRECT ({Math.round((autoDetail.correctCount / autoDetail.total) * 100)}%)
                    </span>
                  )}
                </div>

                {["LISTENING", "READING", "WRITING", "SPEAKING"].includes(result.testSet.skill) && (
                  <Link
                    href={`/skills/${result.testSet.skill.toLowerCase()}`}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition-colors"
                  >
                    <span>Practice this skill again</span>
                    <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            </div>

            {/* Criteria Breakdown Grid */}
            {/* Writing Criteria */}
            {isWriting && score.taskAchievement != null && (
              <div className="rounded-3xl border border-border bg-surface-subtle p-6 sm:p-8 backdrop-blur-xl space-y-6">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Official IELTS Assessment Criteria</h2>
                    <p className="text-xs text-muted-foreground">Multi-criteria analysis graded on 0.0 – 9.0 band scale</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">4 CRITERIA EVALUATED</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { label: "Task Achievement / Response", value: score.taskAchievement, key: "taskAchievement" },
                    { label: "Coherence & Cohesion", value: score.coherenceCohesion, key: "coherenceCohesion" },
                    { label: "Lexical Resource", value: score.lexicalResource, key: "lexicalResource" },
                    { label: "Grammatical Range & Accuracy", value: score.grammaticalAccuracy, key: "grammaticalAccuracy" },
                  ].map((c) => (
                    <div
                      key={c.key}
                      className="rounded-2xl border border-border bg-surface-subtle p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
                        <span className="font-mono text-base font-bold text-foreground tabular-nums">
                          Band {c.value?.toFixed(1) ?? "—"}
                        </span>
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-card">
                        <div
                          className="h-full bg-primary transition-all duration-500"
                          style={{ width: `${((c.value ?? 0) / 9) * 100}%` }}
                        />
                      </div>

                      {criterionFeedback[c.key as keyof typeof criterionFeedback] && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {criterionFeedback[c.key as keyof typeof criterionFeedback]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Speaking Criteria */}
            {isSpeaking && score.fluencyCoherence != null && (
              <div className="rounded-3xl border border-border bg-surface-subtle p-6 sm:p-8 backdrop-blur-xl space-y-6">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Speaking Assessment Criteria</h2>
                    <p className="text-xs text-muted-foreground">Phonetic, fluency, and structural proficiency</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">4 CRITERIA EVALUATED</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { label: "Fluency & Coherence", value: score.fluencyCoherence, feedback: writingFeedback?.criterionFeedback?.fluencyCoherence },
                    { label: "Lexical Resource", value: score.lexicalResource, feedback: writingFeedback?.criterionFeedback?.lexicalResource },
                    { label: "Grammatical Range & Accuracy", value: score.grammaticalAccuracy, feedback: writingFeedback?.criterionFeedback?.grammaticalAccuracy },
                    { label: "Pronunciation & Intonation", value: score.pronunciation, feedback: writingFeedback?.criterionFeedback?.pronunciation },
                  ].map((c) => (
                    <div
                      key={c.label}
                      className="rounded-2xl border border-border bg-surface-subtle p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
                        <span className="font-mono text-base font-bold text-foreground tabular-nums">
                          Band {c.value?.toFixed(1) ?? "—"}
                        </span>
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-card">
                        <div
                          className="h-full bg-primary transition-all duration-500"
                          style={{ width: `${((c.value ?? 0) / 9) * 100}%` }}
                        />
                      </div>

                      {c.feedback && (
                        <p className="text-xs leading-relaxed text-muted-foreground">{c.feedback}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Detailed Examiner Commentary */}
            {score.feedbackSummary && (
              <div className="rounded-3xl border border-border bg-surface-subtle p-6 sm:p-8 backdrop-blur-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  <Bot className="size-4" />
                  <span>AI Senior Examiner Commentary</span>
                </div>
                <p className="text-sm leading-relaxed text-foreground/85 whitespace-pre-line">
                  {score.feedbackSummary}
                </p>
              </div>
            )}

            {/* Sentence-by-sentence upgrades (Inline Corrections) */}
            {isWriting && inlineCorrections.length > 0 && (
              <div className="rounded-3xl border border-border bg-surface-subtle p-6 sm:p-8 backdrop-blur-xl space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Detailed Grammar & Lexical Upgrades</h2>
                    <p className="text-xs text-muted-foreground">What you wrote vs IELTS Band 8.5+ native revision</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{inlineCorrections.length} CORRECTIONS</span>
                </div>

                <div className="space-y-3">
                  {inlineCorrections.map((c, i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-border bg-surface-subtle p-4 space-y-2"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-red-600 line-through">
                          {c.originalText}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-emerald-700 font-medium">
                          {c.correctedText}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{c.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-graded Question Breakdown (Listening / Reading) */}
            {autoDetail?.perQuestion && autoDetail.perQuestion.length > 0 && (
              <div className="rounded-3xl border border-border bg-surface-subtle p-6 sm:p-8 backdrop-blur-xl space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Item-by-Item Review</h2>
                    <p className="text-xs text-muted-foreground">Comprehensive response verification</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">
                    {autoDetail.perQuestion.length} QUESTIONS REVIEWED
                  </span>
                </div>

                <div className="space-y-3">
                  {autoDetail.perQuestion.map((q, idx) => {
                    const prompt = result.questions.find((pq) => pq.id === q.questionId)?.prompt
                    return (
                      <div
                        key={q.questionId}
                        className={`rounded-2xl border p-4 space-y-2 ${
                          q.correct
                            ? "border-emerald-500/20 bg-emerald-500/5"
                            : "border-rose-500/20 bg-rose-500/5"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs sm:text-sm font-medium text-foreground">
                            <span className="font-mono text-muted-foreground mr-2">{idx + 1}.</span>
                            {prompt || `Question ${idx + 1}`}
                          </p>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide border shrink-0 ${
                              q.correct
                                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-700"
                                : "border-rose-400/40 bg-rose-400/10 text-red-600"
                            }`}
                          >
                            {q.correct ? "Correct" : "Incorrect"}
                          </span>
                        </div>

                        <div className="text-xs space-y-1 text-muted-foreground">
                          <p>
                            Your Answer: <span className="font-mono text-foreground">{q.given || "(None)"}</span>
                          </p>
                          {!q.correct && q.expected && (
                            <p className="text-emerald-700">
                              Correct Key: <span className="font-mono font-medium">{q.expected}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Candidate Submission / ASR Transcript */}
            {result.answerText && (
              <details className="rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl">
                <summary className="text-sm font-semibold text-muted-foreground cursor-pointer flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <span>View Original Submission / Transcript</span>
                </summary>
                <div className="pt-4 border-t border-border mt-3">
                  {isSpeaking && writingFeedback?.transcript ? (
                    <div className="space-y-2">
                      <p className="text-xs font-mono text-muted-foreground">GLM-ASR RECOGNIZED TRANSCRIPT:</p>
                      <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line bg-muted p-4 rounded-xl border border-border">
                        {writingFeedback.transcript}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line bg-muted p-4 rounded-xl border border-border">
                      {result.answerText.startsWith("data:") ? "Audio recording captured." : result.answerText}
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
