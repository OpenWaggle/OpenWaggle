import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/stores/composer-store'
import { VoiceRecorder } from '../VoiceRecorder'

describe('VoiceRecorder', () => {
  const onSendVoice = vi.fn()
  const mediaRecorderRef = { current: null } as React.RefObject<MediaRecorder | null>

  function renderRecorder() {
    return render(<VoiceRecorder onSendVoice={onSendVoice} mediaRecorderRef={mediaRecorderRef} />)
  }

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    onSendVoice.mockClear()
  })

  it('shows transcribing state when not listening', () => {
    useComposerStore.setState({ isListening: false, isTranscribingVoice: true })
    renderRecorder()
    expect(screen.getByText('Transcribing locally...')).toBeInTheDocument()
  })

  it('shows waveform bars when listening', () => {
    useComposerStore.setState({
      isListening: true,
      voiceWaveform: [0.5, 0.8, 0.3],
      voiceElapsedSeconds: 5,
    })
    renderRecorder()
    // Should not show transcribing text when listening
    expect(screen.queryByText('Transcribing locally...')).toBeNull()
  })

  it('formats elapsed time correctly', () => {
    useComposerStore.setState({
      isListening: true,
      voiceElapsedSeconds: 65,
      voiceWaveform: [],
    })
    renderRecorder()
    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  it('shows 0:00 for zero seconds', () => {
    useComposerStore.setState({
      isListening: true,
      voiceElapsedSeconds: 0,
      voiceWaveform: [],
    })
    renderRecorder()
    expect(screen.getByText('0:00')).toBeInTheDocument()
  })

  it('shows stop button when listening', () => {
    useComposerStore.setState({ isListening: true, voiceWaveform: [] })
    renderRecorder()
    expect(screen.getByTitle('Stop recording')).toBeInTheDocument()
  })

  it('does not show stop button when transcribing', () => {
    useComposerStore.setState({ isListening: false, isTranscribingVoice: true })
    renderRecorder()
    expect(screen.queryByTitle('Stop recording')).toBeNull()
  })

  it('shows send button', () => {
    useComposerStore.setState({ isListening: true, voiceWaveform: [] })
    renderRecorder()
    expect(screen.getByTitle('Send recording')).toBeInTheDocument()
  })

  it('disables send button when transcribing', () => {
    useComposerStore.setState({ isListening: false, isTranscribingVoice: true })
    renderRecorder()
    expect(screen.getByTitle('Send recording')).toBeDisabled()
  })

  it('calls onSendVoice when send button is clicked', () => {
    useComposerStore.setState({ isListening: true, voiceWaveform: [] })
    renderRecorder()
    fireEvent.click(screen.getByTitle('Send recording'))
    expect(onSendVoice).toHaveBeenCalledOnce()
  })

  it('shows attach button disabled', () => {
    useComposerStore.setState({ isListening: true, voiceWaveform: [] })
    renderRecorder()
    expect(screen.getByTitle('Attach files')).toBeDisabled()
  })

  it('shows ellipsis for timer when transcribing', () => {
    useComposerStore.setState({ isListening: false, isTranscribingVoice: true })
    renderRecorder()
    expect(screen.getByText('...')).toBeInTheDocument()
  })
})
