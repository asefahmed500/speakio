"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  FileText,
  Headphones,
  Mic,
  Clock,
  Sparkles,
  ShieldCheck,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"

interface TestSetSummary {
  id: string
  title: string
  skill: string
  moduleType: string
  timeLimitMinutes: number
  isMock: boolean
  questionCount: number
}

interface SkillSummary {
  latestBand: number | null
  attemptsCount: number
  attempts: Array<{
    id: string
    title: string
    status: string
    submittedAt: string | null
    bandScore: number | null
  }>
  bandHistory: Array<{ band: number; date: string }>
}

export type SkillKey = "LISTENING" | "READING" | "WRITING" | "SPEAKING"

const SKILL_CONFIG: Record<
  SkillKey,
  {
    title: string
    subtitle: string
    description: string
    cta: string
    icon: React.ElementType
    criteria: string[]
    note?: string
  }
> = {
  LISTENING: {
    title: "Listening Simulation",
    subtitle: "IELTS Audio Comprehension & Note Taking",
    description:
      "4 continuous sections covering everyday dialogues, orientation lectures, and academic discussions. Auto-graded with official IELTS mark-to-band conversion.",
    cta: "Start Listening Test",
    icon: Headphones,
    criteria: ["Section 1: Social Dialogue", "Section 2: Monologue", "Section 3: Academic Discussion", "Section 4: University Lecture"],
    note: "Official audio plays concurrently. You may enter answers as you listen.",
  },
  READING: {
    title: "Reading Simulation",
    subtitle: "Academic Comprehension & Speed Reading",
    description:
      "Authentic academic articles with split-screen reading. Evaluates skimming, scanning, True/False/Not Given, and argument comprehension.",
    cta: "Start Reading Test",
    icon: BookOpen,
    criteria: ["Passage 1: Factual Foundation", "Passage 2: Analytical Narrative", "Passage 3: Complex Argumentation"],
    note: "Split-screen interface with text size controls and bottom question navigator.",
  },
  WRITING: {
    title: "Writing AI Studio",
    subtitle: "Task 1 & Task 2 Multi-Criteria Rubric",
    description:
      "Write your essay on an official IELTS computer-delivered desk. Scored across all 4 official IELTS criteria by autonomous LangGraph AI review agents.",
    cta: "Begin Writing Exam",
    icon: FileText,
    criteria: ["Task Achievement / Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"],
    note: "Requires a minimum of 20 words for short exercises. Official exams expect 150 words (Task 1) and 250 words (Task 2).",
  },
  SPEAKING: {
    title: "Speaking Voice Examiner",
    subtitle: "Interactive AI Senior Examiner Interview",
    description:
      "Speak directly with AI Examiner Dr. Arthur Pendelton. Part 1 interview, Part 2 cue-card with 1-min prep notepad, and Part 3 analytical discussion.",
    cta: "Enter Examiner Room",
    icon: Mic,
    criteria: ["Fluency & Coherence", "Lexical Resource", "Grammatical Range", "Pronunciation & Phonetics"],
    note: "Recorded audio is transcribed with GLM-ASR and scored with dual-pass AI review agents.",
  },
}

