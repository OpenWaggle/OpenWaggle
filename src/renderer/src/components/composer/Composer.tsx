import type { AgentSendPayload } from '@shared/types/agent'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useComposerStore } from '@/stores/composer-store'
import { useSettingsStore } from '@/stores/settings-store'
import { ActionDialog } from './ActionDialog'
import { ComposerStatusBar } from './ComposerStatusBar'
import { ComposerToolbar } from './ComposerToolbar'
import { useVoiceCapture } from './useVoiceCapture'
import { VoiceRecorder } from './VoiceRecorder'

// ── Slash skill helpers ──

interface SlashMatch {
  readonly query: string
  readonly start: number
  readonly end: number
}

interface SlashSuggestion {
  readonly id: string
  readonly name: string
  readonly description: string
}

function findSlashMatch(input: string, cursor: number): SlashMatch | null {
  const safeCursor = Math.max(0, Math.min(cursor, input.length))
  const beforeCursor = input.slice(0, safeCursor)
  const match = /(?:^|\s)\/([a-z0-9-_]*)$/i.exec(beforeCursor)
  if (!match) return null
  const query = (match[1] ?? '').toLowerCase()
  const start = safeCursor - query.length - 1
  if (start < 0) return null
  return { query, start, end: safeCursor }
}

// ── Component ──

interface ComposerProps {
  onSend: (payload: AgentSendPayload) => void
  onCancel: () => void
  isLoading: boolean
  disabled?: boolean
  slashSkills: readonly SkillDiscoveryItem[]
  onToast?: (message: string) => void
}

