import fs from 'node:fs/promises'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import type { HydratedAttachment, PreparedAttachment } from '@shared/types/agent'
import { resolvePreparedAttachmentCapability } from './attachment-registry'

async function hydrateAttachmentSource(
  attachment: PreparedAttachment,
): Promise<HydratedAttachment> {
  const preparedAttachment = resolvePreparedAttachmentCapability(attachment)
  if (preparedAttachment.kind !== 'image' && preparedAttachment.kind !== 'pdf') {
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

  const buffer = await fs.readFile(preparedAttachment.path)
  return {
    ...preparedAttachment,
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
  const hydrated: HydratedAttachment[] = []
  for (const attachment of attachments) {
    hydrated.push(await hydrateAttachmentSource(attachment))
  }
  return hydrated
}
