import { decodeUnknownExactOrThrow } from '@shared/schema'
import { browserPreviewAttachmentSchema } from '@shared/schemas/validation'
import type { PreparedAttachment } from '@shared/types/agent'

/** Stable key order binds all optional provenance fields, independent of client JSON ordering. */
export function browserAttachmentMetadataJson(
  metadata: PreparedAttachment['browserPreview'],
): string | null {
  if (metadata === undefined) return null
  const validated = decodeUnknownExactOrThrow(browserPreviewAttachmentSchema, metadata)
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(validated).sort(([left], [right]) => left.localeCompare(right)),
    ),
  )
}

export function parseBrowserAttachmentMetadata(
  json: string,
): NonNullable<PreparedAttachment['browserPreview']> {
  return decodeUnknownExactOrThrow(browserPreviewAttachmentSchema, JSON.parse(json))
}
