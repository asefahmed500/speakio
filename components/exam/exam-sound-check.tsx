"use client"

import React, { useEffect, useRef, useState } from "react"
import {
  Mic,
  Headphones,
  CheckCircle2,
  AlertCircle,
  Play,
  ArrowRight,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { examVoiceAgent } from "@/lib/exam-voice-agent"

interface ExamSoundCheckProps {
  skill: "LISTENING" | "READING" | "WRITING" | "SPEAKING" | "FULL_MOCK"
  title: string
  timeLimitMinutes: number
  questionCount: number
  isOpen: boolean
  onReady: () => void
}

export function ExamSoundCheckModal({
  skill,
  title,
  timeLimitMinutes,
  questionCount,
  isOpen,
  onReady,
}: ExamSoundCheckProps) {
  const [soundChecked, setSoundChecked] = useState(skill === "READING" || skill === "WRITING")
  const [isPlayingSound, setIsPlayingSound] = useState(false)
  const [soundError, setSoundError] = useState<string | null>(null)
  const [isTestingMic, setIsTestingMic] = useState(false)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [micVolume, setMicVolume] = useState(0)
  const [micTested, setMicTested] = useState(skill !== "SPEAKING")
  const [micError, setMicError] = useState<string | null>(null)
  const micVisualizerRef = useRef<{ stop: () => void } | null>(null)
  const animFrameRef = useRef<number | null>(null)

  const isAudioSkill = skill === "LISTENING" || skill === "SPEAKING"
  const isSpeaking = skill === "SPEAKING"

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      micVisualizerRef.current?.stop()
      if (micStream) {
        micStream.getTracks().forEach((t) => t.stop())
      }
    }
  }, [micStream])

  if (!isOpen) return null

  const handleTestSound = async () => {
    setIsPlayingSound(true)
    setSoundError(null)
    try {
      await examVoiceAgent.playSoundCheckTone()
      setSoundChecked(true)
    } catch {
      setSoundError("Audio playback failed. Check your browser sound settings and try again.")
    } finally {
      setIsPlayingSound(false)
    }
  }

  const handleTestMic = async () => {
    if (isTestingMic) return
    setIsTestingMic(true)
    setMicError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setMicStream(stream)
      const visualizer = await examVoiceAgent.initMicVisualizer(stream)
      micVisualizerRef.current = visualizer

      const loop = () => {
        const vol = visualizer.getVolume()
        setMicVolume(vol)
        if (vol > 15) {
          setMicTested(true)
        }
        animFrameRef.current = requestAnimationFrame(loop)
      }
      loop()
    } catch (err) {
      const msg = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Microphone access was denied. Please allow microphone access in your browser settings."
        : "Failed to connect to your microphone."
      setMicError(msg)
    } finally {
      setIsTestingMic(false)
    }
  }

  // Checks are advisory — never trap the candidate on a missing mic/audio
  // check. Typed answers and a non-audio fallback are always available.
  const canProceed = true

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/40 backdrop-blur-md">
      <div className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl border border-border bg-card p-6 sm:p-8 text-foreground shadow-2xl">
        {/* Ambient glow */}
        <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-primary/5 blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-mono tracking-widest text-muted-foreground uppercase">
              <ShieldCheck className="size-3.5 text-muted-foreground" />
              <span>Official IELTS Test Room Check</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Module: <span className="text-foreground font-medium">{skill}</span> · Time Limit:{" "}
              <span className="text-foreground font-medium">{timeLimitMinutes} minutes</span> · Items:{" "}
              <span className="text-foreground font-medium">{questionCount} questions</span>
            </p>
          </div>

          {/* Test Equipment Checklist */}
          <div className="space-y-3 rounded-2xl border border-border bg-muted p-4 sm:p-5 backdrop-blur-xl">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Pre-Exam System Calibration
            </h3>

            {/* Sound Check (for Listening & Speaking) */}
            {isAudioSkill && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-subtle p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
                    <Headphones className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground">Headphones & Audio Output</p>
                    <p className="text-[11px] text-muted-foreground">Verify you can hear IELTS prompts clearly</p>
                    {soundError && (
                      <p role="alert" className="pt-1 text-[11px] text-red-700">{soundError}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleTestSound()}
                    disabled={isPlayingSound}
                    className="cursor-pointer border-border bg-muted text-xs text-foreground hover:bg-muted"
                  >
                    <Play className="size-3 mr-1" />
                    {isPlayingSound ? "Testing…" : "Play Chime"}
                  </Button>
                  {soundChecked && <CheckCircle2 className="size-4 text-emerald-700" />}
                </div>
              </div>
            )}

            {/* Mic Check (for Speaking) */}
            {isSpeaking && (
              <div className="space-y-3 rounded-xl border border-border bg-surface-subtle p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
                      <Mic className="size-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">Microphone Input</p>
                      <p className="text-[11px] text-muted-foreground">Speak aloud to calibrate speech volume</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!micStream ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleTestMic()}
                        disabled={isTestingMic}
                        className="cursor-pointer border-border bg-muted text-xs text-foreground hover:bg-muted disabled:opacity-60"
                      >
                        {isTestingMic ? "Connecting…" : "Enable & Test Mic"}
                      </Button>
                    ) : (
                      <span className="text-xs font-mono text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="size-3.5" /> Mic Active
                      </span>
                    )}
                  </div>
                </div>

                {/* Live Volume Meter */}
                {micStream && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                      <span>INPUT LEVEL</span>
                      <span>{micTested ? "GOOD" : "SPEAK INTO MIC"}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-primary transition-all duration-75"
                        style={{ width: `${Math.max(5, micVolume)}%` }}
                      />
                    </div>
                  </div>
                )}

                {micError && (
                  <p className="text-xs text-red-600 flex items-center gap-1.5 pt-1">
                    <AlertCircle className="size-3.5 shrink-0" />
                    {micError}
                  </p>
                )}
              </div>
            )}

            {/* Exam Room Guidelines */}
            <div className="space-y-1.5 pt-1 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 text-foreground font-medium">
                <Sparkles className="size-3.5 text-muted-foreground" /> Real Exam Conditions
              </p>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-muted-foreground">
                <li>Timer starts immediately when you click &ldquo;Begin Exam&rdquo;.</li>
                <li>Your work is automatically saved every 15 seconds.</li>
                <li>When the timer reaches 00:00, your exam will automatically submit for AI evaluation.</li>
              </ul>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              onClick={() => {
                if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
                micVisualizerRef.current?.stop()
                if (micStream) {
                  micStream.getTracks().forEach((t) => t.stop())
                }
                // The stream is intentionally released here — don't leave the
                // UI claiming "Mic Active" when the modal is reopened.
                setMicStream(null)
                setMicTested(skill !== "SPEAKING")
                setMicVolume(0)
                micVisualizerRef.current = null
                onReady()
              }}
              disabled={!canProceed}
              className="w-full sm:w-auto cursor-pointer rounded-xl bg-white px-6 py-2.5 text-sm font-medium text-black transition-all hover:bg-neutral-200 disabled:opacity-50 shadow-md"
            >
              <span>{canProceed ? "I am Ready — Begin Exam" : "Complete Checks to Continue"}</span>
              <ArrowRight className="size-4 ml-1.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
