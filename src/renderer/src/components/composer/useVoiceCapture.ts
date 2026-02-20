import { VOICE_MODEL_TINY } from '@shared/types/voice'
import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import { api } from '@/lib/ipc'
import { useComposerStore } from '@/stores/composer-store'

const VOICE_CAPTURE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const
const WHISPER_TARGET_SAMPLE_RATE = 16_000
const VOICE_MAX_RECORDING_SECONDS = 90
const VOICE_WAVEFORM_BARS = 72
const VOICE_WAVEFORM_SHIFT_PER_SECOND = 2

interface UseVoiceCaptureOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  /** Send composed text (existing input + transcript). Returns true if sent. */
  sendComposed: (text: string) => boolean
}

interface UseVoiceCaptureReturn {
  toggleVoice: () => void
  sendVoice: () => void
  stopCapture: () => void
  mediaRecorderRef: RefObject<MediaRecorder | null>
}

// ── Audio processing helpers ──

function downsampleAudio(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (sourceRate === targetRate) return new Float32Array(samples)
  const ratio = sourceRate / targetRate
  const len = Math.max(1, Math.round(samples.length / ratio))
  const out = new Float32Array(len)
  for (let i = 0; i < len; i += 1) {
    const si = i * ratio
    const lo = Math.floor(si)
    const hi = Math.min(samples.length - 1, lo + 1)
    const t = si - lo
    out[i] = samples[lo] * (1 - t) + samples[hi] * t
  }
  return out
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return new Float32Array(buffer.getChannelData(0))
  const mono = new Float32Array(buffer.length)
  const w = 1 / buffer.numberOfChannels
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] * w
  }
  return mono
}

async function decodeRecordedAudio(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    return downsampleAudio(toMono(decoded), decoded.sampleRate, WHISPER_TARGET_SAMPLE_RATE)
  } finally {
    await ctx.close().catch(() => undefined)
  }
}

function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  threshold = 0.012,
  paddingMs = 160,
): Float32Array {
  if (samples.length === 0) return samples
  let start = 0
  while (start < samples.length && Math.abs(samples[start]) < threshold) start += 1
  let end = samples.length - 1
  while (end > start && Math.abs(samples[end]) < threshold) end -= 1
  if (start >= end) return samples
  const pad = Math.round((paddingMs / 1000) * sampleRate)
  return samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad))
}

function toPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true)
  }
  return bytes
}

// ── Hook ──

