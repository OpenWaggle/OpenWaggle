import { safeDecodeUnknown } from '@shared/schema'
import { electronFileSchema } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { LexicalEditor } from 'lexical'
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode } from 'lexical'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useChatStore } from '@/stores/chat-store'
import { useComposerActionStore } from '@/stores/composer-action-store'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { ActionDialog } from './ActionDialog'
import { AutoTextAttachmentChips } from './AutoTextAttachmentChips'
import { ComposerAlerts } from './ComposerAlerts'
import { ComposerStatusBar } from './ComposerStatusBar'
import { ComposerToolbar } from './ComposerToolbar'
import { LexicalComposerEditor } from './LexicalComposerEditor'
import { clearEditor } from './lexical-utils'
import { useAutoTextAttachment } from './useAutoTextAttachment'
import { useVoiceCapture } from './useVoiceCapture'
import { VoiceRecorder } from './VoiceRecorder'

const MAX_ATTACHMENTS = 5

async function prepareAndAttach(
  projectPath: string,
  paths: string[],
  addAttachments: (attachments: Awaited<ReturnType<typeof api.prepareAttachments>>) => void,
  setAttachmentError: (error: string | null) => void,
  onToast: ((message: string) => void) | undefined,
): Promise<void> {
  try {
    setAttachmentError(null)
    const prepared = await api.prepareAttachments(projectPath, paths)
    addAttachments(prepared)
    onToast?.(`Attached ${String(prepared.length)} file${prepared.length === 1 ? '' : 's'}.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to prepare attachments.'
    setAttachmentError(message)
    onToast?.(message)
  }
}

// ── Component ──

interface ComposerProps {
  onSend: (payload: AgentSendPayload) => void
  onEnqueue: (payload: AgentSendPayload) => void
  onCancel: () => void
  isLoading: boolean
  disabled?: boolean
  onToast?: (message: string) => void
}

export function Composer({
  onSend,
  onEnqueue,
  onCancel,
  isLoading,
  disabled,
  onToast,
}: ComposerProps) {
  const input = useComposerStore((s) => s.input)
  const setInput = useComposerStore((s) => s.setInput)
  const attachments = useComposerStore((s) => s.attachments)
  const attachmentError = useComposerStore((s) => s.attachmentError)
  const setAttachmentError = useComposerStore((s) => s.setAttachmentError)
  const addAttachments = useComposerStore((s) => s.addAttachments)
  const removeAttachment = useComposerStore((s) => s.removeAttachment)
  const planModeActive = useChatStore((s) => s.activeConversation?.planModeActive) ?? false
  const branchMessage = useComposerActionStore((s) => s.branchMessage)
  const setBranchMessage = useComposerActionStore((s) => s.setBranchMessage)
  const reset = useComposerStore((s) => s.reset)
  const pushHistory = useComposerStore((s) => s.pushHistory)

  const { projectPath } = useProject()
  const qualityPreset = usePreferencesStore((s) => s.settings.qualityPreset)

  const editorRef = useRef<LexicalEditor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Submission ──

  function clearComposerInput(): void {
    reset()
    if (editorRef.current) {
      clearEditor(editorRef.current)
    }
  }

  function dispatchPayload(payload: AgentSendPayload): boolean {
    if ((!payload.text && payload.attachments.length === 0) || disabled) return false
    if (isLoading) {
      onEnqueue(payload)
    } else {
      onSend(payload)
    }
    return true
  }

  function submitPayload(payload: AgentSendPayload): boolean {
    const sent = dispatchPayload(payload)
    if (!sent) return false
    if (payload.text) pushHistory(payload.text)
    clearComposerInput()
    return true
  }

  function handleSubmit(text?: string): void {
    const trimmedInput = (text ?? input).trim()
    submitPayload({
      text: trimmedInput,
      qualityPreset,
      attachments,
      planModeRequested: planModeActive || undefined,
    })
  }

  function sendComposed(text: string): boolean {
    return submitPayload({
      text,
      qualityPreset,
      attachments: useComposerStore.getState().attachments,
      planModeRequested: useChatStore.getState().activeConversation?.planModeActive || undefined,
    })
  }

  // ── Voice ──

  function insertTextAtCursor(text: string): void {
    const editor = editorRef.current
    if (!editor) {
      // Fallback: append to store input
      const store = useComposerStore.getState()
      store.setInput(store.input + text)
      return
    }
    editor.update(() => {
      const root = $getRoot()
      root.selectEnd()
      const lastChild = root.getLastChild()
      const paragraph = lastChild && $isElementNode(lastChild) ? lastChild : $createParagraphNode()
      if (!lastChild || !$isElementNode(lastChild)) {
        root.append(paragraph)
      }
      paragraph.append($createTextNode(text))
      root.selectEnd()
    })
  }

  const voice = useVoiceCapture({ insertText: insertTextAtCursor, sendComposed })
  const {
    pendingTextAttachmentChips,
    hasPreparingTextAttachment,
    preparingPendingCount,
    checkAndConvertPaste,
    removePendingTextAttachment,
  } = useAutoTextAttachment({
    attachments,
    addAttachments,
    removeAttachment,
    setAttachmentError,
    setInput,
    onToast,
  })
  const canSend =
    (!!input.trim() || attachments.length > 0) && !disabled && !hasPreparingTextAttachment
  const isVoiceModeActive = voice.isActive

  // ── Effects ──

  useEffect(() => {
    if (!isLoading && editorRef.current) {
      editorRef.current.focus()
    }
  }, [isLoading])

  const handleVoiceEnter = useEffectEvent(() => {
    if (voice.mode === 'transcribing') return
    if (voice.mode === 'recording') {
      voice.stopCapture()
      return
    }
    const state = useComposerStore.getState()
    submitPayload({
      text: state.input.trim(),
      qualityPreset,
      attachments: state.attachments,
      planModeRequested: useChatStore.getState().activeConversation?.planModeActive || undefined,
    })
  })

  useEffect(() => {
    if (!isVoiceModeActive) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Enter' || event.shiftKey) return
      event.preventDefault()
      handleVoiceEnter()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isVoiceModeActive])

  // ── Attachments ──

  async function handleAttachFiles(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    const paths = files
      .map((file) => {
        const parsed = safeDecodeUnknown(electronFileSchema, file)
        return parsed.success ? parsed.data.path : undefined
      })
      .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0)
    event.target.value = ''

    if (!projectPath) {
      setAttachmentError('Select a project before attaching files.')
      return
    }
    if (paths.length === 0) return

    const usedAttachmentSlots = attachments.length + preparingPendingCount
    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - usedAttachmentSlots)
    if (remainingSlots === 0) {
      setAttachmentError('You can attach up to 5 files per message.')
      return
    }
    if (paths.length > remainingSlots) {
      setAttachmentError(
        `You can add ${String(remainingSlots)} more file${remainingSlots === 1 ? '' : 's'} in this message.`,
      )
      return
    }

    await prepareAndAttach(projectPath, paths, addAttachments, setAttachmentError, onToast)
  }

  // ── Render ──

  return (
    <div className="shrink-0">
      <output aria-live="polite" className="sr-only">
        {isLoading ? 'Agent is working' : ''}
      </output>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleAttachFiles(event)
        }}
      />

      <div
        className={cn(
          'rounded-[var(--radius-panel)] bg-bg-secondary border transition-shadow',
          'border-input-card-border',
          'has-[:focus]:border-accent/50 has-[:focus]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]',
        )}
      >
        <div className="px-4 pt-3">
          <AutoTextAttachmentChips
            pendingTextAttachmentChips={pendingTextAttachmentChips}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            onRemovePendingAttachment={removePendingTextAttachment}
          />
          <ComposerAlerts
            alerts={[
              ...(attachmentError
                ? [
                    {
                      id: 'attachment-error',
                      message: attachmentError,
                      onDismiss: () => setAttachmentError(null),
                    },
                  ]
                : []),
              ...(voice.error
                ? [
                    {
                      id: 'voice-error',
                      message: voice.error,
                      onDismiss: voice.clearError,
                    },
                  ]
                : []),
              ...(branchMessage
                ? [
                    {
                      id: 'branch-message',
                      message: branchMessage,
                      onDismiss: () => setBranchMessage(null),
                    },
                  ]
                : []),
            ]}
          />
        </div>

        <div className="relative min-h-[60px] px-4 py-[14px]">
          <LexicalComposerEditor
            onSubmit={handleSubmit}
            disabled={disabled}
            placeholder={
              isLoading ? 'Add a message to the conversation...' : 'Ask for follow-up changes'
            }
            editorRef={editorRef}
            checkAndConvertPaste={checkAndConvertPaste}
          />
        </div>

        {isVoiceModeActive ? (
          <VoiceRecorder fileInputRef={fileInputRef} voice={voice} />
        ) : (
          <ComposerToolbar
            onSend={() => {
              void handleSubmit()
            }}
            onCancel={onCancel}
            isLoading={isLoading}
            canSend={canSend}
            onToggleVoice={voice.toggleVoice}
            voiceMode={voice.mode}
            fileInputRef={fileInputRef}
          />
        )}

        <ComposerStatusBar onToast={onToast} />
      </div>

      <ActionDialog onToast={onToast} />
    </div>
  )
}
