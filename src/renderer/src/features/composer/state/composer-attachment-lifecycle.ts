import type { PreparedAttachment } from '@shared/types/agent'
import { releaseAttachmentPreviewUrls } from '@/shared/lib/attachment-preview-urls'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import type { ComposerState } from './composer-store-types'

const logger = createRendererLogger('composer-attachments')
const submittedAttachmentIds = new Set<string>()
/*
 * Attachments a queued Follow-up already references on the Host, loaded back into the composer by a
 * Follow-up edit. The composer never owns them: removing their chip, cancelling the edit, or
 * restoring the set-aside draft must not discard what the queued message still delivers. Each id
 * is released when its chip leaves the composer.
 */
const hostReferencedAttachmentIds = new Set<string>()

function ownedAttachments(state: ComposerState) {
  const attachments = new Map<string, PreparedAttachment>()
  for (const attachment of state.attachments) attachments.set(attachment.id, attachment)
  for (const draft of Object.values(state.scopedDrafts)) {
    for (const attachment of draft.attachments) attachments.set(attachment.id, attachment)
  }
  return attachments
}

function abandonedAttachments(previous: ComposerState, current: ComposerState) {
  const retainedIds = new Set(ownedAttachments(current).keys())
  return [...ownedAttachments(previous).values()].filter(
    (attachment) => !retainedIds.has(attachment.id),
  )
}

export function abandonedSessionResourceAttachments(
  previous: ComposerState,
  current: ComposerState,
) {
  return abandonedAttachments(previous, current).filter(
    (attachment) => attachment.origin === 'session-resource',
  )
}

/** The send/queue workflow owns these capabilities after the draft is cleared. */
export function markAttachmentsSubmitted(attachments: readonly PreparedAttachment[]) {
  for (const attachment of attachments) submittedAttachmentIds.add(attachment.id)
}

export function retainHostReferencedAttachments(attachments: readonly { readonly id: string }[]) {
  for (const attachment of attachments) hostReferencedAttachmentIds.add(attachment.id)
}

export function isHostReferencedAttachment(attachment: { readonly id: string }) {
  return hostReferencedAttachmentIds.has(attachment.id)
}

export function unmarkAttachmentsSubmitted(attachments: readonly PreparedAttachment[]) {
  for (const attachment of attachments) submittedAttachmentIds.delete(attachment.id)
}

export function discardSessionResourceAttachments(attachments: readonly PreparedAttachment[]) {
  releaseAttachmentPreviewUrls(attachments)
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
  const abandoned = abandonedAttachments(previous, current)
  for (const attachment of abandoned) {
    // Leaving the composer ends both protections: a removed chip or a sent draft is let go of here.
    const hostReferenced = hostReferencedAttachmentIds.delete(attachment.id)
    const submitted = submittedAttachmentIds.delete(attachment.id)
    if (hostReferenced || submitted) continue
    if (attachment.origin === 'session-resource') discardSessionResourceAttachments([attachment])
    else releaseAttachmentPreviewUrls([attachment])
  }
}
