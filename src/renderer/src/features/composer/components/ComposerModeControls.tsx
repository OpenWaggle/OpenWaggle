import type { ReactNode, RefObject } from 'react'
import type { VoiceCaptureController } from '../hooks/useVoiceCapture'
import { ComposerToolbar } from './ComposerToolbar'
import { VoiceRecorder } from './VoiceRecorder'

interface ComposerModeControlsProps {
  readonly accessControl?: ReactNode
  readonly fileInputRef: RefObject<HTMLInputElement | null>
  readonly voice: VoiceCaptureController
  readonly onSubmit: () => void
  readonly onCancel: () => void
  readonly isLoading: boolean
  readonly canSend: boolean
  readonly sendTitle?: string
}

export function ComposerModeControls({
  accessControl,
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
      accessControl={accessControl}
      submission={{ onSend: onSubmit, onCancel, isLoading, canSend, sendTitle }}
      onToggleVoice={voice.toggleVoice}
      voiceMode={voice.mode}
      fileInputRef={fileInputRef}
    />
  )
}