export function SkillTestsPage({ skill }: { skill: SkillKey }) {
  const config = SKILL_CONFIG[skill]
  const Icon = config.icon

  const [tests, setTests] = useState<TestSetSummary[] | null>(null)
  const [summary, setSummary] = useState<SkillSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSkillData = useCallback(async () => {
    const [testsResult, summaryResult] = await Promise.all([
      apiFetch<TestSetSummary[]>(`/tests?skill=${skill}`),
      apiFetch<SkillSummary>(`/dashboard/skills/${skill}`),
    ])
    if (testsResult.error || !testsResult.data) {
      setError(testsResult.error?.message ?? "Failed to load practice tests.")
      setTests(null)
    } else {
      setTests(testsResult.data.filter((t) => t.questionCount > 0))
      setError(null)
    }
    if (!summaryResult.error && summaryResult.data) {
      setSummary(summaryResult.data)
    }
    setLoading(false)
  }, [skill])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) return fetchSkillData()
    })
    return () => {
      active = false
    }
  }, [fetchSkillData])

  const retryFetch = () => {
    setLoading(true)
    void fetchSkillData()
  }

  return (
    <div className="relative min-h-0 bg-background text-foreground">
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

      <div className="w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* Skill Hero Card */}
        <div className="relative overflow-hidden rounded-3xl border border-border bg-surface-subtle p-6 sm:p-8 backdrop-blur-2xl shadow-2xl space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted text-foreground">
                <Icon className="size-7" />
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-3 py-0.5 text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
                  <span>IELTS OFFICIAL MODULE</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{skill}</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                  {config.title}
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-xl leading-relaxed">
                  {config.description}
                </p>
              </div>
            </div>

            {/* Quick KPI stats */}
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-border bg-surface-subtle p-4 text-center min-w-[100px]">
                <p className="text-[10px] font-mono uppercase text-muted-foreground">LATEST BAND</p>
                <p className="text-2xl font-bold font-mono text-foreground mt-1 tabular-nums">
                  {loading ? "…" : summary?.latestBand != null ? summary.latestBand.toFixed(1) : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-subtle p-4 text-center min-w-[100px]">
                <p className="text-[10px] font-mono uppercase text-muted-foreground">ATTEMPTS</p>
                <p className="text-2xl font-bold font-mono text-foreground mt-1 tabular-nums">
                  {loading ? "…" : summary?.attemptsCount ?? 0}
                </p>
              </div>
            </div>
          </div>

          {/* Criteria Pills */}
          <div className="border-t border-border pt-4 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground uppercase mr-1">Evaluated on:</span>
            {config.criteria.map((c, i) => (
              <span
                key={i}
                className="rounded-full border border-border bg-surface-subtle px-3 py-1 text-xs text-muted-foreground font-mono"
              >
                {c}
              </span>
            ))}
          </div>

          {config.note && (
            <div className="rounded-xl border border-border bg-muted px-4 py-3 text-xs text-foreground flex items-center gap-2.5">
              <Sparkles className="size-4 shrink-0 text-muted-foreground" />
              <span>{config.note}</span>
            </div>
          )}
        </div>

        {/* Loading Skeleton */}
        {loading && (
          <div className="space-y-4" role="status" aria-live="polite">
            <div className="h-28 rounded-2xl border border-border bg-surface-subtle animate-pulse" />
            <div className="h-28 rounded-2xl border border-border bg-surface-subtle animate-pulse" />
            <span className="sr-only">Loading practice tests…</span>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center space-y-4">
            <AlertCircle className="size-8 text-red-700 mx-auto" aria-hidden />
            <p className="text-sm text-red-700">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={retryFetch}
              className="border-border bg-card text-foreground hover:bg-muted"
            >
              Retry Loading Tests
            </Button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && tests && tests.length === 0 && (
          <div className="rounded-3xl border border-border bg-surface-subtle p-8 text-center space-y-3">
            <ShieldCheck className="size-8 text-muted-foreground mx-auto" />
            <h2 className="text-base font-semibold text-foreground">No Practice Sets Available</h2>
            <p className="text-xs text-muted-foreground">
              New {config.title.toLowerCase()} materials are being synchronized. Please check back shortly.
            </p>
          </div>
        )}

        {/* Test Sets List */}
        {!loading && !error && tests && tests.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Available Practice Sets</h2>
                <p className="text-xs text-muted-foreground">Timed IELTS exam sets with full multi-agent diagnostic</p>
              </div>
              <span className="text-xs font-mono text-muted-foreground">{tests.length} SETS AVAILABLE</span>
            </div>

            <div className="space-y-3">
              {tests.map((test) => (
                <div
                  key={test.id}
                  className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5 backdrop-blur-xl transition-all hover:border-primary/40 hover:bg-surface-subtle hover:shadow-lg hover:shadow-cyan-500/5"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {test.moduleType}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">·</span>
                      <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                        <Clock className="size-3" /> {test.timeLimitMinutes} min
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">·</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {test.questionCount} {test.questionCount === 1 ? "question" : "questions"}
                      </span>
                    </div>

                    <h3 className="text-base font-medium text-foreground group-hover:text-muted-foreground transition-colors truncate">
                      {test.title}
                    </h3>
                  </div>

                  <Link
                    href={`/test/${test.id}/take`}
                    className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-medium text-black hover:bg-neutral-200 shadow-md transition-all active:scale-95 self-start sm:self-auto"
                  >
                    <span>{config.cta}</span>
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Attempts History */}
        {!loading && summary && summary.attempts.length > 0 && (
          <div className="rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Recent {config.title} History</h2>
                <p className="text-xs text-muted-foreground">Review candidate diagnostic records and scorecards</p>
              </div>
              <span className="text-xs font-mono text-muted-foreground">LATEST {summary.attempts.length} ATTEMPTS</span>
            </div>

            <div className="space-y-2.5">
              {summary.attempts.slice(0, 6).map((attempt) => (
                <Link
                  key={attempt.id}
                  href={`/results/${attempt.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-subtle p-4 transition-all hover:border-white/25 hover:bg-surface-subtle"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground truncate">{attempt.title}</p>
                    {attempt.submittedAt && (
                      <p className="text-xs text-muted-foreground">
                        Submitted {new Date(attempt.submittedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="rounded-lg border border-border bg-card px-2.5 py-1 font-mono text-sm font-semibold text-foreground tabular-nums">
                      {attempt.bandScore != null ? `Band ${attempt.bandScore.toFixed(1)}` : "In Evaluation"}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
