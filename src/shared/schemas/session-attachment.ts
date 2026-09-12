import { ATTACHMENT } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import { sessionInputIdSchema } from './session-input'

export const sessionAttachmentIdsSchema = Schema.Array(sessionInputIdSchema).pipe(
  Schema.maxItems(ATTACHMENT.MAX_COUNT),
  Schema.filter(
    (attachmentIds) =>
      new Set(attachmentIds).size === attachmentIds.length ||
      'Attachment capability IDs must be unique.',
  ),
)
