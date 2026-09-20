import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type { WagglePreset } from '@shared/types/waggle'
import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { useSelectedSessionModel } from '@/features/chat/hooks'
import { useSelectedModelThinkingLevel } from '@/features/providers/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { clearEditor, setEditorDraft } from '../lib/lexical-utils'
import { consumeSendResult } from '../lib/send-result'
import {
  discardSessionResourceAttachments,
  markSessionResourceAttachmentsSubmitted,
  unmarkSessionResourceAttachmentsSubmitted,
} from '../state/composer-attachment-lifecycle'
import { useComposerStore } from '../state/composer-store'

const SILENT_SUBMIT_BLOCK = { type: 'silent' } as const

interface UseComposerSubmissionInput {
  readonly onSend: (payload: AgentSendPayload) => Promise<void> | void | false
  readonly onEnqueue: (payload: AgentSendPayload) => Promise<void> | void | false
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

interface SubmitBlockInput {
  readonly payload: AgentSendPayload
  readonly disabled?: boolean
  readonly requiresText: boolean
  readonly projectPath: string | null
  readonly selectedModel: string
}

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

function attachmentLimitReason(
  attachments: readonly PreparedAttachment[],
): 'count' | 'size' | null {
  if (attachments.length > ATTACHMENT.MAX_COUNT) return 'count'
  if (
    attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0) >
    ATTACHMENT.MAX_TOTAL_SIZE_BYTES
  ) {
    return 'size'
  }
  return null
}

function attachmentLimitMessage(reason: 'count' | 'size') {
  return reason === 'count'
    ? 'Your draft has too many attachments to send. Remove some before retrying.'
    : 'Your draft exceeds the 20 MB attachment limit. Remove some before retrying.'
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
  if (!contextKey) return false
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
  const selectedModel = useSelectedSessionModel().selectedModel
  const { effectiveThinkingLevel } = useSelectedModelThinkingLevel()

  function clearComposerInput() {
    reset()
    if (editorRef.current) {
      clearEditor(editorRef.current)
    }
  }

  function dispatchPayload(payload: AgentSendPayload) {
    const block = getSubmitBlock({ payload, disabled, requiresText, projectPath, selectedModel })
    if (!block) {
      const draftContextKey = useComposerStore.getState().activeDraftContextKey
      const wagglePreset = useComposerStore.getState().selectedWagglePreset
      if (clearOnSubmit) markSessionResourceAttachmentsSubmitted(payload.attachments)
      try {
        const result = isLoading && allowEnqueue ? onEnqueue(payload) : onSend(payload)
        if (result === false) {
          if (clearOnSubmit) unmarkSessionResourceAttachmentsSubmitted(payload.attachments)
          return false
        }
        consumeSendResult(
          result?.catch((cause: unknown) => {
            if (clearOnSubmit) {
              const disposition = onSendFailure?.(cause) ?? { kind: 'retain' }
              if (disposition.kind === 'restore') {
                const limitReason = restoreFailedSendDraft(
                  payload,
                  disposition.contextKey === undefined ? draftContextKey : disposition.contextKey,
                  wagglePreset,
                  editorRef.current,
                )
                if (limitReason) onToast?.(attachmentLimitMessage(limitReason))
              }
              if (disposition.kind === 'discard') {
                discardSessionResourceAttachments(payload.attachments)
              }
            }
            throw cause
          }),
        )
      } catch (cause) {
        if (clearOnSubmit) unmarkSessionResourceAttachmentsSubmitted(payload.attachments)
        throw cause
      }
      return true
    }
    if (block.type === 'toast') onToast?.(block.message)
    return false
  }

  function submitPayload(payload: AgentSendPayload) {
    const sent = dispatchPayload(payload)
    if (!sent) return false
    if (recordHistory && payload.text) pushHistory(payload.text)
    if (clearOnSubmit) clearComposerInput()
    return true
  }

  function handleSubmit(text?: string) {
    submitPayload({
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

function getSubmitBlock({
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
    !attachmentLimitReason(attachments) &&
    Boolean(projectPath) &&
    selectedModel.trim().length > 0
  )
}
