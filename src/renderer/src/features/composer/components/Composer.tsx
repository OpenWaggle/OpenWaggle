import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { LexicalEditor } from 'lexical'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useProject } from '@/features/sessions/hooks'
import { useComposerAttachments } from '../hooks/useComposerAttachments'
import { useComposerQueuedEditMode } from '../hooks/useComposerQueuedEditMode'
import type { SendFailureDisposition } from '../hooks/useComposerSubmission'
import { useComposerSubmission } from '../hooks/useComposerSubmission'
import { useComposerVoiceControls } from '../hooks/useComposerVoiceControls'
import { useSessionScopedFilePicker } from '../hooks/useSessionScopedFilePicker'
import type { QueuedMessageEdit } from '../state/queued-message-edit-store'
import { ComposerDropZone } from './ComposerDropZone'
import { ComposerEditorArea } from './ComposerEditorArea'
import { ComposerHeader } from './ComposerHeader'
import { ComposerHiddenFileInput } from './ComposerHiddenFileInput'
import { ComposerModeControls } from './ComposerModeControls'
import { QueuedMessageEditBar, QueuedMessageEditElsewhereNote } from './QueuedMessageEditBar'

interface ComposerProps {
  readonly sessionId?: string | null
  readonly accessControl?: ReactNode
  onSend: (payload: AgentSendPayload) => Promise<void> | void | false
  onEnqueue: (payload: AgentSendPayload) => Promise<boolean | undefined> | boolean | undefined
  onCancel: () => void
  isLoading: boolean
  /** The agent ended the Run and the Host is settling it: no Stop, and a message is queued. */
  isFinishing?: boolean
  mode?: {
    readonly disabled?: boolean
    readonly placeholder?: string
    readonly sendTitle?: string
    readonly requiresText?: boolean
    readonly clearOnSubmit?: boolean
    readonly recordHistory?: boolean
    readonly allowEnqueue?: boolean
    readonly onSendFailure?: (cause: unknown) => SendFailureDisposition
    /**
     * The Session whose queued messages this composer can edit. While one of them is being
     * edited, the composer is in edit mode: it shows the edit bar, and Enter saves the edit.
     */
    readonly queuedMessagesSessionId?: SessionId | null
  }
  onToast?: (message: string) => void
}

function noToast() {}

/** The composer's mode with its defaults. */
function resolveComposerMode(mode: ComposerProps['mode']) {
  return {
    disabled: mode?.disabled,
    placeholder: mode?.placeholder,
    sendTitle: mode?.sendTitle,
    requiresText: mode?.requiresText ?? false,
    clearOnSubmit: mode?.clearOnSubmit ?? true,
    recordHistory: mode?.recordHistory ?? true,
    allowEnqueue: mode?.allowEnqueue ?? true,
    onSendFailure: mode?.onSendFailure,
  }
}

/** Editing a queued message: the input says so, and the primary action saves. */
function withQueuedEditMode(
  resolved: ReturnType<typeof resolveComposerMode>,
  edit: QueuedMessageEdit | null,
) {
  if (!edit) return resolved
  return {
    ...resolved,
    // Opening, saving, or cancelling is in flight: hold the draft still until the Host answers.
    disabled: resolved.disabled || edit.phase !== 'editing',
    placeholder: 'Edit the queued message',
    sendTitle: 'Save edit',
  }
}

function runAnnouncement(isLoading: boolean, isFinishing: boolean) {
  if (isFinishing) return 'Agent is finishing'
  return isLoading ? 'Agent is working' : ''
}

export function Composer({
  sessionId = null,
  accessControl,
  onSend,
  onEnqueue,
  onCancel,
  isLoading,
  isFinishing = false,
  mode,
  onToast,
}: ComposerProps) {
  const queuedEdit = useComposerQueuedEditMode(
    mode?.queuedMessagesSessionId ?? null,
    onToast ?? noToast,
  )
  const editHere = queuedEdit.here
  const {
    disabled,
    placeholder,
    sendTitle,
    requiresText,
    clearOnSubmit,
    recordHistory,
    allowEnqueue,
    onSendFailure,
  } = withQueuedEditMode(resolveComposerMode(mode), editHere)
  const editorRef = useRef<LexicalEditor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useSessionScopedFilePicker(sessionId, fileInputRef)
  const { projectPath } = useProject()
  const attachments = useComposerAttachments({ projectPath, onToast, disabled })
  const submission = useComposerSubmission({
    onSend,
    onEnqueue,
    onSendFailure,
    isLoading,
    disabled,
    requiresText,
    clearOnSubmit,
    recordHistory,
    allowEnqueue,
    enqueueWaggle: queuedEdit.waitingOnEdit,
    onToast,
    editorRef,
    projectPath,
    attachments: attachments.attachments,
    hasPreparingTextAttachment: attachments.hasPreparingTextAttachment,
  })
  // While a queued message is being edited here (including while it opens), nothing is sent.
  function submit() {
    if (!editHere) {
      submission.handleSubmit()
      return
    }
    if (!disabled) queuedEdit.save()
  }
  const voice = useComposerVoiceControls({
    disabled,
    editorRef,
    sendComposed: submission.sendComposed,
    submitCurrentDraft: editHere ? submit : submission.submitCurrentDraft,
    sendAfterInsert: editHere ? submit : null,
  })

  useEffect(() => {
    const activeElement = document.activeElement
    if (!isLoading && (activeElement === null || activeElement === document.body)) {
      editorRef.current?.focus()
    }
  }, [isLoading])

  return (
    <div className="shrink-0">
      <output aria-live="polite" className="sr-only">
        {runAnnouncement(isLoading, isFinishing)}
      </output>
      <ComposerHiddenFileInput
        fileInputRef={fileInputRef}
        handleAttachFiles={attachments.fileAttachment.handleAttachFiles}
      />
      <ComposerDropZone
        disabled={disabled}
        editorRef={editorRef}
        fileAttachment={attachments.fileAttachment}
      >
        {editHere ? <QueuedMessageEditBar edit={editHere} onCancel={queuedEdit.cancel} /> : null}
        {queuedEdit.elsewhere ? (
          <QueuedMessageEditElsewhereNote onCancel={queuedEdit.cancel} />
        ) : null}
        <ComposerHeader
          attachments={attachments}
          voiceError={voice.error}
          onClearVoiceError={voice.clearError}
        />
        <ComposerEditorArea
          onSubmit={submit}
          onEscape={editHere ? queuedEdit.cancel : undefined}
          disabled={disabled}
          placeholder={placeholder}
          isLoading={isLoading}
          editorRef={editorRef}
          checkAndConvertPaste={attachments.checkAndConvertPaste}
        />
        <ComposerModeControls
          disabled={disabled}
          accessControl={accessControl}
          fileInputRef={fileInputRef}
          voice={voice}
          submission={{
            onSend: submit,
            onCancel,
            isLoading,
            isFinishing,
            canSend: editHere ? queuedEdit.canSave : submission.canSend,
            sendTitle,
            savesEdit: editHere !== null,
          }}
        />
      </ComposerDropZone>
    </div>
  )
}
