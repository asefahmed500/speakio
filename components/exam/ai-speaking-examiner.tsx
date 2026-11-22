"use client"

import React, { useEffect, useRef, useState } from "react"
import {
  Mic,
  Square,
  RotateCcw,
  Volume2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Bot,
  User,
  VolumeX,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { examVoiceAgent } from "@/lib/exam-voice-agent"
import { WavSegmentRecorder } from "@/lib/audio-recorder"

interface TestQuestion {
  id: string
  partNumber: number
  questionType: string
  prompt: string
  passage: string | null
  audioUrl: string | null
  orderIndex: number
}

interface AiSpeakingExaminerProps {
  questions: TestQuestion[]
  onRecordingComplete: (
    dataUrlJoined: string,
    durationSeconds: number,
    questionId: string
  ) => void
  onActiveQuestionChange?: (questionId: string) => void
  /** Question ids with a stored answer, for per-tab indicators. */
  recordedQuestionIds?: Set<string>
  disabled?: boolean
}

export function AiSpeakingExaminer({
  questions,
  onRecordingComplete,
  onActiveQuestionChange,
  recordedQuestionIds,
  disabled = false,
}: AiSpeakingExaminerProps) {
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const [examinerSpeaking, setExaminerSpeaking] = useState(false)
  const [prepTimeLeft, setPrepTimeLeft] = useState<number | null>(null)
  const [prepActive, setPrepActive] = useState(false)
  const [candidateNotes, setCandidateNotes] = useState("")

  // Recording states
  const [recordingState, setRecordingState] = useState<
    "idle" | "requesting" | "recording" | "processing" | "recorded" | "denied"
  >("idle")
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>(() => Array(16).fill(0))

  const wavRecorderRef = useRef<WavSegmentRecorder | null>(null)
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const prepTimerRef = useRef<NodeJS.Timeout | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const stoppingRef = useRef(false)
  const visualizerRef = useRef<{ getVolume: () => number; stop: () => void } | null>(null)
  const levelTimerRef = useRef<NodeJS.Timeout | null>(null)
  /** Question captured at recording start so tab switches cannot misattribute audio. */
  const recordingQuestionIdRef = useRef<string>("")

  const currentQuestion = questions[activeQuestionIndex] || questions[0]
  const isCueCard = currentQuestion?.questionType === "SPEAKING_PROMPT" || currentQuestion?.prompt.includes("You should say:")

  const activeQuestionId = currentQuestion?.id
  useEffect(() => {
    if (activeQuestionId) onActiveQuestionChange?.(activeQuestionId)
  }, [activeQuestionId, onActiveQuestionChange])

  // Speak the question prompt when switching questions or starting
  const playExaminerVoice = (text: string) => {
    setExaminerSpeaking(true)
    void examVoiceAgent.speak(
      text,
      () => setExaminerSpeaking(true),
      () => setExaminerSpeaking(false),
      () => setExaminerSpeaking(false)
    )
  }

  // Auto-play the examiner greeting & first question on mount
  useEffect(() => {
    if (currentQuestion) {
      const greeting = `Hello, and welcome to this IELTS Speaking evaluation. Let us begin. ${currentQuestion.prompt}`
      const timeout = setTimeout(() => {
        playExaminerVoice(greeting)
      }, 800)
      return () => {
        clearTimeout(timeout)
        examVoiceAgent.cancel()
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup
  useEffect(() => {
    return () => {
      examVoiceAgent.cancel()
      wavRecorderRef.current?.abort()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      if (prepTimerRef.current) clearInterval(prepTimerRef.current)
      if (levelTimerRef.current) clearInterval(levelTimerRef.current)
      visualizerRef.current?.stop()
    }
  }, [])

  // 1-minute cue card preparation timer
  const startPrepTimer = () => {
    setPrepActive(true)
    setPrepTimeLeft(60)
    if (prepTimerRef.current) clearInterval(prepTimerRef.current)

    prepTimerRef.current = setInterval(() => {
      setPrepTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(prepTimerRef.current!)
          setPrepActive(false)
          void examVoiceAgent.speak("Your preparation time is complete. Please begin speaking now.")
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // Start recording candidate answer
  const handleStartRecording = async () => {
    examVoiceAgent.cancel()
    setExaminerSpeaking(false)
    setAudioError(null)
    recordingQuestionIdRef.current = currentQuestion?.id ?? ""
    setRecordingState("requesting")

    try {
      const recorder = new WavSegmentRecorder()
      wavRecorderRef.current = recorder
      await recorder.start()
      setRecordingSeconds(0)
      setRecordingState("recording")

      // Real microphone-driven waveform using the stream the recorder acquired.
      if (recorder.microphoneStream) {
        try {
          visualizerRef.current = await examVoiceAgent.initMicVisualizer(recorder.microphoneStream)
          if (levelTimerRef.current) clearInterval(levelTimerRef.current)
          levelTimerRef.current = setInterval(() => {
            const volume = visualizerRef.current?.getVolume() ?? 0
            setLevels(
              Array.from({ length: 16 }, (_, i) => {
                const wave = 0.55 + 0.45 * Math.sin(i * 0.8 + Date.now() / 180)
                return Math.max(10, Math.round(volume * wave))
              })
            )
          }, 120)
        } catch {
          // A visualizer failure must never block recording.
        }
      }

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1
          if (next >= 120) {
            void handleStopRecording()
          }
          return next
        })
      }, 1000)
    } catch (err) {
      wavRecorderRef.current?.abort()
      wavRecorderRef.current = null
      const name = err instanceof DOMException ? err.name : ""
      if (name === "NotAllowedError") {
        setRecordingState("denied")
        setAudioError("Microphone access was denied. Please allow microphone access in your browser.")
      } else {
        setRecordingState("idle")
        setAudioError("Could not initialize microphone. Please check your audio input device.")
      }
    }
  }

  // Stop recording & package WAV segments
  const handleStopRecording = async () => {
    if (stoppingRef.current) return
    const recorder = wavRecorderRef.current
    if (!recorder) return
    stoppingRef.current = true
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    if (levelTimerRef.current) clearInterval(levelTimerRef.current)
    visualizerRef.current?.stop()
    visualizerRef.current = null
    setLevels(Array(16).fill(0))

    setRecordingState("processing")
    try {
      const result = await recorder.stop()
      const joined = result.dataUrls.join("|")
      const duration = Math.round(result.durationSeconds)

      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      const previewUrl = URL.createObjectURL(result.previewBlob)
      audioUrlRef.current = previewUrl
      setAudioUrl(previewUrl)
      setRecordingState("recorded")

      // Notify parent exam runner
      onRecordingComplete(joined, duration, recordingQuestionIdRef.current)
    } catch {
      setRecordingState("idle")
      setAudioError("The audio recording could not be processed. Please try again.")
    } finally {
      wavRecorderRef.current = null
      stoppingRef.current = false
    }
  }

  const formatSec = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  return (
    <div className="space-y-6">
      {/* AI Senior Examiner Card */}
      <div className="relative overflow-hidden rounded-3xl border border-black/10 bg-white p-6 sm:p-8  ">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/10">
          <div className="flex items-center gap-3.5">
            <div className="relative flex size-12 items-center justify-center rounded-2xl border border-cyan-400/40 bg-cyan-950/40 text-black/60">
              <Bot className="size-6" />
              {examinerSpeaking && (
                <span className="absolute -bottom-1 -right-1 size-3.5 rounded-full border-2 border-white bg-emerald-400 animate-pulse" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-black">Dr. Arthur Pendelton</h3>
                <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-mono text-black/60">
                  IELTS EXAMINER
                </span>
              </div>
              <p className="text-xs text-black/55">Official Speaking Simulation · Part {currentQuestion?.partNumber || 2}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (examinerSpeaking) {
                  examVoiceAgent.cancel()
                  setExaminerSpeaking(false)
                } else {
                  playExaminerVoice(currentQuestion.prompt)
                }
              }}
              className="cursor-pointer border-black/10 bg-[#fafafa] text-xs text-black hover:bg-[#fafafa]"
            >
              {examinerSpeaking ? (
                <>
                  <VolumeX className="size-3.5 mr-1.5 text-amber-400" /> Stop Speaking
                </>
              ) : (
                <>
                  <Volume2 className="size-3.5 mr-1.5 text-cyan-400" /> Replay Examiner Voice
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Examiner Waveform / Status */}
        <div className="py-5 space-y-3">
          {examinerSpeaking && (
            <div className="flex items-center gap-2 text-xs font-mono text-black/60">
              <span className="flex gap-0.5 items-end h-3.5">
                <span className="w-1 bg-cyan-400 animate-[pulse_0.4s_ease-in-out_infinite] h-3" />
                <span className="w-1 bg-cyan-400 animate-[pulse_0.6s_ease-in-out_infinite] h-4" />
                <span className="w-1 bg-cyan-400 animate-[pulse_0.3s_ease-in-out_infinite] h-2" />
                <span className="w-1 bg-cyan-400 animate-[pulse_0.5s_ease-in-out_infinite] h-3.5" />
              </span>
              <span>EXAMINER IS SPEAKING… LISTEN CAREFULLY</span>
            </div>
          )}

          <div className="rounded-2xl border border-black/10 bg-[#fafafa] p-5">
            <p className="text-base sm:text-lg font-normal leading-relaxed text-black">
              &ldquo;{currentQuestion?.prompt}&rdquo;
            </p>
          </div>
        </div>

        {/* Part 2 Cue Card Prep Section */}
        {isCueCard && (
          <div className="rounded-2xl border border-black/10 bg-[#fafafa] p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-black/70">
                <Clock className="size-4" />
                <span>PART 2 INDIVIDUAL LONG TURN — 1 MINUTE PREPARATION</span>
              </div>
              {!prepActive && prepTimeLeft === null && (
                <Button
                  size="sm"
                  onClick={startPrepTimer}
                  className="bg-black text-white hover:bg-black/80 text-xs font-medium cursor-pointer"
                >
                  Start 1-Min Prep Timer
                </Button>
              )}
            </div>

            {prepTimeLeft !== null && (
              <div className="flex items-center gap-3">
                <span className="font-mono text-xl font-bold text-black/70">
                  {formatSec(prepTimeLeft)}
                </span>
                <span className="text-xs text-black/60">
                  {prepActive ? "Use this minute to take brief notes." : "Prep time ended. Begin speaking."}
                </span>
              </div>
            )}

            {/* Candidate Scratchpad */}
            <div className="space-y-1.5 pt-1">
              <label htmlFor="speaking-scratchpad" className="text-[11px] font-mono text-black/55 uppercase">
                Candidate Scratchpad (Not graded — for your own structure)
              </label>
              <textarea
                id="speaking-scratchpad"
                value={candidateNotes}
                onChange={(e) => setCandidateNotes(e.target.value)}
                placeholder="Bullet point keywords, idioms, or key details for your cue card response…"
                className="w-full rounded-xl border border-black/10 bg-white p-3 text-xs text-black placeholder:text-black/50 focus:border-black/20 focus:outline-none"
                rows={3}
              />
            </div>
          </div>
        )}
      </div>

      {/* Candidate Recording Station */}
      <div className="rounded-3xl border border-black/10 bg-white p-6 sm:p-8  space-y-6">
        <div className="flex items-center justify-between border-b border-black/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-black/10 bg-[#fafafa] text-black">
              <User className="size-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-black">Candidate Response Station</h4>
              <p className="text-xs text-black/55">Capture response via high-fidelity microphone</p>
            </div>
          </div>

          <div className="font-mono text-xs text-black/60">
            RECORDING: <span className="text-black font-medium">{formatSec(recordingSeconds)} / 02:00</span>
          </div>
        </div>

        {/* Live Audio States */}
        <div className="flex flex-col items-center justify-center py-6 space-y-4">
          {recordingState === "idle" && (
            <Button
              onClick={() => void handleStartRecording()}
              disabled={disabled || recordingState !== "idle"}
              className="cursor-pointer rounded-2xl bg-black px-8 py-6 text-base font-medium text-white hover:bg-black/80 disabled:opacity-60  active:scale-95 transition-all"
            >
              <Mic className="size-5 mr-2 text-rose-600" />
              <span>Start Speaking & Record</span>
            </Button>
          )}

          {recordingState === "requesting" && (
            <div role="status" className="flex items-center gap-3 text-sm text-black/60 font-mono">
              <Loader2 className="size-4 animate-spin" />
              <span>INITIALIZING MICROPHONE…</span>
            </div>
          )}

          {recordingState === "processing" && (
            <div role="status" className="flex items-center gap-3 text-sm text-black/60 font-mono">
              <Loader2 className="size-4 animate-spin" />
              <span>PROCESSING YOUR RESPONSE… PLEASE WAIT</span>
            </div>
          )}

          {recordingState === "recording" && (
            <div className="w-full max-w-md space-y-4 text-center">
              <div className="flex items-center justify-center gap-2 text-sm font-mono text-black/70">
                <span className="size-3 rounded-full bg-rose-500 animate-pulse" />
                <span>LIVE RECORDING IN PROGRESS ({formatSec(recordingSeconds)})</span>
              </div>

              {/* Live microphone-driven waveform */}
              <div className="flex items-center justify-center gap-1.5 h-12">
                {Array.from({ length: 16 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-1.5 rounded-full bg-black transition-[height] duration-100"
                    style={{ height: `${Math.max(10, levels[i] ?? 10)}px` }}
                  />
                ))}
              </div>

              <Button
                variant="destructive"
                onClick={() => void handleStopRecording()}
                disabled={recordingState !== "recording"}
                className="cursor-pointer rounded-xl px-6 py-2.5 text-sm font-medium shadow-lg disabled:opacity-60"
              >
                <Square className="size-4 mr-2" />
                <span>Stop Recording & Finish Response</span>
              </Button>
            </div>
          )}

          {recordingState === "recorded" && audioUrl && (
            <div className="w-full max-w-lg space-y-4 rounded-2xl border border-black/10 bg-[#fafafa] p-5">
              <div className="flex items-center justify-between text-xs font-mono text-black/70">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4" /> RESPONSE CAPTURED ({formatSec(recordingSeconds)})
                </span>
                <span className="text-black/55">READY FOR EVALUATION</span>
              </div>

              <audio controls src={audioUrl} className="w-full rounded-lg" />

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-black/55">Your recording will be transcribed and scored by AI agents.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartRecording}
                  className="cursor-pointer border-black/15 bg-[#fafafa] text-xs text-black hover:bg-[#fafafa]"
                >
                  <RotateCcw className="size-3 mr-1.5" /> Re-record
                </Button>
              </div>
            </div>
          )}

          {audioError && (
            <p className="text-xs text-black/70 flex items-center gap-1.5">
              <AlertCircle className="size-4 shrink-0" />
              {audioError}
            </p>
          )}
        </div>

        {/* Question Selector Tabs (if multi-question speaking set) */}
        {questions.length > 1 && (
          <div className="border-t border-black/10 pt-4">
            <p className="text-[11px] font-mono uppercase tracking-wider text-black/55 mb-2">
              Interview Questions
            </p>
            <div className="flex flex-wrap gap-2">
              {questions.map((q, idx) => (
                <button
                  key={q.id}
                  type="button"
                  disabled={
                    recordingState === "requesting" ||
                    recordingState === "recording" ||
                    recordingState === "processing"
                  }
                  onClick={() => {
                    setActiveQuestionIndex(idx)
                    // Never show one question's recording under another.
                    setRecordingState("idle")
                    setRecordingSeconds(0)
                    setAudioUrl(null)
                    setAudioError(null)
                    setLevels(Array(16).fill(0))
                    playExaminerVoice(q.prompt)
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                    activeQuestionIndex === idx
                      ? "border border-black bg-black text-white"
                      : "border border-black/10 bg-[#fafafa] text-black/60 hover:text-black hover:bg-[#f4f4f4]"
                  }`}
                >
                  Question {idx + 1}
                  {recordedQuestionIds?.has(q.id) && (
                    <CheckCircle2 className="ml-1 inline size-3 text-black/70" aria-label="Answered" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
