import { ATTACHMENT } from '@shared/constants/resource-limits'

export const ATTACHMENT_BACKFILL_LIMITS = {
  maxBytes: ATTACHMENT.MAX_TOTAL_SIZE_BYTES,
  maxCount: 16,
} as const

export interface BackfillAttachmentBudget {
  readonly bytes: number
  readonly count: number
}

export function isBackfillableAttachmentSize(byteLength: number) {
  return (
    Number.isSafeInteger(byteLength) && byteLength >= 0 && byteLength <= ATTACHMENT.MAX_SIZE_BYTES
  )
}

export function advanceAttachmentBackfillBudget(
  current: BackfillAttachmentBudget,
  byteLength: number,
): BackfillAttachmentBudget | null {
  if (
    !isBackfillableAttachmentSize(byteLength) ||
    current.count >= ATTACHMENT_BACKFILL_LIMITS.maxCount ||
    current.bytes > ATTACHMENT_BACKFILL_LIMITS.maxBytes - byteLength
  ) {
    return null
  }
  return { bytes: current.bytes + byteLength, count: current.count + 1 }
}
