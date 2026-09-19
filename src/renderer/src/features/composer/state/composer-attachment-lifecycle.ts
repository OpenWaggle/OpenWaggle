import type { PreparedAttachment } from '@shared/types/agent'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import type { ComposerState } from './composer-store-types'

const logger = createRendererLogger('composer-attachments')
const submittedSessionResourceAttachmentIds = new Set<string>()

function ownedAttachments(state: ComposerState) {
  const attachments = new Map<string, PreparedAttachment>()
  for (const attachment of state.attachments) attachments.set(attachment.id, attachment)
  for (const draft of Object.values(state.scopedDrafts)) {
    for (const attachment of draft.attachments) attachments.set(attachment.id, attachment)
  }
  return attachments
}

export function abandonedSessionResourceAttachments(
  previous: ComposerState,
  current: ComposerState,
) {
  const retainedIds = new Set(ownedAttachments(current).keys())
  return [...ownedAttachments(previous).values()].filter(
    (attachment) => attachment.origin === 'session-resource' && !retainedIds.has(attachment.id),
  )
}

/** The send/queue workflow owns these capabilities after the draft is cleared. */
export function markSessionResourceAttachmentsSubmitted(
  attachments: readonly PreparedAttachment[],
) {
  for (const attachment of attachments) {
    if (attachment.origin === 'session-resource') {
      submittedSessionResourceAttachmentIds.add(attachment.id)
    }
  }
}

export function unmarkSessionResourceAttachmentsSubmitted(
  attachments: readonly PreparedAttachment[],
) {
  for (const attachment of attachments) {
    submittedSessionResourceAttachmentIds.delete(attachment.id)
  }
}

export function discardSessionResourceAttachments(attachments: readonly PreparedAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.origin !== 'session-resource') continue
    void api.discardPreparedAttachment(attachment).catch((cause: unknown) => {
      logger.warn('Failed to discard abandoned Session resource attachment', {
        attachmentId: attachment.id,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    })
  }
}

export function releaseAbandonedSessionResourceAttachments(
  previous: ComposerState,
  current: ComposerState,
) {
  if (
    previous.attachments === current.attachments &&
    previous.scopedDrafts === current.scopedDrafts
  ) {
    return
  }
  for (const attachment of abandonedSessionResourceAttachments(previous, current)) {
    if (submittedSessionResourceAttachmentIds.delete(attachment.id)) continue
    discardSessionResourceAttachments([attachment])
  }
}
