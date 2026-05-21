import type { RefObject } from 'react'
import type { VoiceCaptureController } from '../hooks/useVoiceCapture'
import { ComposerToolbar } from './ComposerToolbar'
import { VoiceRecorder } from './VoiceRecorder'

interface ComposerModeControlsProps {
  readonly fileInputRef: RefObject<HTMLInputElement | null>
  readonly voice: VoiceCaptureController
  readonly onSubmit: () => void
  readonly onCancel: () => void
  readonly isLoading: boolean
  readonly canSend: boolean
  readonly sendTitle?: string
}

export function ComposerModeControls({
  fileInputRef,
  voice,
  onSubmit,
  onCancel,
  isLoading,
  canSend,
  sendTitle,
}: ComposerModeControlsProps) {
  if (voice.isActive) {
    return <VoiceRecorder fileInputRef={fileInputRef} voice={voice} />
  }

  return (
    <ComposerToolbar
      onSend={onSubmit}
      onCancel={onCancel}
      isLoading={isLoading}
      canSend={canSend}
      onToggleVoice={voice.toggleVoice}
      voiceMode={voice.mode}
      fileInputRef={fileInputRef}
      sendTitle={sendTitle}
    />
  )
}
