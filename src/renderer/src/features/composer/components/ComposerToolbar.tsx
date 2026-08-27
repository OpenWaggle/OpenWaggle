import type { ReactNode, RefObject } from 'react'
import { ComposerAttachButton } from './ComposerAttachButton'
import { ComposerModelPicker } from './ComposerModelPicker'
import { ComposerSendControls } from './ComposerSendControls'
import { ComposerVoiceButton } from './ComposerVoiceButton'
import { ContextMeter } from './ContextMeter'
import { ThinkingLevelMenu } from './ThinkingLevelMenu'

interface ComposerToolbarProps {
  readonly accessControl?: ReactNode
  readonly submission: {
    readonly onSend: () => void
    readonly onCancel: () => void
    readonly isLoading: boolean
    readonly canSend: boolean
    readonly sendTitle?: string
  }
  readonly onToggleVoice: () => void
  readonly voiceMode: 'idle' | 'recording' | 'transcribing'
  readonly fileInputRef: RefObject<HTMLInputElement | null>
}

export function ComposerToolbar({
  accessControl,
  submission,
  onToggleVoice,
  voiceMode,
  fileInputRef,
}: ComposerToolbarProps) {
  return (
    <div className="flex h-11 items-center justify-between px-4">
      <div className="flex items-center gap-1.5">
        <ComposerAttachButton fileInputRef={fileInputRef} />
        {accessControl}
      </div>
      <div className="flex items-center gap-2">
        <ComposerModelPicker />
        <ThinkingLevelMenu />
        <ContextMeter />
        <ComposerVoiceButton mode={voiceMode} onToggleVoice={onToggleVoice} />
        <ComposerSendControls
          isLoading={submission.isLoading}
          canSend={submission.canSend}
          sendTitle={submission.sendTitle}
          onSend={submission.onSend}
          onCancel={submission.onCancel}
        />
      </div>
    </div>
  )
}
