import { DOUBLE_FACTOR } from '@shared/constants/constants'
import { safeDecodeUnknown } from '@shared/schema'
import { electronFileSchema } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useUIStore } from '@/stores/ui-store'
import { ActionDialog } from './ActionDialog'
import { AutoTextAttachmentChips } from './AutoTextAttachmentChips'
import { ComposerAlerts } from './ComposerAlerts'
import { ComposerStatusBar } from './ComposerStatusBar'
import { ComposerToolbar } from './ComposerToolbar'
import { resetComposerTextareaHeight, resizeComposerTextarea } from './composer-textarea'
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
}: ComposerProps): React.JSX.Element {
  const input = useComposerStore((s) => s.input)
  const setInput = useComposerStore((s) => s.setInput)
  const setCursorIndex = useComposerStore((s) => s.setCursorIndex)
  const attachments = useComposerStore((s) => s.attachments)
  const attachmentError = useComposerStore((s) => s.attachmentError)
  const setAttachmentError = useComposerStore((s) => s.setAttachmentError)
  const addAttachments = useComposerStore((s) => s.addAttachments)
  const removeAttachment = useComposerStore((s) => s.removeAttachment)
  const planModeActive = useComposerStore((s) => s.planModeActive)
  const branchMessage = useComposerStore((s) => s.branchMessage)
  const setBranchMessage = useComposerStore((s) => s.setBranchMessage)
  const reset = useComposerStore((s) => s.reset)
  const pushHistory = useComposerStore((s) => s.pushHistory)
  const historyUp = useComposerStore((s) => s.historyUp)
  const historyDown = useComposerStore((s) => s.historyDown)

  const openCommandPalette = useUIStore((s) => s.openCommandPalette)

  const { projectPath } = useProject()
  const qualityPreset = usePreferencesStore((s) => s.settings.qualityPreset)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Submission ──

  function clearComposerInput(): void {
    reset()
    resetComposerTextareaHeight(textareaRef.current)
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

  function handleSubmit(): void {
    const trimmedInput = input.trim()
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
      planModeRequested: useComposerStore.getState().planModeActive || undefined,
    })
  }

  // ── Voice ──

  const voice = useVoiceCapture({ textareaRef, sendComposed })
  const {
    pendingTextAttachmentChips,
    hasPreparingTextAttachment,
    preparingPendingCount,
    handlePaste,
    removePendingTextAttachment,
  } = useAutoTextAttachment({
    attachments,
    addAttachments,
    removeAttachment,
    setAttachmentError,
    setInput,
    setCursorIndex,
    textareaRef,
    resizeTextarea,
    onToast,
  })
  const canSend =
    (!!input.trim() || attachments.length > 0) && !disabled && !hasPreparingTextAttachment
  const isVoiceModeActive = voice.isActive

  // ── Effects ──

  useEffect(() => {
    if (!isLoading && textareaRef.current) textareaRef.current.focus()
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
      planModeRequested: state.planModeActive || undefined,
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

  // ── Input handlers ──

  function resizeTextarea(): void {
    resizeComposerTextarea(textareaRef.current)
  }

  function applyHistoryEntry(text: string): void {
    setInput(text)
    // Defer cursor + resize until React flushes the new value to the DOM
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.selectionStart = text.length
      el.selectionEnd = text.length
      resizeTextarea()
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
      return
    }

    const textarea = e.currentTarget
    const hasSelection = textarea.selectionStart !== textarea.selectionEnd

    // ArrowUp at the very start of input → recall previous prompt
    if (e.key === 'ArrowUp' && !hasSelection && textarea.selectionStart === 0) {
      const prev = historyUp(input)
      if (prev !== null) {
        e.preventDefault()
        applyHistoryEntry(prev)
      }
      return
    }

    // ArrowDown at the very end of input → recall next prompt (or draft)
    if (e.key === 'ArrowDown' && !hasSelection && textarea.selectionStart === input.length) {
      const next = historyDown()
      if (next !== null) {
        e.preventDefault()
        applyHistoryEntry(next)
      }
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const value = e.target.value
    setInput(value)
    setCursorIndex(e.target.selectionStart ?? value.length)

    // Open command palette when user types "/" at start or after whitespace
    if (value === '/' || (value.endsWith('/') && value[value.length - DOUBLE_FACTOR] === ' ')) {
      openCommandPalette()
    }

    resizeTextarea()
  }

  function syncCursorPosition(event: React.SyntheticEvent<HTMLTextAreaElement>): void {
    setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
  }

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

        <div className="min-h-[60px] px-4 py-[14px]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            onClick={syncCursorPosition}
            onKeyUp={syncCursorPosition}
            onSelect={syncCursorPosition}
            aria-label="Message input"
            placeholder={
              isLoading ? 'Add a message to the conversation...' : 'Ask for follow-up changes'
            }
            disabled={disabled}
            rows={1}
            className={cn(
              'w-full resize-none bg-transparent text-[15px] text-text-primary',
              'placeholder:text-text-tertiary',
              'focus:outline-none focus-visible:shadow-none',
              'disabled:opacity-50',
            )}
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