export function Composer({
  onSend,
  onCancel,
  isLoading,
  disabled,
  slashSkills,
  onToast,
}: ComposerProps): React.JSX.Element {
  const input = useComposerStore((s) => s.input)
  const setInput = useComposerStore((s) => s.setInput)
  const cursorIndex = useComposerStore((s) => s.cursorIndex)
  const setCursorIndex = useComposerStore((s) => s.setCursorIndex)
  const attachments = useComposerStore((s) => s.attachments)
  const attachmentError = useComposerStore((s) => s.attachmentError)
  const setAttachmentError = useComposerStore((s) => s.setAttachmentError)
  const addAttachments = useComposerStore((s) => s.addAttachments)
  const removeAttachment = useComposerStore((s) => s.removeAttachment)
  const voiceError = useComposerStore((s) => s.voiceError)
  const branchMessage = useComposerStore((s) => s.branchMessage)
  const isListening = useComposerStore((s) => s.isListening)
  const isTranscribingVoice = useComposerStore((s) => s.isTranscribingVoice)
  const slashHighlightIndex = useComposerStore((s) => s.slashHighlightIndex)
  const setSlashHighlightIndex = useComposerStore((s) => s.setSlashHighlightIndex)
  const dismissedSlashToken = useComposerStore((s) => s.dismissedSlashToken)
  const setDismissedSlashToken = useComposerStore((s) => s.setDismissedSlashToken)
  const reset = useComposerStore((s) => s.reset)

  const { projectPath } = useProject()
  const qualityPreset = useSettingsStore((s) => s.settings.qualityPreset)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSend = (!!input.trim() || attachments.length > 0) && !disabled
  const isVoiceModeActive = isListening || isTranscribingVoice

  // ── Slash skill derivation ──

  const slashMatch = findSlashMatch(input, cursorIndex)
  const slashToken = slashMatch ? `${String(slashMatch.start)}:${slashMatch.query}` : null
  const slashSuggestions: SlashSuggestion[] = slashMatch
    ? slashSkills
        .filter((s) => s.enabled)
        .filter((s) => s.loadStatus === 'ok')
        .filter(
          (s) => s.id.includes(slashMatch.query) || s.name.toLowerCase().includes(slashMatch.query),
        )
        .slice(0, 8)
        .map((s) => ({ id: s.id, name: s.name, description: s.description }))
    : []
  const slashMenuOpen =
    !isVoiceModeActive &&
    !!slashMatch &&
    slashSuggestions.length > 0 &&
    dismissedSlashToken !== slashToken

  // ── Submission ──

  function submitPayload(payload: AgentSendPayload): boolean {
    if ((!payload.text && payload.attachments.length === 0) || isLoading || disabled) return false
    onSend(payload)
    reset()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    return true
  }

  function handleSubmit(): void {
    submitPayload({ text: input.trim(), qualityPreset, attachments })
  }

  function sendComposed(text: string): boolean {
    return submitPayload({
      text,
      qualityPreset,
      attachments: useComposerStore.getState().attachments,
    })
  }

  // ── Voice ──

  const voice = useVoiceCapture({ textareaRef, sendComposed })

  // ── Effects ──

  useEffect(() => {
    if (!isLoading && textareaRef.current) textareaRef.current.focus()
  }, [isLoading])

  useEffect(() => {
    if (!slashMenuOpen) {
      setSlashHighlightIndex(0)
      return
    }
    if (slashHighlightIndex >= slashSuggestions.length) setSlashHighlightIndex(0)
  }, [slashHighlightIndex, slashMenuOpen, slashSuggestions.length, setSlashHighlightIndex])

  // Voice mode Enter key handler
  const voiceSendRef = useRef(voice.sendVoice)
  voiceSendRef.current = voice.sendVoice
  const submitPayloadRef = useRef(submitPayload)
  submitPayloadRef.current = submitPayload
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
      const { input: currentInput, attachments: currentAttachments } = useComposerStore.getState()
      submitPayloadRef.current({
        text: currentInput.trim(),
        qualityPreset,
        attachments: currentAttachments,
      })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isVoiceModeActive, isListening, isTranscribingVoice, qualityPreset])

  // ── Slash selection ──

  function handleSlashSelection(skillId: string): void {
    if (!slashMatch) return
    const before = input.slice(0, slashMatch.start)
    const after = input.slice(slashMatch.end)
    const replacement = `/${skillId}`
    const needsTrailingSpace = after.length > 0 && !after.startsWith(' ')
    const next = `${before}${replacement}${needsTrailingSpace ? ' ' : ''}${after}`
    const nextCursor = slashMatch.start + replacement.length + (needsTrailingSpace ? 1 : 0)

    setInput(next)
    setCursorIndex(nextCursor)
    setDismissedSlashToken(null)

    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCursor, nextCursor)
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    })
  }

  // ── Input handlers ──

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (slashMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashHighlightIndex((slashHighlightIndex + 1) % slashSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashHighlightIndex(
          slashHighlightIndex === 0 ? slashSuggestions.length - 1 : slashHighlightIndex - 1,
        )
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissedSlashToken(slashToken)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && slashSuggestions[slashHighlightIndex]) {
        e.preventDefault()
        handleSlashSelection(slashSuggestions[slashHighlightIndex].id)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setInput(e.target.value)
    setCursorIndex(e.target.selectionStart ?? e.target.value.length)
    setDismissedSlashToken(null)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  function syncCursorPosition(event: React.SyntheticEvent<HTMLTextAreaElement>): void {
    setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
  }

  // ── Attachments ──

  async function handleAttachFiles(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    const paths = files
      .map((file) => (file as File & { path?: string }).path)
      .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0)
    event.target.value = ''

    if (!projectPath) {
      setAttachmentError('Select a project before attaching files.')
      return
    }
    if (paths.length === 0) return

    const remainingSlots = Math.max(0, 5 - attachments.length)
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
          <div className="relative h-[60px] px-4 py-[14px]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onClick={syncCursorPosition}
              onKeyUp={syncCursorPosition}
              onSelect={syncCursorPosition}
              aria-label="Message input"
              placeholder={isLoading ? 'Agent is working...' : 'Ask for follow-up changes'}
              disabled={isLoading || disabled}
              rows={1}
              className={cn(
                'w-full h-full resize-none bg-transparent text-[15px] text-text-primary',
                'placeholder:text-text-tertiary',
                'focus:outline-none focus-visible:shadow-none',
                'disabled:opacity-50',
              )}
            />
            {slashMenuOpen && (
              <div className="absolute inset-x-4 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border-light bg-bg-secondary py-1 shadow-lg">
                {slashSuggestions.map((skill, index) => (
                  <button
                    key={skill.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      handleSlashSelection(skill.id)
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                      index === slashHighlightIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover/80',
                    )}
                  >
                    <span className="mt-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-tertiary">
                      /{skill.id}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-text-primary">
                        {skill.name}
                      </span>
                      <span className="block truncate text-[11px] text-text-tertiary">
                        {skill.description || 'No description'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
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
