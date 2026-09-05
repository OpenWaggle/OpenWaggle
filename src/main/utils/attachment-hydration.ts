import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import type { HydratedAttachment, PreparedAttachment } from '@shared/types/agent'
import { extractAttachmentText } from '../ipc/attachment-text-extraction'
import { resolvePreparedAttachmentCapability } from './attachment-registry'

function contentSha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function hydrateAttachmentSource(
  attachment: PreparedAttachment,
): Promise<HydratedAttachment> {
  const preparedAttachment = await resolvePreparedAttachmentCapability(attachment)
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
  const hydratedSha256 = contentSha256(buffer)
  if (preparedAttachment.contentSha256 && hydratedSha256 !== preparedAttachment.contentSha256) {
    throw new Error(`Attachment changed after it was prepared: ${preparedAttachment.name}`)
  }
  const extractedText = preparedAttachment.extractedText
    ? preparedAttachment.extractedText
    : await extractAttachmentText({
        kind: preparedAttachment.kind,
        mimeType: preparedAttachment.mimeType,
        buffer,
        attachmentName: preparedAttachment.name,
      })

  if (!needsBinarySource) {
    return { ...preparedAttachment, contentSha256: hydratedSha256, extractedText, source: null }
  }

  return {
    ...preparedAttachment,
    contentSha256: hydratedSha256,
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
  return Promise.all(attachments.map(hydrateAttachmentSource))
}
