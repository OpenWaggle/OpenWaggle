import fs from 'node:fs/promises'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import type { HydratedAttachment, PreparedAttachment } from '@shared/types/agent'
import { resolvePreparedAttachmentCapability } from './attachment-registry'
import { extractAttachmentText } from './attachment-text-extraction'

async function hydrateAttachmentSource(
  attachment: PreparedAttachment,
  validateCapability: boolean,
): Promise<HydratedAttachment> {
  const preparedAttachment = validateCapability
    ? await resolvePreparedAttachmentCapability(attachment)
    : attachment
  const needsBinarySource = preparedAttachment.kind === 'image' || preparedAttachment.kind === 'pdf'
  if (!needsBinarySource && preparedAttachment.extractedText) {
    return { ...preparedAttachment, source: null }
  }

  const stats = await fs.stat(preparedAttachment.path)
  if (!stats.isFile()) {
    throw new Error(`Attachment is no longer a file: ${preparedAttachment.name}`)
  }
  if (stats.size > ATTACHMENT.MAX_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(ATTACHMENT.MAX_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${preparedAttachment.name}`,
    )
  }
  if (stats.size !== preparedAttachment.sizeBytes) {
    throw new Error(`Attachment changed after it was prepared: ${preparedAttachment.name}`)
  }

  const buffer = await fs.readFile(preparedAttachment.path)
  const extractedText = preparedAttachment.extractedText
    ? preparedAttachment.extractedText
    : await extractAttachmentText({
        kind: preparedAttachment.kind,
        mimeType: preparedAttachment.mimeType,
        buffer,
        attachmentName: preparedAttachment.name,
      })

  if (!needsBinarySource) {
    return { ...preparedAttachment, extractedText, source: null }
  }

  return {
    ...preparedAttachment,
    extractedText,
    source: {
      type: 'data',
      value: buffer.toString('base64'),
      mimeType: attachment.mimeType,
    },
  }
}

export async function hydrateAttachmentSources(
  attachments: readonly PreparedAttachment[],
): Promise<HydratedAttachment[]> {
  // Independent per-attachment reads; Promise.all preserves input order.
  return Promise.all(attachments.map((attachment) => hydrateAttachmentSource(attachment, true)))
}

export async function hydrateTrustedAttachmentSources(
  attachments: readonly PreparedAttachment[],
): Promise<HydratedAttachment[]> {
  return Promise.all(attachments.map((attachment) => hydrateAttachmentSource(attachment, false)))
}
