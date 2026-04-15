import { TIME_UNIT } from '@shared/constants/time'
import { VOICE_MODEL_BASE } from '@shared/types/voice'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useVoiceVisualizer } from 'react-voice-visualizer'
import { api } from '@/lib/ipc'
import { useComposerStore } from '@/stores/composer-store'
import {
  decodeAudioBlob,
  downsampleAudio,
  toPcm16,
  trimSilence,
  WHISPER_TARGET_SAMPLE_RATE,
} from './voice-utils'

type VoiceSubmitAction = 'insert' | 'send'
const VOICE_DURATION_PAD_LENGTH = 2

export type VoiceRecorderMode = 'idle' | 'recording' | 'transcribing'
export type VoiceVisualizerControls = ReturnType<typeof useVoiceVisualizer>

interface UseVoiceCaptureOptions {
  insertText: (text: string) => void
  sendComposed: (text: string) => boolean
}

export interface VoiceCaptureController {
  canStart: boolean
  clearError: () => void
  elapsedSeconds: number
  error: string | null
  isActive: boolean
  mode: VoiceRecorderMode
  stopAndSend: () => void
  stopCapture: () => void
  toggleVoice: () => void
  visualizerControls: VoiceVisualizerControls
}

function formatVoiceError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Voice input is unavailable in this environment. Continue by typing your prompt.'
}

export function useVoiceCapture({
  insertText,
  sendComposed,
}: UseVoiceCaptureOptions): VoiceCaptureController {
  const [error, setError] = useState<string | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [lastElapsedSeconds, setLastElapsedSeconds] = useState(0)

  const sendComposedRef = useRef(sendComposed)
  sendComposedRef.current = sendComposed

  const insertTextRef = useRef(insertText)
  insertTextRef.current = insertText

  const pendingSubmitActionRef = useRef<VoiceSubmitAction>('insert')
  const handledBlobRef = useRef<Blob | null>(null)

  const visualizerControls = useVoiceVisualizer({
    shouldHandleBeforeUnload: false,
  })

  const isRecording =
    visualizerControls.isRecordingInProgress || visualizerControls.isProcessingStartRecording
  const mode: VoiceRecorderMode = isTranscribing
    ? 'transcribing'
    : isRecording
      ? 'recording'
      : 'idle'
  const elapsedSeconds = isRecording
    ? Math.floor(visualizerControls.recordingTime / TIME_UNIT.MILLISECONDS_PER_SECOND)
    : lastElapsedSeconds

  useEffect(() => {
    if (!isRecording) return
    setLastElapsedSeconds(
      Math.floor(visualizerControls.recordingTime / TIME_UNIT.MILLISECONDS_PER_SECOND),
    )
  }, [isRecording, visualizerControls.recordingTime])

  useEffect(() => {
    if (!visualizerControls.error) return
    setIsTranscribing(false)
    setError(formatVoiceError(visualizerControls.error))
  }, [visualizerControls.error])

  function insertTranscriptAtCursor(rawTranscript: string): void {
    const transcript = rawTranscript.trim()
    if (!transcript) return

    const store = useComposerStore.getState()
    const currentInput = store.input.trim()
    const needsLeadingSpace = currentInput.length > 0 && !/\s$/.test(currentInput)
    const inserted = `${needsLeadingSpace ? ' ' : ''}${transcript}`

    insertTextRef.current(inserted)
  }

  const handleRecordedBlob = useEffectEvent(async (blob: Blob, action: VoiceSubmitAction) => {
    setIsTranscribing(true)
    setError(null)

    try {
      const decoded = await decodeAudioBlob(blob)
      const whisperSamples = downsampleAudio(
        decoded.samples,
        decoded.sampleRate,
        WHISPER_TARGET_SAMPLE_RATE,
      )
      const trimmedSamples = trimSilence(whisperSamples, WHISPER_TARGET_SAMPLE_RATE)
      if (trimmedSamples.length === 0) {
        setError('No speech detected. Try again or continue typing.')
        return
      }

      const result = await api.transcribeVoiceLocal({
        pcm16: toPcm16(trimmedSamples),
        sampleRate: WHISPER_TARGET_SAMPLE_RATE,
        model: VOICE_MODEL_BASE,
      })
      const transcript = result.text.trim()
      if (!transcript) {
        setError('No speech detected. Try again or continue typing.')
        return
      }

      if (action === 'send') {
        const store = useComposerStore.getState()
        const composedText = [store.input.trim(), transcript].filter(Boolean).join(' ')
        const submitted = sendComposedRef.current(composedText)
        if (!submitted) {
          insertTranscriptAtCursor(transcript)
        }
      } else {
        insertTranscriptAtCursor(transcript)
      }
    } catch (transcriptionError) {
      setError(formatVoiceError(transcriptionError))
    } finally {
      visualizerControls.clearCanvas()
      handledBlobRef.current = null
      setIsTranscribing(false)
    }
  })

  useEffect(() => {
    const recordedBlob = visualizerControls.recordedBlob
    if (!recordedBlob || recordedBlob === handledBlobRef.current) return
    handledBlobRef.current = recordedBlob
    void handleRecordedBlob(recordedBlob, pendingSubmitActionRef.current)
  }, [visualizerControls.recordedBlob])

  function startCapture(): void {
    pendingSubmitActionRef.current = 'insert'
    handledBlobRef.current = null
    setError(null)
    setLastElapsedSeconds(0)
    visualizerControls.clearCanvas()
    visualizerControls.startRecording()
  }

  function stopRecorder(action: VoiceSubmitAction): void {
    if (!isRecording) return
    pendingSubmitActionRef.current = action
    visualizerControls.stopRecording()
  }

  function stopCapture(): void {
    stopRecorder('insert')
  }

  function stopAndSend(): void {
    stopRecorder('send')
  }

  function toggleVoice(): void {
    if (mode === 'transcribing') return
    if (isRecording) {
      stopCapture()
      return
    }
    startCapture()
  }

  function clearError(): void {
    setError(null)
  }

  return {
    canStart: mode === 'idle',
    clearError,
    elapsedSeconds,
    error,
    isActive: mode !== 'idle',
    mode,
    stopAndSend,
    stopCapture,
    toggleVoice,
    visualizerControls,
  }
}

export function formatVoiceDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutesPart = Math.floor(seconds / TIME_UNIT.SECONDS_PER_MINUTE)
  const secondsPart = seconds % TIME_UNIT.SECONDS_PER_MINUTE
  return `${String(minutesPart)}:${String(secondsPart).padStart(VOICE_DURATION_PAD_LENGTH, '0')}`
}
