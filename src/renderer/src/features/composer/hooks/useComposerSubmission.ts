import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type { WagglePreset } from '@shared/types/waggle'
import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { useSelectedModelThinkingLevel } from '@/features/providers/hooks'
import { GUI_COMMAND_REQUIRES_IDLE_MESSAGE, isGuiOnlyComposerCommand } from '../commands'
import { clearEditor, setEditorDraft } from '../lib/lexical-utils'
import { consumeSendResult } from '../lib/send-result'
import {
  discardSessionResourceAttachments,
  markSessionResourceAttachmentsSubmitted,
  unmarkSessionResourceAttachmentsSubmitted,
} from '../state/composer-attachment-lifecycle'
import { useComposerStore } from '../state/composer-store'
import {
  attachmentLimitMessage,
  attachmentLimitReason,
  type ComposerDraftSnapshot,
  callAsPromise,
  canSend,
  captureCurrentComposerDraft,
  clearInactiveComposerDraft,
  getSubmitBlock,
  isCurrentComposerDraft,
  queuedSubmissionKey,
} from './composer-submission-support'
import { useComposerModel } from './useComposerModel'

const pendingQueuedSubmissions = new Map<string, Promise<boolean>>()

interface UseComposerSubmissionInput {
  readonly onSend: (payload: AgentSendPayload) => Promise<void> | void | false
  readonly onEnqueue: (
    payload: AgentSendPayload,
  ) => Promise<boolean | undefined> | boolean | undefined
  readonly onSendFailure?: (cause: unknown) => SendFailureDisposition
  readonly isLoading: boolean
  readonly disabled?: boolean
  readonly requiresText: boolean
  readonly clearOnSubmit: boolean
  readonly recordHistory: boolean
  readonly allowEnqueue: boolean
  readonly onToast?: (message: string) => void
  readonly editorRef: RefObject<LexicalEditor | null>
  readonly projectPath: string | null
  readonly attachments: readonly PreparedAttachment[]
  readonly hasPreparingTextAttachment: boolean
}

export type SendFailureDisposition =
  | { readonly kind: 'restore'; readonly contextKey?: string | null }
  | { readonly kind: 'discard' | 'retain' }

type DispatchResult =
  | { readonly type: 'blocked' }
  | { readonly type: 'sent'; readonly completion?: Promise<void> }
  | { readonly type: 'queued'; readonly completion: Promise<boolean | undefined> }

function mergeDraftText(submitted: string, current: string) {
  if (!submitted || submitted === current) return current
  return current ? `${submitted}\n\n${current}` : submitted
}

function mergeDraftAttachments(
  submitted: readonly PreparedAttachment[],
  current: readonly PreparedAttachment[],
) {
  return [
    ...new Map(
      [...submitted, ...current].map((attachment) => [attachment.id, attachment]),
    ).values(),
  ]
}

function restoreFailedSendDraft(
  payload: AgentSendPayload,
  contextKey: string | null,
  submittedPreset: WagglePreset | null,
  editor: LexicalEditor | null,
) {
  const state = useComposerStore.getState()
  if (state.activeDraftContextKey === contextKey) {
    const input = mergeDraftText(payload.text, state.input)
    const preset = state.selectedWagglePreset ?? submittedPreset
    const attachments = mergeDraftAttachments(payload.attachments, state.attachments)
    state.setInput(input)
    state.replaceAttachments(attachments)
    state.setSelectedWagglePreset(preset)
    if (editor) setEditorDraft(editor, input, preset)
    return attachmentLimitReason(attachments)
  }
  if (!contextKey) return null
  const current = state.getScopedDraft(contextKey)
  const attachments = mergeDraftAttachments(payload.attachments, current?.attachments ?? [])
  state.saveScopedDraft(contextKey, {
    input: mergeDraftText(payload.text, current?.input ?? ''),
    attachments,
    wagglePreset: current?.wagglePreset ?? submittedPreset,
  })
  return attachmentLimitReason(attachments)
}

