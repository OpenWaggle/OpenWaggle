import { VOICE_MODEL_BASE } from '@shared/types/voice'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/stores/composer-store'
import type { VoiceVisualizerControls } from '../useVoiceCapture'

const mocks = vi.hoisted(() => ({
  decodeAudioBlob: vi.fn(async () => ({
    durationSeconds: 4,
    sampleRate: 48_000,
    samples: new Float32Array([0.04, 0.32, -0.54, 0.72]),
  })),
  transcribeVoiceLocal: vi.fn(async () => ({ text: 'draft transcript' })),
  useVoiceVisualizer: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    transcribeVoiceLocal: mocks.transcribeVoiceLocal,
  },
}))

vi.mock('../voice-utils', async () => {
  const actual = await vi.importActual<typeof import('../voice-utils')>('../voice-utils')
  return {
    ...actual,
    decodeAudioBlob: mocks.decodeAudioBlob,
  }
})

vi.mock('react-voice-visualizer', () => ({
  VoiceVisualizer: () => null,
  useVoiceVisualizer: mocks.useVoiceVisualizer,
}))

import { useVoiceCapture } from '../useVoiceCapture'

function createVisualizerControls(): VoiceVisualizerControls {
  return {
    _setIsProcessingAudioOnComplete: vi.fn(),
    _setIsProcessingOnResize: vi.fn(),
    audioData: new Uint8Array(),
    audioRef: { current: null },
    audioSrc: '',
    bufferFromRecordedBlob: null,
    clearCanvas: vi.fn(),
    currentAudioTime: 0,
    duration: 0,
    error: null,
    formattedDuration: '00:00',
    formattedRecordedAudioCurrentTime: '00:00',
    formattedRecordingTime: '00:00',
    isAvailableRecordedAudio: false,
    isCleared: false,
    isPausedRecordedAudio: false,
    isPausedRecording: false,
    isPreloadedBlob: false,
    isProcessingOnResize: false,
    isProcessingRecordedAudio: false,
    isProcessingStartRecording: false,
    isRecordingInProgress: false,
    mediaRecorder: null,
    recordedBlob: null,
    recordingTime: 0,
    saveAudioFile: vi.fn(),
    setCurrentAudioTime: vi.fn(),
    setPreloadedAudioBlob: vi.fn(),
    startAudioPlayback: vi.fn(),
    startRecording: vi.fn(),
    stopAudioPlayback: vi.fn(),
    stopRecording: vi.fn(),
    togglePauseResume: vi.fn(),
  }
}

describe('useVoiceCapture', () => {
  let visualizerControls: VoiceVisualizerControls

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    mocks.decodeAudioBlob.mockClear()
    mocks.transcribeVoiceLocal.mockClear()
    visualizerControls = createVisualizerControls()
    visualizerControls.startRecording = vi.fn(() => {
      visualizerControls.isRecordingInProgress = true
      visualizerControls.recordingTime = 9000
    })
    visualizerControls.stopRecording = vi.fn(() => {
      visualizerControls.isRecordingInProgress = false
      visualizerControls.recordedBlob = new Blob(['voice'], { type: 'audio/webm' })
    })
    mocks.useVoiceVisualizer.mockImplementation(() => visualizerControls)
  })

  function renderVoiceHook(sendComposed = vi.fn(() => true)) {
    const textarea = document.createElement('textarea')
    textarea.value = ''
    textarea.selectionStart = 0
    textarea.selectionEnd = 0
    return {
      sendComposed,
      ...renderHook(() =>
        useVoiceCapture({
          textareaRef: { current: textarea },
          sendComposed,
        }),
      ),
    }
  }

  it('starts recording and exposes the inline recording mode', () => {
    const hook = renderVoiceHook()

    act(() => {
      hook.result.current.toggleVoice()
    })
    hook.rerender()

    expect(visualizerControls.startRecording).toHaveBeenCalledOnce()
    expect(hook.result.current.mode).toBe('recording')
    expect(hook.result.current.elapsedSeconds).toBe(9)
  })

  it('stops and transcribes into the composer input', async () => {
    const hook = renderVoiceHook()

    act(() => {
      hook.result.current.toggleVoice()
    })
    hook.rerender()

    act(() => {
      hook.result.current.stopCapture()
    })
    hook.rerender()

    await waitFor(() => expect(hook.result.current.mode).toBe('idle'))
    expect(mocks.transcribeVoiceLocal).toHaveBeenCalledWith({
      pcm16: expect.any(Uint8Array),
      sampleRate: 16_000,
      model: VOICE_MODEL_BASE,
    })
    expect(useComposerStore.getState().input).toBe('draft transcript')
  })

  it('stops and sends the transcript in one action', async () => {
    useComposerStore.setState({ input: 'prefix' })
    const sendComposed = vi.fn(() => true)
    const hook = renderVoiceHook(sendComposed)

    act(() => {
      hook.result.current.toggleVoice()
    })
    hook.rerender()

    act(() => {
      hook.result.current.stopAndSend()
    })
    hook.rerender()

    await waitFor(() => expect(hook.result.current.mode).toBe('idle'))
    expect(sendComposed).toHaveBeenCalledWith('prefix draft transcript')
  })

  it('surfaces the no-speech message when transcription is empty', async () => {
    mocks.transcribeVoiceLocal.mockResolvedValueOnce({ text: '   ' })
    const hook = renderVoiceHook()

    act(() => {
      hook.result.current.toggleVoice()
    })
    hook.rerender()

    act(() => {
      hook.result.current.stopCapture()
    })
    hook.rerender()

    await waitFor(() => expect(hook.result.current.mode).toBe('idle'))
    expect(hook.result.current.error).toBe('No speech detected. Try again or continue typing.')
  })

  it('clears the voice error on dismiss', async () => {
    mocks.transcribeVoiceLocal.mockResolvedValueOnce({ text: '   ' })
    const hook = renderVoiceHook()

    act(() => {
      hook.result.current.toggleVoice()
    })
    hook.rerender()

    act(() => {
      hook.result.current.stopCapture()
    })
    hook.rerender()

    await waitFor(() => expect(hook.result.current.error).toBeTruthy())

    act(() => {
      hook.result.current.clearError()
    })

    expect(hook.result.current.error).toBeNull()
  })
})
