import { ATTACHMENT } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'

export const sessionAttachmentIdsSchema = Schema.Array(Schema.String).pipe(
  Schema.maxItems(ATTACHMENT.MAX_COUNT),
  Schema.filter(
    (attachmentIds) =>
      new Set(attachmentIds).size === attachmentIds.length ||
      'Attachment capability IDs must be unique.',
  ),
)
