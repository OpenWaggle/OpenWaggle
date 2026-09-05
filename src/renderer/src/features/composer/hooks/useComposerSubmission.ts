import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { useSelectedModelThinkingLevel } from '@/features/providers/hooks'
import { clearEditor } from '../lib/lexical-utils'
import { consumeSendResult } from '../lib/send-result'
import { useComposerStore } from '../state/composer-store'
import { useComposerModel } from './useComposerModel'

const SILENT_SUBMIT_BLOCK = { type: 'silent' } as const
const pendingQueuedSubmissions = new Map<string, Promise<boolean>>()

interface UseComposerSubmissionInput {
  readonly onSend: (payload: AgentSendPayload) => Promise<void> | void | false
  readonly onEnqueue: (
    payload: AgentSendPayload,
  ) => Promise<boolean | undefined> | boolean | undefined
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

interface SubmitBlockInput {
  readonly payload: AgentSendPayload
  readonly disabled?: boolean
  readonly requiresText: boolean
  readonly projectPath: string | null
  readonly selectedModel: string
}

interface ComposerDraftSnapshot {
  readonly activeDraftContextKey: string | null
  readonly input: string
  readonly attachmentIds: readonly string[]
  readonly wagglePresetId: string | null
}

type DispatchResult =
  | { readonly type: 'blocked' }
  | { readonly type: 'sent' }
  | { readonly type: 'queued'; readonly completion: Promise<boolean | undefined> }

export function useComposerSubmission({
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
  attachments,
  hasPreparingTextAttachment,
}: UseComposerSubmissionInput) {
  const input = useComposerStore((s) => s.input)
  const selectedWagglePreset = useComposerStore((s) => s.selectedWagglePreset)
  const reset = useComposerStore((s) => s.reset)
  const pushHistory = useComposerStore((s) => s.pushHistory)
  const selectedModel = useComposerModel().model
  const { effectiveThinkingLevel } = useSelectedModelThinkingLevel(selectedModel)

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
      const completion = callAsPromise(() => onEnqueue(payload))
      consumeSendResult(completion)
      return { type: 'queued', completion } satisfies DispatchResult
    }
    const result = onSend(payload)
    if (result === false) return { type: 'blocked' } satisfies DispatchResult
    consumeSendResult(result)
    return { type: 'sent' } satisfies DispatchResult
  }

  function submitPayload(payload: AgentSendPayload) {
    const draftSnapshot = captureCurrentComposerDraft()
    const pendingKey = queuedSubmissionKey(draftSnapshot, payload)
    const pending = pendingQueuedSubmissions.get(pendingKey)
    if (pending) return pending
    const dispatch = dispatchPayload(payload)
    if (dispatch.type === 'blocked') return false
    if (dispatch.type === 'sent') {
      finishSuccessfulSubmission(payload)
      return true
    }
    const result = dispatch.completion.then(
      (accepted) => {
        if (accepted === false) return false
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

function captureCurrentComposerDraft(): ComposerDraftSnapshot {
  const state = useComposerStore.getState()
  return {
    activeDraftContextKey: state.activeDraftContextKey,
    input: state.input,
    attachmentIds: state.attachments.map((attachment) => attachment.id),
    wagglePresetId: state.selectedWagglePreset?.id ?? null,
  }
}

function isCurrentComposerDraft(snapshot: ComposerDraftSnapshot) {
  const state = useComposerStore.getState()
  return (
    state.activeDraftContextKey === snapshot.activeDraftContextKey &&
    state.input === snapshot.input &&
    state.selectedWagglePreset?.id === (snapshot.wagglePresetId ?? undefined) &&
    state.attachments.length === snapshot.attachmentIds.length &&
    state.attachments.every((attachment, index) => attachment.id === snapshot.attachmentIds[index])
  )
}

function clearInactiveComposerDraft(snapshot: ComposerDraftSnapshot) {
  if (!snapshot.activeDraftContextKey) return
  const state = useComposerStore.getState()
  const draft = state.scopedDrafts[snapshot.activeDraftContextKey]
  if (
    !draft ||
    draft.input !== snapshot.input ||
    draft.wagglePreset?.id !== (snapshot.wagglePresetId ?? undefined) ||
    draft.attachments.length !== snapshot.attachmentIds.length ||
    !draft.attachments.every((attachment, index) => attachment.id === snapshot.attachmentIds[index])
  ) {
    return
  }
  state.clearScopedDraft(snapshot.activeDraftContextKey)
}

function queuedSubmissionKey(snapshot: ComposerDraftSnapshot, payload: AgentSendPayload) {
  return JSON.stringify({
    context: snapshot.activeDraftContextKey,
    input: snapshot.input,
    attachments: snapshot.attachmentIds,
    wagglePresetId: snapshot.wagglePresetId,
    submittedText: payload.text,
    thinkingLevel: payload.thinkingLevel,
  })
}

function callAsPromise<Result>(action: () => Promise<Result> | Result): Promise<Result> {
  try {
    return Promise.resolve(action())
  } catch (error) {
    return Promise.reject(error)
  }
}

function getSubmitBlock({
  payload,
  disabled,
  requiresText,
  projectPath,
  selectedModel,
}: SubmitBlockInput) {
  if (requiresText && !payload.text) return SILENT_SUBMIT_BLOCK
  if (disabled || (!payload.text && payload.attachments.length === 0)) return SILENT_SUBMIT_BLOCK
  if (!projectPath) return toastSubmitBlock('Select a project before sending.')
  if (!selectedModel.trim()) return toastSubmitBlock('Select a model in Settings before sending.')
  return null
}

function toastSubmitBlock(message: string) {
  return { type: 'toast' as const, message }
}

interface CanSendInput {
  readonly input: string
  readonly attachments: readonly PreparedAttachment[]
  readonly disabled?: boolean
  readonly hasPreparingTextAttachment: boolean
  readonly projectPath: string | null
  readonly selectedModel: string
  readonly requiresText: boolean
}

function canSend({
  input,
  attachments,
  disabled,
  hasPreparingTextAttachment,
  projectPath,
  selectedModel,
  requiresText,
}: CanSendInput) {
  const hasSubmitContent = requiresText
    ? input.trim().length > 0
    : input.trim().length > 0 || attachments.length > 0

  return (
    hasSubmitContent &&
    !disabled &&
    !hasPreparingTextAttachment &&
    Boolean(projectPath) &&
    selectedModel.trim().length > 0
  )
}
