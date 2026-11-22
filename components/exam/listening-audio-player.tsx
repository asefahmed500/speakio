"use client"

import React, { useEffect, useRef, useState } from "react"
import { Volume2, VolumeX, Play, Pause, Headphones, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { examVoiceAgent } from "@/lib/exam-voice-agent"

interface ListeningAudioPlayerProps {
  audioUrl?: string | null
  dialoguePassage?: string | null
  sectionTitle?: string
}

export function ListeningAudioPlayer({
  audioUrl,
  dialoguePassage,
  sectionTitle = "Listening Section Audio",
}: ListeningAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const usingSyntheticAudio = !audioUrl

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ttsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTtsProgress = () => {
    if (ttsTimerRef.current) {
      clearInterval(ttsTimerRef.current)
      ttsTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      stopTtsProgress()
      examVoiceAgent.cancel()
      examVoiceAgent.setMuted(false)
    }
  }, [])

  const handleTogglePlay = async () => {
    if (isBuffering) return
    setAudioError(null)
    if (audioUrl && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
        stopTtsProgress()
        setIsPlaying(false)
      } else {
        setIsBuffering(true)
        try {
          await audioRef.current.play()
          setIsPlaying(true)
        } catch {
          setAudioError("Audio could not start. Check your browser's audio settings and try again.")
          setIsPlaying(false)
        } finally {
          setIsBuffering(false)
        }
      }
    } else if (dialoguePassage) {
      if (isPlaying) {
        examVoiceAgent.cancel()
        stopTtsProgress()
        setIsPlaying(false)
      } else {
        setIsPlaying(true)
        setProgress(0)
        const words = dialoguePassage.trim().split(/\s+/).filter(Boolean).length
        const estimatedMs = Math.max(4_000, (words / 2.5) * 1000)
        stopTtsProgress()
        ttsTimerRef.current = setInterval(() => {
          setProgress((prev) => Math.min(99, prev + (250 / estimatedMs) * 100))
        }, 250)
        void examVoiceAgent.speak(
          dialoguePassage,
          () => setIsPlaying(true),
          () => {
            stopTtsProgress()
            setIsPlaying(false)
            setProgress(100)
          },
          () => {
            stopTtsProgress()
            setIsPlaying(false)
          }
        )
      }
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration
      const cur = audioRef.current.currentTime
      if (dur > 0) setProgress((cur / dur) * 100)
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-black/10 bg-white p-4 sm:p-5 space-y-3">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => setIsPlaying(false)}
          preload="auto"
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-[var(--radius-lg)] border border-black/10 bg-[#fafafa] text-black">
            <Headphones className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-black">{sectionTitle}</h3>
              <span className="rounded-full border border-black/10 bg-[#fafafa] px-2 py-0.5 text-[9px] font-mono text-black/50">
                OFFICIAL AUDIO STIMULUS
              </span>
            </div>
            <p className="text-xs text-black/40">
              {usingSyntheticAudio
                ? "Simulated IELTS Listening Dialogue (AI Voice Engine)"
                : "Continuous Recording · Listen and answer questions"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => void handleTogglePlay()}
            disabled={isBuffering}
            className="cursor-pointer rounded-[var(--radius-lg)] px-4 text-xs"
          >
            {isBuffering ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" /> Starting…
              </>
            ) : isPlaying ? (
              <>
                <Pause className="size-3.5 mr-1.5" /> Pause Audio
              </>
            ) : (
              <>
                <Play className="size-3.5 mr-1.5" /> Start Audio Track
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={isMuted ? "Unmute audio" : "Mute audio"}
            onClick={() => {
              const next = !isMuted
              if (audioRef.current) audioRef.current.muted = next
              examVoiceAgent.setMuted(next)
              setIsMuted(next)
            }}
            className="text-black/55 hover:text-black hover:bg-[#f4f4f4]"
          >
            {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="space-y-1.5 pt-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full bg-black transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
        {isPlaying && (
          <div className="flex items-center justify-between text-[10px] font-mono text-black/50">
            <span>● AUDIO PLAYING — ANSWER QUESTIONS CONCURRENTLY</span>
            <span>OFFICIAL IELTS FORMAT</span>
          </div>
        )}
        {audioError && (
          <p role="alert" className="pt-1 text-[11px] text-black/70">{audioError}</p>
        )}
      </div>
    </div>
  )
}
