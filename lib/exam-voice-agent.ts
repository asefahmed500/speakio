/**
 * Speakio Real-Time IELTS Voice & Audio Agent
 *
 * Provides:
 * 1. Web Speech Synthesis for realistic British/Australian/US IELTS Examiner voice prompts.
 * 2. Web Audio API Analyser for live candidate microphone waveform/volume visualization.
 * 3. Sound check generator for audio calibration before exams start.
 */

export interface SpeechVoiceOption {
  voice: SpeechSynthesisVoice
  name: string
  lang: string
}

export class ExamVoiceAgent {
  private synth: SpeechSynthesis | null = null
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private mediaStream: MediaStream | null = null
  private isSpeaking = false
  private muted = false

  constructor() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      this.synth = window.speechSynthesis
    }
  }

  /**
   * Find the most natural British or English voice for the IELTS examiner persona.
   */
  public getExaminerVoice(): SpeechSynthesisVoice | null {
    if (!this.synth) return null
    const voices = this.synth.getVoices()
    if (!voices || voices.length === 0) return null

    // Prefer British English ("en-GB") voices for official IELTS authentic feel
    const gbVoice = voices.find(
      (v) =>
        v.lang === "en-GB" &&
        (v.name.includes("Natural") ||
          v.name.includes("Online") ||
          v.name.includes("George") ||
          v.name.includes("Hazel") ||
          v.name.includes("Oliver") ||
          v.name.includes("Daniel") ||
          v.name.includes("Google UK English Male") ||
          v.name.includes("Google UK English Female"))
    )
    if (gbVoice) return gbVoice

    // Any British English voice
    const anyGb = voices.find((v) => v.lang.startsWith("en-GB"))
    if (anyGb) return anyGb

    // Any English voice
    const anyEn = voices.find((v) => v.lang.startsWith("en"))
    return anyEn || voices[0] || null
  }

  /**
   * Speak an IELTS prompt aloud as the examiner.
   */
  public speak(
    text: string,
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (err: unknown) => void
  ): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synth) {
        onEnd?.()
        resolve()
        return
      }

      this.cancel()

      const cleanedText = text
        .replace(/[*_#`]/g, "")
        .replace(/You should say:?/gi, "You should say:")
        .trim()

      const utterance = new SpeechSynthesisUtterance(cleanedText)
      const examinerVoice = this.getExaminerVoice()
      if (examinerVoice) {
        utterance.voice = examinerVoice
      }

      utterance.rate = 0.95 // Measured, calm IELTS examiner pace
      utterance.pitch = 1.0
      utterance.volume = this.muted ? 0 : 1

      utterance.onstart = () => {
        this.isSpeaking = true
        onStart?.()
      }

      utterance.onend = () => {
        this.isSpeaking = false
        this.currentUtterance = null
        onEnd?.()
        resolve()
      }

      utterance.onerror = (e) => {
        this.isSpeaking = false
        this.currentUtterance = null
        onError?.(e)
        resolve()
      }

      this.currentUtterance = utterance
      this.synth.speak(utterance)
    })
  }

  public cancel() {
    if (this.synth) {
      this.synth.cancel()
    }
    this.isSpeaking = false
    this.currentUtterance = null
  }

  public get speaking(): boolean {
    return this.isSpeaking
  }

  /** Mute/unmute examiner speech synthesis (used by the listening player). */
  public setMuted(muted: boolean): void {
    this.muted = muted
    if (this.currentUtterance) {
      this.currentUtterance.volume = muted ? 0 : 1
    }
  }

  /**
   * Plays a crisp audio calibration chime for testing headphones/speakers.
   */
  public playSoundCheckTone(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioCtx()

        const now = ctx.currentTime
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        osc.type = "sine"
        // Two-tone British Council test chime: 440Hz -> 880Hz
        osc.frequency.setValueAtTime(440, now)
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.25)

        gain.gain.setValueAtTime(0.01, now)
        gain.gain.exponentialRampToValueAtTime(0.2, now + 0.1)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)

        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.start(now)
        osc.stop(now + 0.6)

        osc.onended = () => {
          void ctx.close()
          resolve()
        }
      } catch {
        resolve()
      }
    })
  }

  /**
   * Initialize microphone visualizer using Web Audio API AnalyserNode.
   */
  public async initMicVisualizer(stream: MediaStream): Promise<{
    analyser: AnalyserNode
    getVolume: () => number
    stop: () => void
  }> {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()

    analyser.fftSize = 64
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const getVolume = (): number => {
      analyser.getByteFrequencyData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]
      }
      const avg = sum / dataArray.length
      return Math.min(100, Math.round((avg / 255) * 100))
    }

    const stop = () => {
      try {
        source.disconnect()
        analyser.disconnect()
        void ctx.close()
      } catch {}
    }

    return { analyser, getVolume, stop }
  }
}

export const examVoiceAgent = new ExamVoiceAgent()
