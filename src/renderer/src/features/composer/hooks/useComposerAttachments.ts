import type { PreparedAttachment } from '@shared/types/agent'
import { useComposerStore } from '../state/composer-store'
import { useAutoTextAttachment } from './useAutoTextAttachment'
import { type UseFileAttachmentResult, useFileAttachment } from './useFileAttachment'

interface UseComposerAttachmentsInput {
  readonly projectPath: string | null
  readonly onToast?: (message: string) => void
}

export interface ComposerAttachmentsController {
  readonly attachments: readonly PreparedAttachment[]
  readonly attachmentError: string | null
  readonly pendingTextAttachmentChips: ReturnType<
    typeof useAutoTextAttachment
  >['pendingTextAttachmentChips']
  readonly hasPreparingTextAttachment: boolean
  readonly checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean
  readonly removeAttachment: (attachmentId: string) => void
  readonly removePendingTextAttachment: (operationId: string, attachmentId: string) => void
  readonly clearAttachmentError: () => void
  readonly fileAttachment: UseFileAttachmentResult
}

export function useComposerAttachments({ projectPath, onToast }: UseComposerAttachmentsInput) {
  const attachments = useComposerStore((s) => s.attachments)
  const attachmentError = useComposerStore((s) => s.attachmentError)
  const setInput = useComposerStore((s) => s.setInput)
  const setAttachmentError = useComposerStore((s) => s.setAttachmentError)
  const addAttachments = useComposerStore((s) => s.addAttachments)
  const removeAttachment = useComposerStore((s) => s.removeAttachment)
  const textAttachment = useAutoTextAttachment({
    attachments,
    addAttachments,
    removeAttachment,
    setAttachmentError,
    setInput,
    onToast,
  })
  const fileAttachment = useFileAttachment({
    projectPath,
    attachments,
    preparingPendingCount: textAttachment.preparingPendingCount,
    addAttachments,
    setAttachmentError,
    onToast,
  })

  return {
    attachments,
    attachmentError,
    pendingTextAttachmentChips: textAttachment.pendingTextAttachmentChips,
    hasPreparingTextAttachment: textAttachment.hasPreparingTextAttachment,
    checkAndConvertPaste: textAttachment.checkAndConvertPaste,
    removeAttachment,
    removePendingTextAttachment: textAttachment.removePendingTextAttachment,
    clearAttachmentError: () => setAttachmentError(null),
    fileAttachment,
  }
}
