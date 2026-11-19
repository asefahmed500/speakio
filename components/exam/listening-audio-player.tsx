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

  useEffect(() => {
    return () => {
      examVoiceAgent.cancel()
    }
  }, [])

  const handleTogglePlay = async () => {
    if (isBuffering) return
    setAudioError(null)
    if (audioUrl && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
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
      // If no mp3 file is configured, synthesize the authentic listening dialogue with our voice agent!
      if (isPlaying) {
        examVoiceAgent.cancel()
        setIsPlaying(false)
      } else {
        setIsPlaying(true)
        void examVoiceAgent.speak(
          dialoguePassage,
          () => setIsPlaying(true),
          () => {
            setIsPlaying(false)
            setProgress(100)
          },
          () => setIsPlaying(false)
        )
      }
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration
      const cur = audioRef.current.currentTime
      if (dur > 0) {
        setProgress((cur / dur) * 100)
      }
    }
  }

  return (
    <div className="rounded-2xl border border-white/15 bg-gradient-to-r from-[#16213A]/90 to-[#0F172A] p-4 sm:p-5 backdrop-blur-xl shadow-xl space-y-3">
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
          <div className="flex size-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-100">
            <Headphones className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{sectionTitle}</h3>
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-mono text-cyan-100">
                OFFICIAL AUDIO STIMULUS
              </span>
            </div>
            <p className="text-xs text-white/50">
              {usingSyntheticAudio
                ? "Simulated IELTS Listening Dialogue (AI Voice Engine)"
                : "Continuous Recording · Listen and answer questions"}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => void handleTogglePlay()}
            disabled={isBuffering}
            className="cursor-pointer rounded-xl bg-white px-4 py-2 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-60 shadow-md"
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
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.muted = !isMuted
                setIsMuted(!isMuted)
              }
            }}
            className="text-white/70 hover:text-white hover:bg-white/10"
          >
            {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Progress Bar / Playing Equalizer */}
      <div className="space-y-1.5 pt-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-indigo-400 transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
        {isPlaying && (
          <div className="flex items-center justify-between text-[10px] font-mono text-cyan-100">
            <span>● AUDIO PLAYING — ANSWER QUESTIONS CONCURRENTLY</span>
            <span>OFFICIAL IELTS FORMAT</span>
          </div>
        )}
        {audioError && (
          <p role="alert" className="pt-1 text-[11px] text-rose-200">{audioError}</p>
        )}
      </div>
    </div>
  )
}
