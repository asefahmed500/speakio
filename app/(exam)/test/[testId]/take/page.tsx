"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import {
  AlertCircle,
  Loader2,
  CheckCircle2,
  Clock,
  Mic,
  Square,
  Play,
  FileText,
  Volume2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useExamStore } from "@/stores/use-exam-store"
import { apiFetch } from "@/lib/api-client"

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

  const examStore = useExamStore
  const setDraftAnswer = examStore((s) => s.setAnswer)
  const setEssayText = examStore((s) => s.setEssayText)
  const clearExamDraft = examStore((s) => s.clearExamDraft)
  const markSaved = examStore((s) => s.markSaved)

  const answersRef = useRef(answers)
  const secondsRef = useRef(secondsLeft)
  const attemptRef = useRef(attempt)
  const submittingRef = useRef(false)
  // One-shot guard for the expiry auto-submit: without it a failed auto-submit
  // re-arms the timer effect and re-POSTs every second (429 storm against a
  // 12/min throttled endpoint).
  const autoSubmitRef = useRef(false)

  // Keep refs in sync outside of render (read by autosave/submit callbacks).
  useEffect(() => {
    answersRef.current = answers
  }, [answers])
  useEffect(() => {
    secondsRef.current = secondsLeft
  }, [secondsLeft])
  useEffect(() => {
    attemptRef.current = attempt
  }, [attempt])

  // Speaking recorder state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recordingState, setRecordingState] = useState<
    "idle" | "requesting" | "recording" | "processing" | "recorded" | "denied"
  >("idle")
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

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
        // A 409/404 here almost always means the attempt was already submitted
        // (e.g. the first auto-submit reached the server but the response was
        // lost). A 503 means answers were saved and the attempt is SUBMITTED,
        // but AI scoring failed — the results page owns the retry-scoring flow.
        // In all three cases land on the results page instead of asking to
        // resubmit.
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
              : (error?.message ?? "Submission failed. Please try again."),
        )
        return
      }

      clearExamDraft()
      router.push(`/results/${data.attemptId}`)
    },
    [clearExamDraft, router]
  )

  // Load the test and start/resume the attempt.
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
      // 401 on a non-auth endpoint is already handled centrally by apiFetch
      // (full-page redirect to /login?next=…); a second push here only races it.
      if (attemptError || !attemptData) {
        setLoadError(attemptError?.message ?? "Could not start the attempt.")
        setPhase("error")
        return
      }

      // Handle attempts already past the IN_PROGRESS state.
      if (attemptData.status !== "IN_PROGRESS") {
        router.replace(`/results/${attemptData.id}`)
        return
      }

      const serverAnswers = attemptData.answersJson ?? {}
      const draft = examStore.getState()
      const draftMatches = draft.attemptId === attemptData.id
      const draftMap = draftAnswersToMap(draft)
      // Essay text is stored under `essayText`, not `answers`, so it must be
      // merged back explicitly or unsaved typing since the last autosave is lost.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId])

  // Timer tick + autosave + auto-submit at zero.
  const hasTimer = secondsLeft !== null
  useEffect(() => {
    if (phase !== "ready" || !hasTimer) return
    const interval = setInterval(() => {
      // Read from the ref and drive the tick outside the state updater —
      // updaters must stay pure (StrictMode invokes them twice).
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
  }, [phase, hasTimer, doSubmit])

  // Periodic autosave while the exam is in progress.
  useEffect(() => {
    if (phase !== "ready") return
    const interval = setInterval(() => void autosave(), 15_000)
    return () => clearInterval(interval)
  }, [phase, autosave])

  // Warn before leaving with an unfinished attempt.
  useEffect(() => {
    if (phase !== "ready") return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [phase])

  // Reset the timer reference for recording; auto-stop at the 2 minute mark.
  useEffect(() => {
    if (recordingState !== "recording") return
    const interval = setInterval(() => {
      setRecordingSeconds((s) => {
        if (s + 1 >= 120) {
          // .stop() fires recorder.onstop, which commits the blob and moves
          // the state through processing → recorded. Setting "recorded" here
          // as well only causes a transient flicker.
          mediaRecorderRef.current?.stop()
          return 120
        }
        return s + 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [recordingState])

  // Release the microphone if the user leaves mid-recording (route change,
  // back navigation). Without this the browser keeps the mic live.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state === "recording") recorder.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    // Multi-megabyte base64 audio would blow the ~5MB localStorage quota and
    // silently kill draft persistence for every other answer. The recording
    // still reaches the server via autosave/submit; it just isn't rehydrated
    // into the local draft.
    const isTooLargeForDraft = value.startsWith("data:audio")
    const isEssay = test?.questions.some((q) => q.id === questionId && q.questionType === "ESSAY")
    if (isEssay) {
      setEssayText(value)
    } else if (!isTooLargeForDraft) {
      setDraftAnswer(questionId, value)
    }
  }

  const answeredCount = test ? test.questions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length : 0
  const essayQuestion = test?.questions.find((q) => q.questionType === "ESSAY")
  const essayText = essayQuestion ? (answers[essayQuestion.id] ?? "") : ""
  const essayWordCount = essayText.trim() ? essayText.trim().split(/\s+/).filter(Boolean).length : 0
  const timeExpired = secondsLeft === 0
  // An expired attempt must always be submittable — otherwise a student whose
  // auto-submit failed (e.g. network blip at 0:00) could be locked out.
  const canSubmit =
    timeExpired ||
    (test != null &&
      (test.skill === "WRITING"
        ? essayWordCount >= 20
        : test.skill === "SPEAKING"
          ? recordingState === "recorded"
          : answeredCount > 0))

  const startRecording = async () => {
    setAudioError(null)
    setRecordingState("requesting")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        const reader = new FileReader()
        // Block submission until the recording is committed to answers.
        setRecordingState("processing")
        reader.onloadend = () => {
          const base64 = reader.result as string
          const firstQuestion = test?.questions[0]
          if (firstQuestion) {
            setAnswers((prev) => ({ ...prev, [firstQuestion.id]: base64 }))
          }
          setRecordingState("recorded")
        }
        reader.onerror = () => {
          setRecordingState("idle")
          setAudioError("The recording could not be processed. Please try recording again.")
        }
        reader.readAsDataURL(blob)
        // Revoke the previous preview so re-recording doesn't leak object URLs.
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return URL.createObjectURL(blob)
        })
        stream.getTracks().forEach((t) => t.stop())
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecordingSeconds(0)
      setRecordingState("recording")
    } catch {
      setRecordingState("denied")
      setAudioError("Microphone access was denied. Enable it in your browser settings to record a response.")
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
  }

  if (phase === "loading" || phase === "submitting") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]" role="status" aria-live="polite">
        <div className="text-center space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {phase === "submitting" ? "Submitting your answers…" : "Preparing your test…"}
          </p>
        </div>
      </div>
    )
  }

  if (phase === "not-found") {
    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh]">
        <div className="text-center space-y-3 max-w-md">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden />
          <h1 className="text-xl font-semibold">Test not found</h1>
          <p className="text-sm text-muted-foreground">
            The practice test you are looking for does not exist or has been removed.
          </p>
          <Link
            href="/skills/listening"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Browse practice tests
          </Link>
        </div>
      </div>
    )
  }

  if (phase === "error" || !test || !attempt) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh]">
        <div className="text-center space-y-3 max-w-md">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" aria-hidden />
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">{loadError ?? "An unexpected error occurred."}</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    )
  }

  const isWriting = test.skill === "WRITING"
  const isSpeaking = test.skill === "SPEAKING"

  return (
    <div className="flex-1 bg-surface-subtle">
      {/* Exam header with timer */}
      <div className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{test.title}</h1>
            <p className="text-[11px] text-muted-foreground">
              {test.skill} · {test.timeLimitMinutes} min · {answeredCount}/{test.questions.length} answered
            </p>
          </div>
          <div
            className={`flex items-center gap-1.5 rounded-none px-3 py-1 border text-sm font-medium tabular-nums ${
              secondsLeft !== null && secondsLeft <= 120
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border bg-surface-subtle text-foreground"
            }`}
            aria-live="off"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {formatClock(secondsLeft ?? 0)}
          </div>
        </div>
      </div>
      {/* Minute-level announcement for assistive tech; the visual pill ticks silently. */}
      <span className="sr-only" aria-live="polite">
        {secondsLeft !== null && secondsLeft > 0 && secondsLeft % 60 === 0
          ? `${Math.ceil(secondsLeft / 60)} minutes remaining`
          : ""}
      </span>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {draftRestored && (
          <div className="rounded-lg border border-primary/20 bg-primary/10 text-primary text-xs px-3 py-2 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Your unsaved work from a previous session was restored.
          </div>
        )}

        {bannerError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2.5 flex items-start gap-2"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            {bannerError}
          </div>
        )}

        {saveState === "error" && !bannerError && (
          <div
            role="status"
            className="rounded-lg border border-warning/30 bg-warning/10 text-warning text-xs px-3 py-2.5 flex items-start gap-2"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            Autosave could not reach the server. Your work is kept in this browser, but check your
            connection — answers may not be saved remotely.
          </div>
        )}

        {isWriting ? (
          <div className="max-w-3xl rounded-xl border border-border bg-card p-4 sm:p-6 space-y-4">
            {test.questions.map((q) => (
              <div key={q.id} className="space-y-3">
                {q.passage && (
                  <div className="rounded-lg bg-surface-subtle border border-border p-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                    {q.passage}
                  </div>
                )}
                <label
                  htmlFor={`q-${q.id}`}
                  className="block text-sm font-medium leading-relaxed max-w-prose"
                >
                  {q.prompt}
                </label>
                <Textarea
                  id={`q-${q.id}`}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  placeholder="Write your response here…"
                  className="min-h-[320px] text-sm leading-relaxed"
                />
                <div className="flex items-center justify-between text-xs">
                  <span className={essayWordCount >= 20 ? "text-muted-foreground" : "text-destructive"}>
                    {essayWordCount} words {essayWordCount < 20 && "· minimum 20 words required"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : isSpeaking ? (
          <div className="max-w-3xl rounded-xl border border-border bg-card p-4 sm:p-6 space-y-5">
            {test.questions.map((q) => (
              <div key={q.id} className="space-y-4">
                <p className="text-sm font-medium leading-relaxed max-w-prose">{q.prompt}</p>
                <div className="rounded-lg bg-surface-subtle border border-border p-4 flex flex-col items-center gap-3">
                  {recordingState === "idle" && (
                    <Button onClick={startRecording} className="cursor-pointer">
                      <Mic className="mr-2 h-4 w-4" aria-hidden />
                      Start recording
                    </Button>
                  )}
                  {recordingState === "requesting" && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Requesting microphone…
                    </div>
                  )}
                  {recordingState === "recording" && (
                    <>
                      <div className="flex items-center gap-2 text-sm text-destructive font-medium">
                        <span className="h-2.5 w-2.5 rounded-none bg-destructive animate-pulse" aria-hidden />
                        Recording · {formatClock(recordingSeconds)} / 02:00
                      </div>
                      <Button variant="destructive" onClick={stopRecording} className="cursor-pointer">
                        <Square className="mr-2 h-4 w-4" aria-hidden />
                        Stop recording
                      </Button>
                    </>
                  )}
                  {recordingState === "recorded" && audioUrl && (
                    <div className="w-full space-y-3">
                      <div className="flex items-center gap-2 text-sm text-success">
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        Recording captured ({formatClock(recordingSeconds)})
                      </div>
                      <audio controls src={audioUrl} className="w-full" />                      <Button variant="outline" onClick={startRecording} className="cursor-pointer">
                        <Play className="mr-2 h-4 w-4" aria-hidden />
                        Record again
                      </Button>
                    </div>
                  )}
                  {audioError && (
                    <p role="alert" className="text-xs text-destructive flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {audioError}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground text-center max-w-sm">
                    Your response is submitted to a certified examiner for evaluation. Results
                    usually appear once review is complete.
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {test.questions.some((q) => q.passage) && (
              <aside className="lg:col-span-2 rounded-xl border border-border bg-card p-4 sm:p-5 max-h-[70vh] overflow-y-auto">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Source material
                </h2>
                {test.questions
                  .filter((q) => q.passage)
                  .map((q) => (
                    <div key={q.id} className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                      {q.passage}
                    </div>
                  ))}
              </aside>
            )}
            <section className={test.questions.some((q) => q.passage) ? "lg:col-span-3 space-y-3" : "lg:col-span-5 space-y-3"}>
              {test.questions.map((q, index) => (
                <fieldset key={q.id} className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
                  <legend className="sr-only">Question {index + 1}</legend>
                  {q.audioUrl && (
                    <div className="space-y-1.5 rounded-lg bg-surface-subtle border border-border p-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        <Volume2 className="h-3.5 w-3.5" aria-hidden />
                        Listening audio
                      </p>
                      {/* The audio IS the question stimulus for LISTENING sets —
                          without it the questions are unanswerable. */}
                      <audio controls src={q.audioUrl} className="w-full" preload="auto">
                        Your browser does not support audio playback.
                      </audio>
                    </div>
                  )}
                  <p className="text-sm font-medium leading-relaxed">
                    <span className="text-muted-foreground mr-2">{index + 1}.</span>
                    {q.prompt}
                  </p>
                  {q.options ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {q.options.map((option, optIndex) => {
                        // Derive the id from the index — label-text-derived ids
                        // can collide for options differing only in whitespace.
                        const optionId = `q-${q.id}-opt-${optIndex}`
                        const selected = answers[q.id] === option.trim()
                        return (
                          <label
                            key={optionId}
                            htmlFor={optionId}
                            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                              selected
                                ? "border-primary bg-primary/5 text-foreground font-medium"
                                : "border-border bg-surface-subtle hover:bg-card"
                            }`}
                          >
                            <input
                              id={optionId}
                              type="radio"
                              name={`q-${q.id}`}
                              value={option.trim()}
                              checked={selected}
                              onChange={(e) => setAnswer(q.id, e.target.value)}
                              className="h-4 w-4 accent-primary"
                            />
                            {option.trim()}
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
                      placeholder="Type your answer…"
                      className="h-10"
                      aria-label={`Answer for question ${index + 1}`}
                    />
                  )}
                </fieldset>
              ))}
            </section>
          </div>
        )}

        {/* Submit bar */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {isWriting
              ? essayWordCount < 20
                ? "Your essay needs at least 20 words before it can be submitted."
                : "Ready to submit. AI scoring usually completes within a couple of minutes."
              : isSpeaking
                ? recordingState === "recorded"
                  ? "Your recording is ready to submit."
                  : "Record your response to enable submission."
                : `${answeredCount} of ${test.questions.length} questions answered.`}
          </p>
          <Button
            onClick={() => void doSubmit(false)}
            disabled={!canSubmit}
            title={
              !canSubmit
                ? isWriting
                  ? "Write at least 20 words to submit"
                  : isSpeaking
                    ? "Record a response first"
                    : "Answer at least one question"
                : undefined
            }
            className="cursor-pointer"
          >
            Submit test
          </Button>
        </div>
      </div>
    </div>
  )
}

function draftAnswersToMap(draft: {
  answers: Record<string, { questionId: string; answer: string }>
  essayText: string
}): Record<string, string> {
  const map: Record<string, string> = {}
  Object.values(draft.answers).forEach((a) => {
    // Empty entries are kept deliberately: a user who cleared an answer must
    // not see the older server value resurrect on refresh.
    map[a.questionId] = a.answer
  })
  return map
}
