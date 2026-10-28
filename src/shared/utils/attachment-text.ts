import { ATTACHMENT } from '@shared/constants/resource-limits'

const TRUNCATED_MARKER = '\n...[truncated]'

/**
 * An attachment's text as a client may hold it: trimmed, and cut with a truncation marker so it
 * fits `ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS`, the bound every prepared-attachment schema enforces.
 */
export function boundedAttachmentText(text: string) {
  const trimmed = text.trim()
  if (trimmed.length <= ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS) return trimmed
  return `${trimmed.slice(0, ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS - TRUNCATED_MARKER.length)}${TRUNCATED_MARKER}`
}
