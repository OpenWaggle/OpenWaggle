import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'

interface PreparedAttachmentCapability {
  readonly attachment: PreparedAttachment
  readonly realPath: string
}

const preparedAttachments = new Map<string, PreparedAttachmentCapability>()

function normalizeCapabilityPath(filePath: string): string {
  return path.normalize(filePath)
}

function sameOptionalValue(left: string | undefined, right: string | undefined): boolean {
  return (left ?? null) === (right ?? null)
}

export function rememberPreparedAttachment(attachment: PreparedAttachment, realPath: string): void {
  preparedAttachments.set(attachment.id, {
    attachment: {
      ...attachment,
      path: normalizeCapabilityPath(realPath),
    },
    realPath: normalizeCapabilityPath(realPath),
  })
}

export function resolvePreparedAttachmentCapability(
  attachment: PreparedAttachment,
): PreparedAttachment {
  const capability = preparedAttachments.get(attachment.id)
  if (!capability) {
    throw new Error(`Attachment was not prepared by this app session: ${attachment.name}`)
  }

  const requestedPath = normalizeCapabilityPath(attachment.path)
  if (requestedPath !== capability.realPath) {
    throw new Error(`Attachment path does not match prepared file: ${attachment.name}`)
  }

  const prepared = capability.attachment
  if (
    prepared.kind !== attachment.kind ||
    prepared.name !== attachment.name ||
    prepared.mimeType !== attachment.mimeType ||
    prepared.sizeBytes !== attachment.sizeBytes ||
    !sameOptionalValue(prepared.origin, attachment.origin)
  ) {
    throw new Error(`Attachment metadata does not match prepared file: ${attachment.name}`)
  }

  return prepared
}
