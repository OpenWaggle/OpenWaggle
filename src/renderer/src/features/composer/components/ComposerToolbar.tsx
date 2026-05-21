import type { RefObject } from 'react'
import { ComposerAttachButton } from './ComposerAttachButton'
import { ComposerModelPicker } from './ComposerModelPicker'
import { ComposerSendControls } from './ComposerSendControls'
import { ComposerVoiceButton } from './ComposerVoiceButton'
import { ContextMeter } from './ContextMeter'
import { ThinkingLevelMenu } from './ThinkingLevelMenu'

interface ComposerToolbarProps {
  readonly onSend: () => void
  readonly onCancel: () => void
  readonly isLoading: boolean
  readonly canSend: boolean
  readonly onToggleVoice: () => void
  readonly voiceMode: 'idle' | 'recording' | 'transcribing'
  readonly fileInputRef: RefObject<HTMLInputElement | null>
  readonly sendTitle?: string
}

export function ComposerToolbar({
  onSend,
  onCancel,
  isLoading,
  canSend,
  onToggleVoice,
  voiceMode,
  fileInputRef,
  sendTitle,
}: ComposerToolbarProps) {
  return (
    <div className="flex h-11 items-center justify-between px-4">
      <div className="flex items-center gap-1.5">
        <ComposerAttachButton fileInputRef={fileInputRef} />
        <ComposerModelPicker />
        <ThinkingLevelMenu />
      </div>
      <div className="flex items-center gap-2">
        <ContextMeter />
        <ComposerVoiceButton mode={voiceMode} onToggleVoice={onToggleVoice} />
        <ComposerSendControls
          isLoading={isLoading}
          canSend={canSend}
          sendTitle={sendTitle}
          onSend={onSend}
          onCancel={onCancel}
        />
      </div>
    </div>
  )
}