export function useComposerSubmission({
  onSend,
  onEnqueue,
  onSendFailure,
  isLoading,
  disabled,
  requiresText,
  clearOnSubmit,
  recordHistory,
  allowEnqueue,
  onToast,
  editorRef,
  projectPath,
  attachments,
  hasPreparingTextAttachment,
}: UseComposerSubmissionInput) {
  const input = useComposerStore((s) => s.input)
  const selectedWagglePreset = useComposerStore((s) => s.selectedWagglePreset)
  const reset = useComposerStore((s) => s.reset)
  const pushHistory = useComposerStore((s) => s.pushHistory)
  const selectedModel = useComposerModel().model
  const { effectiveThinkingLevel } = useSelectedModelThinkingLevel(selectedModel ?? null)

  function clearComposerInput(snapshot?: ComposerDraftSnapshot) {
    if (snapshot && !isCurrentComposerDraft(snapshot)) {
      clearInactiveComposerDraft(snapshot)
      return
    }
    reset()
    const activeEditor = useComposerStore.getState().lexicalEditor ?? editorRef.current
    if (activeEditor) {
      clearEditor(activeEditor)
    }
  }

  function dispatchPayload(payload: AgentSendPayload) {
    const block = getSubmitBlock({ payload, disabled, requiresText, projectPath, selectedModel })
    if (block) {
      if (block.type === 'toast') onToast?.(block.message)
      return { type: 'blocked' } satisfies DispatchResult
    }
    if (isLoading && allowEnqueue) {
      if (isGuiOnlyComposerCommand(payload.text)) {
        onToast?.(GUI_COMMAND_REQUIRES_IDLE_MESSAGE)
        return { type: 'blocked' } satisfies DispatchResult
      }
      const completion = callAsPromise(() => onEnqueue(payload))
      consumeSendResult(completion)
      return { type: 'queued', completion } satisfies DispatchResult
    }
    const result = onSend(payload)
    if (result === false) return { type: 'blocked' } satisfies DispatchResult
    return {
      type: 'sent',
      ...(result instanceof Promise ? { completion: result } : {}),
    } satisfies DispatchResult
  }

  function submitPayload(payload: AgentSendPayload) {
    const draftSnapshot = captureCurrentComposerDraft()
    const pendingKey = queuedSubmissionKey(draftSnapshot, payload)
    const pending = pendingQueuedSubmissions.get(pendingKey)
    if (pending) return pending
    const dispatch = dispatchPayload(payload)
    if (dispatch.type === 'blocked') return false
    if (dispatch.type === 'sent') {
      if (clearOnSubmit) markSessionResourceAttachmentsSubmitted(payload.attachments)
      finishSuccessfulSubmission(payload)
      if (dispatch.completion) {
        const completion = dispatch.completion.catch((cause: unknown) => {
          const disposition = onSendFailure?.(cause) ?? { kind: 'retain' as const }
          if (clearOnSubmit && disposition.kind === 'restore') {
            unmarkSessionResourceAttachmentsSubmitted(payload.attachments)
            const limitReason = restoreFailedSendDraft(
              payload,
              disposition.contextKey === undefined
                ? draftSnapshot.activeDraftContextKey
                : disposition.contextKey,
              selectedWagglePreset,
              useComposerStore.getState().lexicalEditor ?? editorRef.current,
            )
            if (limitReason) onToast?.(attachmentLimitMessage(limitReason))
          }
          if (clearOnSubmit && disposition.kind === 'discard') {
            unmarkSessionResourceAttachmentsSubmitted(payload.attachments)
            discardSessionResourceAttachments(payload.attachments)
          }
          throw cause
        })
        consumeSendResult(completion)
      }
      return true
    }
    const result = dispatch.completion.then(
      (accepted) => {
        if (accepted === false) return false
        if (clearOnSubmit) markSessionResourceAttachmentsSubmitted(payload.attachments)
        finishSuccessfulSubmission(payload, draftSnapshot)
        return true
      },
      () => false,
    )
    pendingQueuedSubmissions.set(pendingKey, result)
    void result.then(() => {
      if (pendingQueuedSubmissions.get(pendingKey) === result) {
        pendingQueuedSubmissions.delete(pendingKey)
      }
    })
    return result
  }

  function finishSuccessfulSubmission(
    payload: AgentSendPayload,
    draftSnapshot?: ComposerDraftSnapshot,
  ) {
    if (recordHistory && payload.text) pushHistory(payload.text)
    if (clearOnSubmit) clearComposerInput(draftSnapshot)
  }

  function handleSubmit(text?: string) {
    return submitPayload({
      text: (text ?? input).trim(),
      thinkingLevel: effectiveThinkingLevel,
      attachments,
      ...(selectedWagglePreset
        ? {
            waggle: {
              presetId: selectedWagglePreset.id,
              presetName: selectedWagglePreset.name,
              source: 'user',
              config: selectedWagglePreset.config,
            },
          }
        : {}),
    })
  }

  function sendComposed(text: string) {
    const state = useComposerStore.getState()
    return submitPayload({
      text,
      thinkingLevel: effectiveThinkingLevel,
      attachments: state.attachments,
      ...(state.selectedWagglePreset
        ? {
            waggle: {
              presetId: state.selectedWagglePreset.id,
              presetName: state.selectedWagglePreset.name,
              source: 'user',
              config: state.selectedWagglePreset.config,
            },
          }
        : {}),
    })
  }

  function submitCurrentDraft() {
    const state = useComposerStore.getState()
    submitPayload({
      text: state.input.trim(),
      thinkingLevel: effectiveThinkingLevel,
      attachments: state.attachments,
      ...(state.selectedWagglePreset
        ? {
            waggle: {
              presetId: state.selectedWagglePreset.id,
              presetName: state.selectedWagglePreset.name,
              source: 'user',
              config: state.selectedWagglePreset.config,
            },
          }
        : {}),
    })
  }

  return {
    input,
    projectPath,
    canSend: canSend({
      input,
      attachments,
      disabled,
      hasPreparingTextAttachment,
      projectPath,
      selectedModel,
      requiresText,
    }),
    handleSubmit,
    sendComposed,
    submitCurrentDraft,
  }
}
