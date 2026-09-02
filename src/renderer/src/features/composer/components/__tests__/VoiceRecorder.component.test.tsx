import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceCaptureController } from '../../hooks/useVoiceCapture'
import { VoiceRecorder } from '../VoiceRecorder'

const voiceVisualizer = vi.hoisted(() => vi.fn())

vi.mock('@/features/sessions/hooks/useProject', () => ({
  useProject: () => ({ projectPath: '/tmp/project' }),
}))

vi.mock('react-voice-visualizer', () => ({
  VoiceVisualizer: (props: {
    readonly mainBarColor: string
    readonly secondaryBarColor: string
  }) => {
    voiceVisualizer({
      mainBarColor: props.mainBarColor,
      secondaryBarColor: props.secondaryBarColor,
    })
    return <div data-testid="voice-visualizer" />
  },
}))

function createVisualizerControls() {
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

function createFileInputRef() {
  return { current: null }
}

describe('VoiceRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.style.setProperty('--color-text-primary', 'white')
    document.documentElement.style.setProperty('--color-text-muted', 'gray')
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders the compact recording row with timer and actions', () => {
    render(
      <VoiceRecorder
        fileInputRef={createFileInputRef()}
        voice={createVoiceController({ elapsedSeconds: 9 })}
      />,
    )

    expect(screen.getByTitle('Add to message')).toBeEnabled()
    expect(screen.getByTitle('Stop recording')).toBeInTheDocument()
    expect(screen.getByTitle('Send recording')).toBeInTheDocument()
    expect(screen.getByText('0:09')).toBeInTheDocument()
    expect(screen.getByTestId('voice-visualizer')).toBeInTheDocument()
    expect(voiceVisualizer).toHaveBeenCalledWith(
      expect.objectContaining({
        mainBarColor: 'white',
        secondaryBarColor: 'gray',
      }),
    )
  })

  it('refreshes resolved canvas colors when the appearance changes', async () => {
    render(<VoiceRecorder fileInputRef={createFileInputRef()} voice={createVoiceController()} />)

    await act(async () => {
      document.documentElement.style.setProperty('--color-text-primary', 'black')
      document.documentElement.style.setProperty('--color-text-muted', 'silver')
      document.documentElement.setAttribute('data-theme', 'debug')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(voiceVisualizer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mainBarColor: 'black',
          secondaryBarColor: 'silver',
        }),
      )
    })
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
