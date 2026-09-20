import type { ComponentProps, ReactNode, RefObject } from 'react'
import type { VoiceCaptureController } from '../hooks/useVoiceCapture'
import { ComposerToolbar } from './ComposerToolbar'
import { VoiceRecorder } from './VoiceRecorder'

interface ComposerModeControlsProps {
  readonly disabled?: boolean
  readonly accessControl?: ReactNode
  readonly fileInputRef: RefObject<HTMLInputElement | null>
  readonly voice: VoiceCaptureController
  readonly submission: ComponentProps<typeof ComposerToolbar>['submission']
}

export function ComposerModeControls({
  disabled,
  accessControl,
  fileInputRef,
  voice,
  submission,
}: ComposerModeControlsProps) {
  if (voice.isActive) {
    return <VoiceRecorder fileInputRef={fileInputRef} voice={voice} disabled={disabled} />
  }

  return (
    <ComposerToolbar
      disabled={disabled}
      accessControl={accessControl}
      submission={submission}
      onToggleVoice={voice.toggleVoice}
      voiceMode={voice.mode}
      fileInputRef={fileInputRef}
    />
  )
}
