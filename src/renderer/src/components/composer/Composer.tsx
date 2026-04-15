import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { LexicalEditor } from 'lexical'
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode } from 'lexical'
import { ArrowDownToLine, Ban } from 'lucide-react'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useChatStore } from '@/stores/chat-store'
import { useComposerActionStore } from '@/stores/composer-action-store'
import { useComposerStore } from '@/stores/composer-store'
import { useContextStore } from '@/stores/context-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { ActionDialog } from './ActionDialog'
import { AutoTextAttachmentChips } from './AutoTextAttachmentChips'
import { ComposerAlerts } from './ComposerAlerts'
import { ComposerStatusBar } from './ComposerStatusBar'
import { ComposerToolbar } from './ComposerToolbar'
import { LexicalComposerEditor } from './LexicalComposerEditor'
import { clearEditor } from './lexical-utils'
import { useAutoTextAttachment } from './useAutoTextAttachment'
import { useFileAttachment } from './useFileAttachment'
import { useVoiceCapture } from './useVoiceCapture'
import { VoiceRecorder } from './VoiceRecorder'

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
  const activeConversationId = useChatStore((s) => s.activeConversationId)
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
    // Read compacting state at dispatch time — no reactive subscription needed
    const isCompacting = useContextStore.getState().isCompacting
    if (isLoading || isCompacting) {
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

    // Intercept /compact command — execute as control action, not chat message.
    // Regex ensures "/compacting..." doesn't accidentally trigger compaction.
    if (/^\/compact(\s|$)/.test(trimmedInput) && activeConversationId) {
      const guidance = trimmedInput.replace(/^\/compact\s*/, '').trim() || undefined
      const shouldSave = useComposerStore.getState().compactSaveForThread && guidance
      clearComposerInput()
      useComposerStore.getState().setCompactSaveForThread(false)
      if (shouldSave) {
        api
          .updateCompactionGuidance(activeConversationId, guidance)
          .catch(() => onToast?.('Failed to save compaction guidance'))
      }
      void executeCompaction(activeConversationId, guidance)
      return
    }

    submitPayload({
      text: trimmedInput,
      qualityPreset,
      attachments,
      planModeRequested: planModeActive || undefined,
    })
  }

  async function executeCompaction(
    conversationId: ConversationId,
    guidance: string | undefined,
  ): Promise<void> {
    const { setCompacting } = useContextStore.getState()
    setCompacting(true)
    try {
      await api.requestCompaction(conversationId, guidance)
    } finally {
      setCompacting(false)
    }
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

  // ── File attachments (file picker + drag-and-drop) ──

  const {
    isDragOver,
    isAtCapacity,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleAttachFiles,
  } = useFileAttachment({
    projectPath,
    attachments,
    preparingPendingCount,
    addAttachments,
    setAttachmentError,
    onToast,
  })

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

      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop target for file attachments */}
      <div
        className={cn(
          'relative rounded-[var(--radius-panel)] bg-bg-secondary border transition-all',
          'border-input-card-border',
          'has-[:focus]:border-accent/50 has-[:focus]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]',
          isDragOver && !isAtCapacity && 'border-accent ring-2 ring-accent/30',
          isDragOver && isAtCapacity && 'border-red-400/60 ring-2 ring-red-400/20',
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={(event) => {
          void handleDrop(event)
        }}
      >
        {/* Drop zone overlay */}
        {isDragOver && (
          <div
            className={cn(
              'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-panel)] backdrop-blur-[1px]',
              isAtCapacity ? 'bg-red-400/5' : 'bg-accent/8',
            )}
          >
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg bg-bg-secondary/90 px-4 py-2 shadow-sm border',
                isAtCapacity ? 'border-red-400/30' : 'border-accent/30',
              )}
            >
              {isAtCapacity ? (
                <>
                  <Ban className="h-4 w-4 text-red-400" />
                  <span className="text-[13px] font-medium text-red-400">
                    Maximum files attached
                  </span>
                </>
              ) : (
                <>
                  <ArrowDownToLine className="h-4 w-4 text-accent" />
                  <span className="text-[13px] font-medium text-accent">Drop files to attach</span>
                </>
              )}
            </div>
          </div>
        )}
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
