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
    await examVoiceAgent.playSoundCheckTone()
    setIsPlayingSound(false)
    setSoundChecked(true)
  }

  const handleTestMic = async () => {
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
    }
  }

  const canProceed = (!isAudioSkill || soundChecked) && (!isSpeaking || micTested)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-b from-[#141C2D] to-[#0B0E14] p-6 sm:p-8 text-white shadow-2xl">
        {/* Ambient glow */}
        <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-cyan-500/20 blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-mono tracking-widest text-cyan-300 uppercase">
              <ShieldCheck className="size-3.5 text-cyan-400" />
              <span>Official IELTS Test Room Check</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">{title}</h2>
            <p className="text-xs sm:text-sm text-white/60">
              Module: <span className="text-white font-medium">{skill}</span> · Time Limit:{" "}
              <span className="text-white font-medium">{timeLimitMinutes} minutes</span> · Items:{" "}
              <span className="text-white font-medium">{questionCount} questions</span>
            </p>
          </div>

          {/* Test Equipment Checklist */}
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 backdrop-blur-xl">
            <h3 className="text-xs font-mono uppercase tracking-wider text-white/50">
              Pre-Exam System Calibration
            </h3>

            {/* Sound Check (for Listening & Speaking) */}
            {isAudioSkill && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white">
                    <Headphones className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">Headphones & Audio Output</p>
                    <p className="text-[11px] text-white/50">Verify you can hear IELTS prompts clearly</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTestSound}
                    disabled={isPlayingSound}
                    className="cursor-pointer border-white/20 bg-white/5 text-xs text-white hover:bg-white/10"
                  >
                    <Play className="size-3 mr-1" />
                    {isPlayingSound ? "Testing…" : "Play Chime"}
                  </Button>
                  {soundChecked && <CheckCircle2 className="size-4 text-emerald-400" />}
                </div>
              </div>
            )}

            {/* Mic Check (for Speaking) */}
            {isSpeaking && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white">
                      <Mic className="size-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white">Microphone Input</p>
                      <p className="text-[11px] text-white/50">Speak aloud to calibrate speech volume</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!micStream ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTestMic}
                        className="cursor-pointer border-white/20 bg-white/5 text-xs text-white hover:bg-white/10"
                      >
                        Enable & Test Mic
                      </Button>
                    ) : (
                      <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="size-3.5" /> Mic Active
                      </span>
                    )}
                  </div>
                </div>

                {/* Live Volume Meter */}
                {micStream && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[10px] font-mono text-white/50">
                      <span>INPUT LEVEL</span>
                      <span>{micTested ? "GOOD" : "SPEAK INTO MIC"}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-amber-400 transition-all duration-75"
                        style={{ width: `${Math.max(5, micVolume)}%` }}
                      />
                    </div>
                  </div>
                )}

                {micError && (
                  <p className="text-xs text-rose-300 flex items-center gap-1.5 pt-1">
                    <AlertCircle className="size-3.5 shrink-0" />
                    {micError}
                  </p>
                )}
              </div>
            )}

            {/* Exam Room Guidelines */}
            <div className="space-y-1.5 pt-1 text-xs text-white/60">
              <p className="flex items-center gap-1.5 text-white/80 font-medium">
                <Sparkles className="size-3.5 text-cyan-400" /> Real Exam Conditions
              </p>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-white/50">
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