export function useVoiceCapture({
  textareaRef,
  sendComposed,
}: UseVoiceCaptureOptions): UseVoiceCaptureReturn {
  const setVoiceState = useComposerStore((s) => s.setVoiceState)

  const sendComposedRef = useRef(sendComposed)
  sendComposedRef.current = sendComposed

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const tickTimerRef = useRef<number | null>(null)
  const autoStopTimerRef = useRef<number | null>(null)
  const recordingStartRef = useRef<number | null>(null)
  const autoSendRef = useRef(false)

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      if (tickTimerRef.current !== null) window.clearInterval(tickTimerRef.current)
      if (autoStopTimerRef.current !== null) window.clearTimeout(autoStopTimerRef.current)
      analyserRef.current = null
      recordingStartRef.current = null
      void audioCtxRef.current?.close().catch(() => undefined)
      audioCtxRef.current = null
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) track.stop()
      }
      mediaStreamRef.current = null
      recordedChunksRef.current = []
      autoSendRef.current = false
    }
  }, [])

  function stopMeter(): void {
    if (tickTimerRef.current !== null) {
      window.clearInterval(tickTimerRef.current)
      tickTimerRef.current = null
    }
    if (autoStopTimerRef.current !== null) {
      window.clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
    analyserRef.current = null
    recordingStartRef.current = null
    void audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
    setVoiceState({ voiceElapsedSeconds: 0, voiceWaveform: [] })
  }

  function cleanupStream(): void {
    stopMeter()
    if (!mediaStreamRef.current) return
    for (const track of mediaStreamRef.current.getTracks()) track.stop()
    mediaStreamRef.current = null
  }

  function sampleLevel(): number {
    const analyser = analyserRef.current
    if (!analyser) return 0.08
    const data = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i += 1) {
      const n = (data[i] - 128) / 128
      sum += n * n
    }
    return Math.max(0.08, Math.min(1, Math.sqrt(sum / data.length) * 3.5))
  }

  async function startMeter(stream: MediaStream): Promise<void> {
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.6
    source.connect(analyser)

    audioCtxRef.current = ctx
    analyserRef.current = analyser
    recordingStartRef.current = Date.now()
    setVoiceState({
      voiceElapsedSeconds: 0,
      voiceWaveform: Array.from({ length: VOICE_WAVEFORM_BARS }, (_, i) =>
        i % 3 === 0 ? 0.2 : i % 2 === 0 ? 0.12 : 0.08,
      ),
    })

    tickTimerRef.current = window.setInterval(() => {
      if (!recordingStartRef.current) return
      const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000)
      const level = sampleLevel()
      const generated = Array.from({ length: VOICE_WAVEFORM_SHIFT_PER_SECOND }, (_, i) => {
        const variance = (Math.random() - 0.5) * 0.12
        const offset = i % 2 === 0 ? 0.03 : -0.02
        return Math.max(0.08, Math.min(1, level + variance + offset))
      })
      const prev = useComposerStore.getState().voiceWaveform
      const baseline =
        prev.length > 0 ? prev : Array.from({ length: VOICE_WAVEFORM_BARS }, () => 0.08)
      setVoiceState({
        voiceElapsedSeconds: elapsed,
        voiceWaveform: [...baseline.slice(generated.length), ...generated],
      })
    }, 1000)

    autoStopTimerRef.current = window.setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    }, VOICE_MAX_RECORDING_SECONDS * 1000)
  }

  function insertTranscriptAtCursor(rawTranscript: string): void {
    const transcript = rawTranscript.trim()
    if (!transcript) return

    const store = useComposerStore.getState()
    const textarea = textareaRef.current

    if (!textarea) {
      store.setInput([store.input.trim(), transcript].filter(Boolean).join(' '))
      return
    }

    const selStart = textarea.selectionStart ?? textarea.value.length
    const selEnd = textarea.selectionEnd ?? textarea.value.length
    const prev = store.input
    const before = prev.slice(0, selStart)
    const after = prev.slice(selEnd)
    const needsLead = before.length > 0 && !/\s$/.test(before)
    const needsTrail = after.length > 0 && !/^\s/.test(after)
    const inserted = `${needsLead ? ' ' : ''}${transcript}${needsTrail ? ' ' : ''}`

    store.setInput(`${before}${inserted}${after}`)

    requestAnimationFrame(() => {
      const caret = selStart + inserted.length
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
      store.setCursorIndex(caret)
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    })
  }

  async function transcribeChunks(chunks: Blob[]): Promise<void> {
    if (chunks.length === 0) {
      setVoiceState({ voiceError: 'No speech detected. Try again or continue typing.' })
      return
    }

    setVoiceState({ isTranscribingVoice: true, voiceError: null })

    try {
      const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' })
      const decoded = await decodeRecordedAudio(blob)
      const trimmed = trimSilence(decoded, WHISPER_TARGET_SAMPLE_RATE)
      if (trimmed.length === 0) {
        setVoiceState({ voiceError: 'No speech detected. Try again or continue typing.' })
        return
      }

      const result = await api.transcribeVoiceLocal({
        pcm16: toPcm16(trimmed),
        sampleRate: WHISPER_TARGET_SAMPLE_RATE,
        language: 'en',
        model: VOICE_MODEL_TINY,
      })

      if (!result.text.trim()) {
        autoSendRef.current = false
        setVoiceState({ voiceError: 'No speech detected. Try again or continue typing.' })
        return
      }

      const transcript = result.text.trim()
      const shouldAutoSend = autoSendRef.current
      autoSendRef.current = false

      if (shouldAutoSend) {
        const store = useComposerStore.getState()
        const composedText = [store.input.trim(), transcript].filter(Boolean).join(' ')
        const submitted = sendComposedRef.current(composedText)
        if (!submitted) {
          insertTranscriptAtCursor(transcript)
        }
      } else {
        insertTranscriptAtCursor(transcript)
      }
      setVoiceState({ voiceError: null })
    } catch (error) {
      autoSendRef.current = false
      const message =
        error instanceof Error
          ? error.message
          : 'Voice input is unavailable in this environment. Continue by typing your prompt.'
      setVoiceState({ voiceError: message })
    } finally {
      setVoiceState({ isTranscribingVoice: false })
    }
  }

  async function startCapture(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceState({
        voiceError:
          'Voice capture is unavailable in this environment. Continue by typing your prompt.',
      })
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      recordedChunksRef.current = []
      autoSendRef.current = false

      const mimeType = VOICE_CAPTURE_MIME_TYPES.find((c) => MediaRecorder.isTypeSupported(c))
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size === 0) return
        recordedChunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        setVoiceState({
          isListening: false,
          voiceError: 'Unable to record audio. Continue by typing your prompt.',
        })
        mediaRecorderRef.current = null
        recordedChunksRef.current = []
        cleanupStream()
      }
      recorder.onstop = () => {
        setVoiceState({ isListening: false })
        mediaRecorderRef.current = null
        const chunks = [...recordedChunksRef.current]
        recordedChunksRef.current = []
        cleanupStream()
        void transcribeChunks(chunks)
      }

      mediaRecorderRef.current = recorder
      setVoiceState({ voiceError: null })
      recorder.start()
      setVoiceState({ isListening: true })
      await startMeter(stream)
    } catch {
      cleanupStream()
      setVoiceState({
        isListening: false,
        voiceError: 'Microphone permission is blocked. Continue by typing your prompt.',
      })
    }
  }

  function stopCapture(): void {
    mediaRecorderRef.current?.stop()
  }

  function sendVoice(): void {
    const { isTranscribingVoice: transcribing, isListening: listening } =
      useComposerStore.getState()
    if (transcribing) return
    if (listening) {
      autoSendRef.current = true
      mediaRecorderRef.current?.stop()
    }
  }

  function toggleVoice(): void {
    const { isTranscribingVoice: transcribing, isListening: listening } =
      useComposerStore.getState()
    if (transcribing) return
    if (listening) {
      mediaRecorderRef.current?.stop()
      return
    }
    void startCapture()
  }

  return { toggleVoice, sendVoice, stopCapture, mediaRecorderRef }
}
