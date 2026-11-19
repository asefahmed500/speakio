"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import {
  AlertCircle,
  Loader2,
  CheckCircle2,
  Clock,
  Headphones,
  ArrowRight,
  ZoomIn,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useExamStore } from "@/stores/use-exam-store"
import { apiFetch } from "@/lib/api-client"
import { ExamSoundCheckModal } from "@/components/exam/exam-sound-check"
import { AiSpeakingExaminer } from "@/components/exam/ai-speaking-examiner"
import { ListeningAudioPlayer } from "@/components/exam/listening-audio-player"
import { QuestionNavStrip } from "@/components/exam/question-nav-strip"

interface TestQuestion {
  id: string
  partNumber: number
  questionType: string
  prompt: string
  passage: string | null
  audioUrl: string | null
  orderIndex: number
  options?: string[]
}

interface TestDetail {
  id: string
  title: string
  skill: "LISTENING" | "READING" | "WRITING" | "SPEAKING" | "FULL_MOCK"
  moduleType: "ACADEMIC" | "GENERAL"
  timeLimitMinutes: number
  isMock: boolean
  questions: TestQuestion[]
}

interface AttemptRecord {
  id: string
  status: "IN_PROGRESS" | "SUBMITTED" | "SCORING" | "NEEDS_REVIEW" | "COMPLETED"
  timeRemainingSeconds: number | null
  answersJson: Record<string, string> | null
  resumed?: boolean
}

