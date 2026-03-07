import { fireEvent, render, screen } from '@testing-library/react'
import type { RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceCaptureController, VoiceVisualizerControls } from '../useVoiceCapture'
import { VoiceRecorder } from '../VoiceRecorder'

vi.mock('@/hooks/useProject', () => ({
  useProject: () => ({ projectPath: '/tmp/project' }),
}))

vi.mock('react-voice-visualizer', () => ({
  VoiceVisualizer: () => <div data-testid="voice-visualizer" />,
}))

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
    formattedRecordingTime: '00:09',
    isAvailableRecordedAudio: false,
    isCleared: false,
    isPausedRecordedAudio: false,
    isPausedRecording: false,
    isPreloadedBlob: false,
    isProcessingOnResize: false,
    isProcessingRecordedAudio: false,
    isProcessingStartRecording: false,
    isRecordingInProgress: true,
    mediaRecorder: null,
    recordedBlob: null,
    recordingTime: 9000,
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

function createVoiceController(
  overrides: Partial<VoiceCaptureController> = {},
): VoiceCaptureController {
  return {
    canStart: false,
    clearError: vi.fn(),
    elapsedSeconds: 9,
    error: null,
    isActive: true,
    mode: 'recording',
    stopAndSend: vi.fn(),
    stopCapture: vi.fn(),
    toggleVoice: vi.fn(),
    visualizerControls: createVisualizerControls(),
    ...overrides,
  }
}

function createFileInputRef(): RefObject<HTMLInputElement | null> {
  return { current: null }
}

describe('VoiceRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the compact recording row with timer and actions', () => {
    render(
      <VoiceRecorder
        fileInputRef={createFileInputRef()}
        voice={createVoiceController({ elapsedSeconds: 9 })}
      />,
    )

    expect(screen.getByTitle('Attach files')).toBeEnabled()
    expect(screen.getByTitle('Stop recording')).toBeInTheDocument()
    expect(screen.getByTitle('Send recording')).toBeInTheDocument()
    expect(screen.getByText('0:09')).toBeInTheDocument()
    expect(screen.getByTestId('voice-visualizer')).toBeInTheDocument()
  })

  it('calls stop and send actions from the inline controls', () => {
    const voice = createVoiceController()
    render(<VoiceRecorder fileInputRef={createFileInputRef()} voice={voice} />)

    fireEvent.click(screen.getByTitle('Stop recording'))
    fireEvent.click(screen.getByTitle('Send recording'))

    expect(voice.stopCapture).toHaveBeenCalledOnce()
    expect(voice.stopAndSend).toHaveBeenCalledOnce()
  })

  it('shows the transcribing spinner state and disables send', () => {
    render(
      <VoiceRecorder
        fileInputRef={createFileInputRef()}
        voice={createVoiceController({ mode: 'transcribing' })}
      />,
    )

    expect(screen.queryByTitle('Stop recording')).toBeNull()
    expect(screen.getByTitle('Send recording')).toBeDisabled()
  })
})
