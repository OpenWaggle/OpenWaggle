import type { AgentSendPayload } from '@shared/types/agent'
import type { LexicalEditor } from 'lexical'
import { useEffect, useRef } from 'react'
import { useProject } from '@/features/sessions/hooks'
import { useComposerAttachments, useComposerSubmission, useComposerVoiceControls } from '../hooks'
import { ComposerDropZone } from './ComposerDropZone'
import { ComposerEditorArea } from './ComposerEditorArea'
import { ComposerHeader } from './ComposerHeader'
import { ComposerHiddenFileInput } from './ComposerHiddenFileInput'
import { ComposerModeControls } from './ComposerModeControls'

interface ComposerProps {
  onSend: (payload: AgentSendPayload) => Promise<void> | void
  onEnqueue: (payload: AgentSendPayload) => Promise<void> | void
  onCancel: () => void
  isLoading: boolean
  mode?: {
    readonly disabled?: boolean
    readonly placeholder?: string
    readonly sendTitle?: string
    readonly requiresText?: boolean
    readonly clearOnSubmit?: boolean
    readonly recordHistory?: boolean
    readonly allowEnqueue?: boolean
  }
  onToast?: (message: string) => void
}

export function Composer({ onSend, onEnqueue, onCancel, isLoading, mode, onToast }: ComposerProps) {
  const disabled = mode?.disabled
  const placeholder = mode?.placeholder
  const sendTitle = mode?.sendTitle
  const requiresText = mode?.requiresText ?? false
  const clearOnSubmit = mode?.clearOnSubmit ?? true
  const recordHistory = mode?.recordHistory ?? true
  const allowEnqueue = mode?.allowEnqueue ?? true
  const editorRef = useRef<LexicalEditor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { projectPath } = useProject()
  const attachments = useComposerAttachments({ projectPath, onToast })
  const submission = useComposerSubmission({
    onSend,
    onEnqueue,
    isLoading,
    disabled,
    requiresText,
    clearOnSubmit,
    recordHistory,
    allowEnqueue,
    onToast,
    editorRef,
    projectPath,
    attachments: attachments.attachments,
    hasPreparingTextAttachment: attachments.hasPreparingTextAttachment,
  })
  const voice = useComposerVoiceControls({
    editorRef,
    sendComposed: submission.sendComposed,
    submitCurrentDraft: submission.submitCurrentDraft,
  })

  useEffect(() => {
    if (!isLoading) editorRef.current?.focus()
  }, [isLoading])

  return (
    <div className="shrink-0">
      <output aria-live="polite" className="sr-only">
        {isLoading ? 'Agent is working' : ''}
      </output>
      <ComposerHiddenFileInput
        fileInputRef={fileInputRef}
        handleAttachFiles={attachments.fileAttachment.handleAttachFiles}
      />
      <ComposerDropZone fileAttachment={attachments.fileAttachment}>
        <ComposerHeader
          attachments={attachments}
          voiceError={voice.error}
          onClearVoiceError={voice.clearError}
        />
        <ComposerEditorArea
          onSubmit={submission.handleSubmit}
          disabled={disabled}
          placeholder={placeholder}
          isLoading={isLoading}
          editorRef={editorRef}
          checkAndConvertPaste={attachments.checkAndConvertPaste}
        />
        <ComposerModeControls
          fileInputRef={fileInputRef}
          voice={voice}
          onSubmit={() => {
            submission.handleSubmit()
          }}
          onCancel={onCancel}
          isLoading={isLoading}
          canSend={submission.canSend}
          sendTitle={sendTitle}
        />
      </ComposerDropZone>
    </div>
  )
}
