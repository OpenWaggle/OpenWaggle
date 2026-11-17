import { ATTACHMENT } from '../constants/resource-limits'
import type { PreparedAttachment } from '../types/agent'

/** Everything the message total reads: a prepared attachment, or a record shaped like one. */
type CountedAttachment = Pick<PreparedAttachment, 'kind' | 'sizeBytes'>

/**
 * The bytes one message's attachment total counts: the documents. Pi reduces every prompt image to
 * the budget the selected model declares before the provider sees it, so an image's size never
 * decides whether a send can succeed, and counting images in the total refused a message Pi accepts
 * (ADR 0068). The window's checks share this one definition; the Session Host applies the same rule
 * while reading each file, so it walks its own snapshot list instead.
 */
export function countedAttachmentBytes(attachments: readonly CountedAttachment[]) {
  return attachments.reduce(
    (total, attachment) => (attachment.kind === 'image' ? total : total + attachment.sizeBytes),
    0,
  )
}

/** Whether the documents in one message exceed the message total. */
export function exceedsAttachmentTotalBytes(attachments: readonly CountedAttachment[]) {
  return countedAttachmentBytes(attachments) > ATTACHMENT.MAX_TOTAL_SIZE_BYTES
}
