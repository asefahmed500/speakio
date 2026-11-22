"use client"

/**
 * Real-time WAV segment recorder for the speaking exam.
 *
 * Captures microphone PCM in the browser at a 16 kHz AudioContext, and emits
 * 16-bit PCM WAV segments of at most 30 seconds each — the Z.AI ASR limit —
 * while a single full recording is kept for local preview.
 *
 * Ordering guarantee: segment slots are reserved synchronously in capture
 * order and filled in place, so `stop()` always returns segments in
 * chronological order regardless of FileReader latency. The AudioContext is
 * requested at 16 kHz; if the device refuses, a fractional linear resampler
 * runs instead of integer decimation, so the WAV header rate is always honest.
 */

const TARGET_RATE = 16_000
const MAX_SEGMENT_SECONDS = 30
const SEGMENT_SAMPLES = TARGET_RATE * MAX_SEGMENT_SECONDS

export interface WavRecordingResult {
  /** `data:audio/wav;base64,...` segments, each ≤30 s, in capture order. */
  dataUrls: string[]
  /** Single concatenated WAV for local `<audio>` preview. */
  previewBlob: Blob
  durationSeconds: number
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }
  writeString(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return new Blob([view], { type: "audio/wav" })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("WAV encoding failed"))
    reader.readAsDataURL(blob)
  })
}

/** Fractional decimation: honest output rate even for 44.1 kHz contexts. */
function downsample(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_RATE) return input
  const step = inputRate / TARGET_RATE
  const outLength = Math.ceil(input.length / step)
  const out = new Float32Array(outLength)
  for (let j = 0; j < outLength; j++) {
    const pos = j * step
    const i = Math.floor(pos)
    const frac = pos - i
    const a = input[i] ?? 0
    const b = input[i + 1] ?? a
    out[j] = a + (b - a) * frac
  }
  return out
}

export class WavSegmentRecorder {
  private context: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private silence: GainNode | null = null
  private stream: MediaStream | null = null

  private pending: Float32Array[] = []
  private pendingCount = 0
  private all: Float32Array[] = []
  private allCount = 0

  /** Ordered slots — reserved synchronously, filled as encodes complete. */
  private segments: string[] = []
  private inFlight: Array<Promise<void>> = []
  /** Called after a slot is filled (progress UI). */
  onSegment: ((filledCount: number) => void) | null = null

  get segmentCount(): number {
    return this.segments.filter(Boolean).length
  }

  /** Live microphone stream, exposed for the exam waveform visualizer. */
  get microphoneStream(): MediaStream | null {
    return this.stream
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    // Request the ASR-native rate directly; browsers that honor it skip the
    // resampler entirely.
    try {
      this.context = new Ctor({ sampleRate: TARGET_RATE })
    } catch {
      this.context = new Ctor()
    }
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    // The processor only fires while connected to the graph — route through a
    // zero-gain node so nothing is audible.
    this.silence = this.context.createGain()
    this.silence.gain.value = 0

    const inputRate = this.context.sampleRate

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      const out = downsample(input, inputRate)
      this.pending.push(out)
      this.pendingCount += out.length
      this.all.push(out)
      this.allCount += out.length

      while (this.pendingCount >= SEGMENT_SAMPLES) {
        this.sealSegment()
      }
    }

    this.source.connect(this.processor)
    this.processor.connect(this.silence)
    this.silence.connect(this.context.destination)
  }

  /**
   * Carves exactly SEGMENT_SAMPLES out of the pending buffer. The output slot
   * is reserved synchronously (preserving capture order) and filled when the
   * async encode completes; stop() awaits all of these.
   */
  private sealSegment(): void {
    const segment = new Float32Array(SEGMENT_SAMPLES)
    let filled = 0
    while (filled < SEGMENT_SAMPLES && this.pending.length > 0) {
      const chunk = this.pending[0]
      const needed = SEGMENT_SAMPLES - filled
      if (chunk.length <= needed) {
        segment.set(chunk, filled)
        filled += chunk.length
        this.pending.shift()
      } else {
        segment.set(chunk.subarray(0, needed), filled)
        this.pending[0] = chunk.subarray(needed)
        filled += needed
      }
    }
    this.pendingCount -= filled
    const slot = this.segments.length
    this.segments.push("") // reserve order
    const encode = blobToDataUrl(encodeWav(segment, TARGET_RATE)).then((dataUrl) => {
      this.segments[slot] = dataUrl
      this.onSegment?.(this.segmentCount)
    })
    this.inFlight.push(encode)
  }

  async stop(): Promise<WavRecordingResult> {
    // Disconnect FIRST so no audio lands after the tail flush.
    this.processor?.disconnect()
    this.source?.disconnect()
    this.silence?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())

    // Flush the trailing partial segment (tail belongs at the end, so it is
    // pushed after every reserved slot).
    if (this.pendingCount > 0) {
      const rest = new Float32Array(this.pendingCount)
      let filled = 0
      for (const chunk of this.pending) {
        rest.set(chunk, filled)
        filled += chunk.length
      }
      this.pending = []
      this.pendingCount = 0
      const slot = this.segments.length
      this.segments.push("")
      this.inFlight.push(
        blobToDataUrl(encodeWav(rest, TARGET_RATE)).then((dataUrl) => {
          this.segments[slot] = dataUrl
        }),
      )
    }

    // Every reserved slot must be filled before reading the result.
    await Promise.all(this.inFlight)
    this.inFlight = []

    void this.context?.close()
    this.context = null
    this.processor = null
    this.source = null
    this.silence = null
    this.stream = null

    const all = new Float32Array(this.allCount)
    let filled = 0
    for (const chunk of this.all) {
      all.set(chunk, filled)
      filled += chunk.length
    }
    const previewBlob = encodeWav(all, TARGET_RATE)
    return {
      dataUrls: [...this.segments],
      previewBlob,
      durationSeconds: this.allCount / TARGET_RATE,
    }
  }

  /** Releases the microphone without producing a result (unmount safety). */
  abort(): void {
    this.processor?.disconnect()
    this.source?.disconnect()
    this.silence?.disconnect()
    void this.context?.close()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.context = null
    this.processor = null
    this.source = null
    this.silence = null
    this.stream = null
    this.pending = []
    this.pendingCount = 0
  }
}
