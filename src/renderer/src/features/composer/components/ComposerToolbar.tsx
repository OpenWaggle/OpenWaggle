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
    <div
      data-testid="composer-toolbar"
      className="@container/composer-toolbar flex h-11 flex-nowrap items-center gap-2 px-4 py-2 @max-xl/composer-toolbar:px-3"
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <ComposerAttachButton fileInputRef={fileInputRef} />
        {accessControl}
      </div>
      <div
        data-testid="composer-toolbar-actions"
        className="ml-auto flex min-w-0 items-center gap-2 @max-xl/composer-toolbar:gap-1.5"
      >
        <ComposerModelPicker />
        <ThinkingLevelMenu />
        <ContextMeter />
      </div>
      <div
        className="flex shrink-0 flex-nowrap items-center gap-2 @max-xl/composer-toolbar:gap-1.5"
        data-testid="composer-toolbar-primary-actions"
      >
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