type Phase = "loading" | "not-found" | "error" | "ready" | "submitting"

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export default function TakeTestPage() {
  const params = useParams<{ testId: string }>()
  const testId = params?.testId
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>("loading")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [test, setTest] = useState<TestDetail | null>(null)
  const [attempt, setAttempt] = useState<AttemptRecord | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle")

  // Sound check modal state
  const [showSoundCheck, setShowSoundCheck] = useState(true)

  // Navigation & reading tools
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  const [readingFontSize, setReadingFontSize] = useState<"normal" | "large">("normal")

  const examStore = useExamStore
  const setDraftAnswer = examStore((s) => s.setAnswer)
  const setEssayText = examStore((s) => s.setEssayText)
  const clearExamDraft = examStore((s) => s.clearExamDraft)
  const markSaved = examStore((s) => s.markSaved)

  const answersRef = useRef(answers)
  const secondsRef = useRef(secondsLeft)
  const attemptRef = useRef(attempt)
  const submittingRef = useRef(false)
  const autoSubmitRef = useRef(false)

  // Speaking state (for submission compatibility)
  const [speakingRecorded, setSpeakingRecorded] = useState(false)

  useEffect(() => {
    answersRef.current = answers
  }, [answers])
  useEffect(() => {
    secondsRef.current = secondsLeft
  }, [secondsLeft])
  useEffect(() => {
    attemptRef.current = attempt
  }, [attempt])

  const autosave = useCallback(async () => {
    const currentAttempt = attemptRef.current
    if (!currentAttempt || submittingRef.current) return
    const { error: autosaveError } = await apiFetch(`/attempts/${currentAttempt.id}`, {
      method: "PATCH",
      timeoutMs: 0,
      json: {
        answers: answersRef.current,
        timeRemainingSeconds: secondsRef.current ?? undefined,
      },
    })
    if (autosaveError) {
      setSaveState("error")
      return
    }
    setSaveState("saved")
    markSaved()
  }, [markSaved])

  const doSubmit = useCallback(
    async (auto = false) => {
      const currentAttempt = attemptRef.current
      if (!currentAttempt || submittingRef.current) return
      submittingRef.current = true
      setBannerError(null)
      setPhase("submitting")

      const { data, error } = await apiFetch<{
        attemptId: string
        status: string
        message?: string
      }>(`/attempts/${currentAttempt.id}/submit`, {
        method: "POST",
        timeoutMs: 0,
        json: {
          answers: answersRef.current,
          timeRemainingSeconds: secondsRef.current ?? undefined,
        },
      })

      if (error || !data) {
        submittingRef.current = false
        if (error && (error.status === 409 || error.status === 404 || error.status === 503)) {
          clearExamDraft()
          router.push(`/results/${currentAttempt.id}`)
          return
        }
        setPhase("ready")
        setBannerError(
          error?.status === 400
            ? error.message
            : auto
              ? "Time expired, but automatic submission failed. Please submit manually."
              : (error?.message ?? "Submission failed. Please try again.")
        )
        return
      }

      clearExamDraft()
      router.push(`/results/${data.attemptId}`)
    },
    [clearExamDraft, router]
  )

  // Load test and initialize attempt
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      if (!testId) return
      examStore.persist.rehydrate()

      const { data: testData, error: testError } = await apiFetch<TestDetail>(`/tests/${testId}`)
      if (cancelled) return
      if (testError?.status === 404) {
        setPhase("not-found")
        return
      }
      if (testError || !testData) {
        setLoadError(testError?.message ?? "Failed to load the test.")
        setPhase("error")
        return
      }

      const { data: attemptData, error: attemptError } = await apiFetch<AttemptRecord>("/attempts", {
        method: "POST",
        json: { testSetId: testData.id },
      })
      if (cancelled) return
      if (attemptError || !attemptData) {
        setLoadError(attemptError?.message ?? "Could not start the attempt.")
        setPhase("error")
        return
      }

      if (attemptData.status !== "IN_PROGRESS") {
        router.replace(`/results/${attemptData.id}`)
        return
      }

      const serverAnswers = attemptData.answersJson ?? {}
      const draft = examStore.getState()
      const draftMatches = draft.attemptId === attemptData.id
      const draftMap = draftAnswersToMap(draft)
      if (draftMatches && draft.essayText) {
        const essayQuestionId = testData.questions.find((q) => q.questionType === "ESSAY")?.id
        if (essayQuestionId) draftMap[essayQuestionId] = draft.essayText
      }
      const merged = draftMatches ? { ...serverAnswers, ...draftMap } : serverAnswers

      setTest(testData)
      setAttempt(attemptData)
      setAnswers(merged)
      setSecondsLeft(attemptData.timeRemainingSeconds ?? testData.timeLimitMinutes * 60)
      setDraftRestored(draftMatches && Object.keys(draftMap).length > 0)
      examStore.setState({ attemptId: attemptData.id })
      setPhase("ready")
    }
    bootstrap()
    return () => {
      cancelled = true
    }
  }, [testId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timer tick (starts once sound check is accepted)
  const hasTimer = secondsLeft !== null
  useEffect(() => {
    if (phase !== "ready" || !hasTimer || showSoundCheck) return
    const interval = setInterval(() => {
      const prev = secondsRef.current
      if (prev === null) return
      if (prev <= 1) {
        clearInterval(interval)
        setSecondsLeft(0)
        if (!autoSubmitRef.current) {
          autoSubmitRef.current = true
          void doSubmit(true)
        }
        return
      }
      setSecondsLeft(prev - 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [phase, hasTimer, showSoundCheck, doSubmit])

  // Periodic autosave
  useEffect(() => {
    if (phase !== "ready" || showSoundCheck) return
    const interval = setInterval(() => void autosave(), 15_000)
    return () => clearInterval(interval)
  }, [phase, showSoundCheck, autosave])

  // Warn before leaving mid-exam
  useEffect(() => {
    if (phase !== "ready") return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [phase])

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    const isTooLargeForDraft = value.startsWith("data:audio")
    const isEssay = test?.questions.some((q) => q.id === questionId && q.questionType === "ESSAY")
    if (isEssay) {
      setEssayText(value)
    } else if (!isTooLargeForDraft) {
      setDraftAnswer(questionId, value)
    }
  }

  const toggleFlag = (questionId: string) => {
    setFlaggedIds((prev) => {
      const next = new Set(prev)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
  }

  // Answered counts and validation
  const answeredCount = test
    ? test.questions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length
    : 0
  const essayQuestion = test?.questions.find((q) => q.questionType === "ESSAY")
  const essayText = essayQuestion ? (answers[essayQuestion.id] ?? "") : ""
  const essayWordCount = essayText.trim() ? essayText.trim().split(/\s+/).filter(Boolean).length : 0
  const timeExpired = secondsLeft === 0
  const isFullMock = test?.skill === "FULL_MOCK"
  const firstQuestionId = test?.questions[0]?.id ?? ""
  const firstAnswer = answers[firstQuestionId] ?? ""
  const typedSpeakingText =
    test?.skill === "SPEAKING" &&
    firstAnswer.length > 0 &&
    !firstAnswer.startsWith("data:audio")
      ? firstAnswer
      : ""
  const typedSpeakingWords = typedSpeakingText.trim()
    ? typedSpeakingText.trim().split(/\s+/).filter(Boolean).length
    : 0

  const canSubmit =
    !isFullMock &&
    (timeExpired ||
      (test != null &&
        (test.skill === "WRITING"
          ? essayWordCount >= 20
          : test.skill === "SPEAKING"
            ? speakingRecorded || typedSpeakingWords >= 40
            : answeredCount > 0)))

  if (phase === "loading" || phase === "submitting") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-4">
        <div className="text-center space-y-4">
          <Loader2 className="size-8 animate-spin text-cyan-400 mx-auto" aria-hidden />
          <div className="space-y-1">
            <h2 className="text-lg font-medium text-foreground">
              {phase === "submitting" ? "Transmitting Exam Answers…" : "Preparing IELTS Exam Room…"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {phase === "submitting"
                ? "Autonomous LangGraph AI agents are ready to evaluate your submission."
                : "Authenticating test session and loading verified stimulus."}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (phase === "not-found") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="size-10 text-muted-foreground mx-auto" aria-hidden />
          <h1 className="text-xl font-semibold text-foreground">Test Not Found</h1>
          <p className="text-sm text-muted-foreground">
            The requested IELTS practice test does not exist or has been retired.
          </p>
          <Link
            href="/skills/listening"
            className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-black hover:bg-neutral-200"
          >
            Browse Practice Tests
          </Link>
        </div>
      </div>
    )
  }

  if (phase === "error" || !test || !attempt) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="size-10 text-red-400 mx-auto" aria-hidden />
          <h1 className="text-xl font-semibold text-foreground">Unable to Enter Exam</h1>
          <p className="text-sm text-red-200/80">{loadError ?? "An unexpected error occurred."}</p>
          <Button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-white text-black hover:bg-neutral-200"
          >
            Retry Connection
          </Button>
        </div>
      </div>
    )
  }

  const isWriting = test.skill === "WRITING"
  const isSpeaking = test.skill === "SPEAKING"
  const isListening = test.skill === "LISTENING"
  const isReading = test.skill === "READING"

  const questionIds = test.questions.map((q) => q.id)
  const passageQuestion = test.questions.find((q) => q.passage)

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col">
      {/* Sound & System Pre-Exam Check Modal */}
      <ExamSoundCheckModal
        isOpen={showSoundCheck}
        skill={test.skill}
        title={test.title}
        timeLimitMinutes={test.timeLimitMinutes}
        questionCount={test.questions.length}
        onReady={() => setShowSoundCheck(false)}
      />

      {/* Official IELTS Computer-Delivered Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground font-mono font-bold text-xs">
            IELTS
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate text-foreground">{test.title}</h1>
            <p className="text-[11px] text-muted-foreground flex items-center gap-2">
              <span className="font-mono text-cyan-300">{test.moduleType}</span>
              <span>·</span>
              <span>{test.skill}</span>
              <span>·</span>
              <span>
                {answeredCount}/{test.questions.length} answered
              </span>
            </p>
          </div>
        </div>

        {/* Center: Official Countdown Timer */}
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 border font-mono text-sm font-semibold tabular-nums shadow-inner transition-colors ${
              secondsLeft !== null && secondsLeft <= 120
                ? "border-red-500/50 bg-red-500/20 text-red-300 animate-pulse"
                : secondsLeft !== null && secondsLeft <= 300
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                  : "border-border bg-surface-subtle text-foreground"
            }`}
          >
            <Clock className="size-4" />
            <span>{formatClock(secondsLeft ?? 0)}</span>
          </div>

          {/* Quick Sound Check Trigger */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSoundCheck(true)}
            className="hidden sm:inline-flex text-xs text-muted-foreground hover:text-foreground hover:bg-card"
          >
            <Headphones className="size-3.5 mr-1.5" />
            <span>Audio Check</span>
          </Button>

          {saveState === "saved" && (
            <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-emerald-400 font-mono">
              <span className="size-1.5 rounded-full bg-emerald-400" /> Saved
            </span>
          )}
          {saveState === "error" && (
            <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-amber-400 font-mono">
              <AlertCircle className="size-3" /> Save pending
            </span>
          )}
        </div>
      </header>

      {/* Main Examination Canvas */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {draftRestored && (
          <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 text-xs px-4 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-cyan-400" />
            <span>Your unsaved progress from a previous session was securely restored.</span>
          </div>
        )}

        {bannerError && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-xs px-4 py-3 flex items-start gap-2.5"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5 text-red-400" />
            <span>{bannerError}</span>
          </div>
        )}

        {/* 1. SPEAKING MODULE: Real AI Voice Examiner Room */}
        {isSpeaking && (
          <>
            <AiSpeakingExaminer
              questions={test.questions}
              onRecordingComplete={(audioJoined) => {
                const firstQ = test.questions[0]
                if (firstQ) {
                  setAnswer(firstQ.id, audioJoined)
                }
                setSpeakingRecorded(true)
              }}
            />
            <div className="rounded-2xl border border-border bg-surface-subtle p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground">
                  No microphone? Type your spoken answer instead — free AI review, no audio service needed.
                </p>
                <span className="shrink-0 font-mono text-[11px] text-cyan-300">
                  {typedSpeakingWords}/40 words
                </span>
              </div>
              <Textarea
                aria-label="Typed speaking response"
                value={typedSpeakingText}
                onChange={(event) => {
                  const firstQ = test.questions[0]
                  if (firstQ) setAnswer(firstQ.id, event.target.value)
                  setSpeakingRecorded(false)
                }}
                placeholder="Write the answer you would have spoken…"
                className="min-h-[160px] border-border bg-surface-subtle text-sm text-foreground placeholder:text-foreground/30"
              />
            </div>
          </>
        )}

        {/* 2. WRITING MODULE: IELTS Writing Desk */}
        {isWriting && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Task Prompt & Stimulus */}
            <div className="lg:col-span-5 rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-xs font-mono tracking-widest text-muted-foreground uppercase">
                  WRITING TASK STIMULUS
                </span>
                <span className="text-xs font-mono text-cyan-300">ACADEMIC CRITERIA</span>
              </div>

              {test.questions.map((q) => (
                <div key={q.id} className="space-y-3">
                  {q.passage && (
                    <div className="rounded-2xl border border-border bg-surface-subtle p-4 text-xs leading-relaxed text-muted-foreground whitespace-pre-line font-serif">
                      {q.passage}
                    </div>
                  )}
                  <div className="text-sm font-medium leading-relaxed text-foreground/95">{q.prompt}</div>
                  <div className="rounded-xl border border-border bg-surface-subtle p-3 text-[11px] text-muted-foreground space-y-1">
                    <p className="font-semibold text-muted-foreground">IELTS Writing Guidelines:</p>
                    <p>• Task 1: Minimum 150 words (20 minutes recommended).</p>
                    <p>• Task 2: Minimum 250 words (40 minutes recommended).</p>
                    <p>• Assessed on: Task Achievement, Coherence, Lexical Resource, Grammar.</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Right: Candidate Writing Desk */}
            <div className="lg:col-span-7 rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  ESSAY RESPONSE
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-xs px-2.5 py-0.5 rounded-full border ${
                      essayWordCount >= 150
                        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                        : essayWordCount >= 20
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                          : "border-border bg-surface-subtle text-muted-foreground"
                    }`}
                  >
                    {essayWordCount} words
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {essayWordCount < 20 ? "(Min 20 required)" : "Ready"}
                  </span>
                </div>
              </div>

              {test.questions.map((q) => (
                <Textarea
                  key={q.id}
                  id={`q-${q.id}`}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  placeholder="Type your IELTS essay here. Focus on formal academic register, clear paragraphing, and evidence…"
                  className="min-h-[460px] rounded-2xl border-border bg-surface-subtle text-sm leading-relaxed text-foreground placeholder:text-foreground/30 focus:border-cyan-400/40 focus:ring-1 focus:ring-cyan-400/30 p-4 font-sans"
                />
              ))}

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                <span>Autosaved locally & remotely</span>
                <span>Dual-pass LangGraph AI review active</span>
              </div>
            </div>
          </div>
        )}

        {/* 3. LISTENING MODULE: Real Audio Player + Questions */}
        {isListening && (
          <div className="space-y-6">
            <ListeningAudioPlayer
              audioUrl={test.questions.find((q) => q.audioUrl)?.audioUrl}
              dialoguePassage={passageQuestion?.passage}
              sectionTitle={test.title}
            />

            <div className="rounded-3xl border border-border bg-surface-subtle p-6 sm:p-8 backdrop-blur-xl space-y-6">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <h2 className="text-base font-semibold text-foreground">Questions 1 to {test.questions.length}</h2>
                <span className="text-xs font-mono text-cyan-300">LISTEN & ANSWER</span>
              </div>

              <div className="space-y-4">
                {test.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className={`rounded-2xl border p-5 transition-all ${
                      idx === currentQuestionIndex
                        ? "border-cyan-400/40 bg-surface-subtle shadow-lg shadow-cyan-500/5"
                        : "border-border bg-surface-subtle"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-foreground/95 leading-relaxed">
                        <span className="font-mono text-cyan-400 mr-2">{idx + 1}.</span>
                        {q.prompt}
                      </p>
                    </div>

                    <div className="mt-4">
                      {q.options && q.options.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {q.options.map((opt, optIdx) => {
                            const optId = `q-${q.id}-opt-${optIdx}`
                            const selected = answers[q.id] === opt.trim()
                            return (
                              <label
                                key={optId}
                                htmlFor={optId}
                                className={`flex items-center gap-3 rounded-xl border p-3 text-xs cursor-pointer transition-all ${
                                  selected
                                    ? "border-cyan-400 bg-cyan-400/15 text-foreground font-medium"
                                    : "border-border bg-surface-subtle text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
                                }`}
                              >
                                <input
                                  id={optId}
                                  type="radio"
                                  name={`q-${q.id}`}
                                  value={opt.trim()}
                                  checked={selected}
                                  onChange={(e) => setAnswer(q.id, e.target.value)}
                                  className="size-4 accent-cyan-400"
                                />
                                <span>{opt.trim()}</span>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <Input
                          id={`q-${q.id}`}
                          type="text"
                          value={answers[q.id] ?? ""}
                          onChange={(e) => setAnswer(q.id, e.target.value)}
                          placeholder="Type answer here (e.g. word or number)…"
                          className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground placeholder:text-foreground/30"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. READING MODULE: Side-by-Side Split View */}
        {isReading && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Reading Passage with font tools */}
            <div className="lg:col-span-6 rounded-3xl border border-border bg-surface-subtle p-6 backdrop-blur-xl space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-[#10192B]/90 backdrop-blur-md pb-3 pt-1">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  READING PASSAGE
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setReadingFontSize(readingFontSize === "normal" ? "large" : "normal")}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-subtle px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <ZoomIn className="size-3" />
                    <span>{readingFontSize === "normal" ? "Larger Font" : "Standard Font"}</span>
                  </button>
                </div>
              </div>

              {passageQuestion?.passage ? (
                <div
                  className={`leading-relaxed text-foreground/85 font-serif whitespace-pre-line space-y-3 ${
                    readingFontSize === "large" ? "text-base leading-8" : "text-sm leading-7"
                  }`}
                >
                  {passageQuestion.passage}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Read the questions carefully and formulate your answers.</p>
              )}
            </div>

            {/* Right: Questions Column */}
            <div className="lg:col-span-6 space-y-4 max-h-[75vh] overflow-y-auto pr-1">
              {test.questions.map((q, idx) => (
                <div
                  key={q.id}
                  className="rounded-2xl border border-border bg-surface-subtle p-5 backdrop-blur-xl space-y-3"
                >
                  <p className="text-sm font-medium text-foreground/95 leading-relaxed">
                    <span className="font-mono text-cyan-400 mr-2">{idx + 1}.</span>
                    {q.prompt}
                  </p>

                  {q.options && q.options.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {q.options.map((opt, optIdx) => {
                        const optId = `reading-q-${q.id}-opt-${optIdx}`
                        const selected = answers[q.id] === opt.trim()
                        return (
                          <label
                            key={optId}
                            htmlFor={optId}
                            className={`flex items-center gap-2.5 rounded-xl border p-3 text-xs cursor-pointer transition-all ${
                              selected
                                ? "border-cyan-400 bg-cyan-400/15 text-foreground font-medium"
                                : "border-border bg-surface-subtle text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
                            }`}
                          >
                            <input
                              id={optId}
                              type="radio"
                              name={`reading-${q.id}`}
                              value={opt.trim()}
                              checked={selected}
                              onChange={(e) => setAnswer(q.id, e.target.value)}
                              className="size-4 accent-cyan-400"
                            />
                            <span>{opt.trim()}</span>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <Input
                      id={`reading-input-${q.id}`}
                      type="text"
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                      placeholder="Type your answer…"
                      className="h-10 rounded-xl border-border bg-surface-subtle text-xs text-foreground placeholder:text-foreground/30"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Global Submit Action Bar */}
        <div className="rounded-3xl border border-border bg-gradient-to-r from-[#16213A]/90 to-[#0A0F1A] p-5 backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-foreground">Ready to complete your examination?</h4>
            <p className="text-xs text-muted-foreground">
              {isWriting
                ? essayWordCount < 20
                  ? "Requires at least 20 words to proceed to AI scoring."
                  : "All essay criteria are evaluated by autonomous LangGraph agents."
                : isSpeaking
                  ? speakingRecorded
                    ? "Speech recording captured. Submit for free AI review."
                    : typedSpeakingWords >= 40
                      ? "Typed response ready for free AI review."
                      : "Record your speech, or type at least 40 words for a free text-based review."
                  : `${answeredCount} of ${test.questions.length} questions completed.`}
            </p>
          </div>

          <Button
            onClick={() => void doSubmit(false)}
            disabled={!canSubmit}
            className="cursor-pointer rounded-xl bg-white px-6 py-2.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-40 transition-all shadow-md shrink-0"
          >
            <span>Submit Test for AI Evaluation</span>
            <ArrowRight className="size-4 ml-1.5" />
          </Button>
        </div>
      </main>

      {/* Bottom IELTS Question Navigator Strip (for non-speaking sets) */}
      {!isSpeaking && !isWriting && test.questions.length > 1 && (
        <QuestionNavStrip
          totalQuestions={test.questions.length}
          currentIndex={currentQuestionIndex}
          answers={answers}
          questionIds={questionIds}
          flaggedIds={flaggedIds}
          onSelectIndex={setCurrentQuestionIndex}
          onToggleFlag={toggleFlag}
        />
      )}
    </div>
  )
}

function draftAnswersToMap(draft: {
  answers: Record<string, { questionId: string; answer: string }>
  essayText: string
}): Record<string, string> {
  const map: Record<string, string> = {}
  Object.values(draft.answers).forEach((a) => {
    map[a.questionId] = a.answer
  })
  return map
}
