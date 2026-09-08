import type { AgentSendPayload, AttachmentRecord } from '../types/agent'

function buildAttachmentPromptText(attachment: Pick<AttachmentRecord, 'name' | 'extractedText'>) {
  const extracted = attachment.extractedText.trim()
  return extracted
    ? `[Attachment: ${attachment.name}]\n${extracted}`
    : `[Attachment: ${attachment.name}]`
}

/** Canonical text block sent to an agent before any model-specific binary image blocks. */
export function buildAgentPromptText(payload: Pick<AgentSendPayload, 'text' | 'attachments'>) {
  const parts = payload.text.trim() ? [payload.text.trim()] : []
  return [...parts, ...payload.attachments.map(buildAttachmentPromptText)].join('\n\n').trim()
}
