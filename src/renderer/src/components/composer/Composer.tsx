import { DOUBLE_FACTOR } from '@shared/constants/constants'
import { electronFileSchema } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useUIStore } from '@/stores/ui-store'
import { ActionDialog } from './ActionDialog'
import { ComposerStatusBar } from './ComposerStatusBar'
import { ComposerToolbar } from './ComposerToolbar'
import { useVoiceCapture } from './useVoiceCapture'
import { VoiceRecorder } from './VoiceRecorder'

const HANDLE_ATTACH_FILES_VALUE_5 = 5

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

/** Max textarea auto-grow height in pixels (scrolls beyond this). */
const TEXTAREA_MAX_HEIGHT = 300

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
  const voiceError = useComposerStore((s) => s.voiceError)
  const branchMessage = useComposerStore((s) => s.branchMessage)
  const isListening = useComposerStore((s) => s.isListening)
  const isTranscribingVoice = useComposerStore((s) => s.isTranscribingVoice)
  const reset = useComposerStore((s) => s.reset)
  const pushHistory = useComposerStore((s) => s.pushHistory)
  const historyUp = useComposerStore((s) => s.historyUp)
  const historyDown = useComposerStore((s) => s.historyDown)

  const openCommandPalette = useUIStore((s) => s.openCommandPalette)

  const { projectPath } = useProject()
  const qualityPreset = usePreferencesStore((s) => s.settings.qualityPreset)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSend = (!!input.trim() || attachments.length > 0) && !disabled
  const isVoiceModeActive = isListening || isTranscribingVoice

  // ── Submission ──

  function submitPayload(payload: AgentSendPayload): boolean {
    if ((!payload.text && payload.attachments.length === 0) || disabled) return false
    if (payload.text) pushHistory(payload.text)
    if (isLoading) {
      onEnqueue(payload)
    } else {
      onSend(payload)
    }
    reset()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    return true
  }

  function handleSubmit(): void {
    submitPayload({
      text: input.trim(),
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

  // ── Effects ──

  useEffect(() => {
    if (!isLoading && textareaRef.current) textareaRef.current.focus()
  }, [isLoading])

  // Voice mode Enter key handler
  const voiceSendRef = useRef(voice.sendVoice)
  const submitPayloadRef = useRef(submitPayload)
  useEffect(() => {
    voiceSendRef.current = voice.sendVoice
    submitPayloadRef.current = submitPayload
  })
  useEffect(() => {
    if (!isVoiceModeActive) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Enter' || event.shiftKey) return
      event.preventDefault()
      if (isTranscribingVoice) return
      if (isListening) {
        voiceSendRef.current()
        return
      }
      const state = useComposerStore.getState()
      submitPayloadRef.current({
        text: state.input.trim(),
        qualityPreset,
        attachments: state.attachments,
        planModeRequested: state.planModeActive || undefined,
      })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isVoiceModeActive, isListening, isTranscribingVoice, qualityPreset])

  // ── Input handlers ──

  function resizeTextarea(): void {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
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
      handleSubmit()
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
        const parsed = electronFileSchema.safeParse(file)
        return parsed.success ? parsed.data.path : undefined
      })
      .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0)
    event.target.value = ''

    if (!projectPath) {
      setAttachmentError('Select a project before attaching files.')
      return
    }
    if (paths.length === 0) return

    const remainingSlots = Math.max(0, HANDLE_ATTACH_FILES_VALUE_5 - attachments.length)
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
          'rounded-xl bg-bg-secondary border transition-shadow',
          'border-input-card-border',
          'has-[:focus]:border-accent/50 has-[:focus]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]',
        )}
      >
        <div className="px-4 pt-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text-secondary"
                >
                  <span className="max-w-[190px] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="text-text-tertiary transition-colors hover:text-text-primary"
                    title={`Remove ${attachment.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {(() => {
            const errors = [attachmentError, voiceError, branchMessage].filter(
              (msg): msg is string => Boolean(msg),
            )
            if (errors.length === 0) return null
            return (
              <div className="mb-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary">
                {errors.map((message) => (
                  <div key={message}>{message}</div>
                ))}
              </div>
            )
          })()}
        </div>

        {isVoiceModeActive ? (
          <VoiceRecorder onSendVoice={voice.sendVoice} mediaRecorderRef={voice.mediaRecorderRef} />
        ) : (
          <div className="min-h-[60px] px-4 py-[14px]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
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
        )}

        {!isVoiceModeActive && (
          <ComposerToolbar
            onSend={handleSubmit}
            onCancel={onCancel}
            isLoading={isLoading}
            canSend={canSend}
            onToggleVoice={voice.toggleVoice}
            fileInputRef={fileInputRef}
          />
        )}

        <ComposerStatusBar onToast={onToast} />
      </div>

      <ActionDialog onToast={onToast} />
    </div>
  )
}
