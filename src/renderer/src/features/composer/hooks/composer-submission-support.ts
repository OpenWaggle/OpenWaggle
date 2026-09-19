import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import { useComposerStore } from '../state/composer-store'

const SILENT_SUBMIT_BLOCK = { type: 'silent' } as const

export function attachmentLimitReason(
  attachments: readonly PreparedAttachment[],
): 'count' | 'size' | null {
  if (attachments.length > ATTACHMENT.MAX_COUNT) return 'count'
  if (
    attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0) >
    ATTACHMENT.MAX_TOTAL_SIZE_BYTES
  )
    return 'size'
  return null
}

export function attachmentLimitMessage(reason: 'count' | 'size') {
  return reason === 'count'
    ? 'Your draft has too many attachments to send. Remove some before retrying.'
    : 'Your draft exceeds the 20 MB attachment limit. Remove some before retrying.'
}

interface SubmitBlockInput {
  readonly payload: AgentSendPayload
  readonly disabled?: boolean
  readonly requiresText: boolean
  readonly projectPath: string | null
  readonly selectedModel: string
}

export interface ComposerDraftSnapshot {
  readonly activeDraftContextKey: string | null
  readonly input: string
  readonly attachmentIds: readonly string[]
  readonly wagglePresetId: string | null
}

export function captureCurrentComposerDraft(): ComposerDraftSnapshot {
  const state = useComposerStore.getState()
  return {
    activeDraftContextKey: state.activeDraftContextKey,
    input: state.input,
    attachmentIds: state.attachments.map((attachment) => attachment.id),
    wagglePresetId: state.selectedWagglePreset?.id ?? null,
  }
}

export function isCurrentComposerDraft(snapshot: ComposerDraftSnapshot) {
  const state = useComposerStore.getState()
  return (
    state.activeDraftContextKey === snapshot.activeDraftContextKey &&
    state.input === snapshot.input &&
    state.selectedWagglePreset?.id === (snapshot.wagglePresetId ?? undefined) &&
    state.attachments.length === snapshot.attachmentIds.length &&
    state.attachments.every((attachment, index) => attachment.id === snapshot.attachmentIds[index])
  )
}

export function clearInactiveComposerDraft(snapshot: ComposerDraftSnapshot) {
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

export function queuedSubmissionKey(snapshot: ComposerDraftSnapshot, payload: AgentSendPayload) {
  return JSON.stringify({
    context: snapshot.activeDraftContextKey,
    input: snapshot.input,
    attachments: snapshot.attachmentIds,
    wagglePresetId: snapshot.wagglePresetId,
    submittedText: payload.text,
    thinkingLevel: payload.thinkingLevel,
  })
}

export function callAsPromise<Result>(action: () => Promise<Result> | Result): Promise<Result> {
  try {
    return Promise.resolve(action())
  } catch (error) {
    return Promise.reject(error)
  }
}

export function getSubmitBlock({
  payload,
  disabled,
  requiresText,
  projectPath,
  selectedModel,
}: SubmitBlockInput) {
  if (requiresText && !payload.text) return SILENT_SUBMIT_BLOCK
  if (disabled || (!payload.text && payload.attachments.length === 0)) return SILENT_SUBMIT_BLOCK
  const attachmentLimit = attachmentLimitReason(payload.attachments)
  if (attachmentLimit) return toastSubmitBlock(attachmentLimitMessage(attachmentLimit))
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

export function canSend({
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
    !attachmentLimitReason(attachments) &&
    Boolean(projectPath) &&
    selectedModel.trim().length > 0
  )
}
