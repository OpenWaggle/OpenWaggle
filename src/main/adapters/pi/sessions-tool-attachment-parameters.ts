import { ATTACHMENT } from '@shared/constants/resource-limits'
import { SESSION_QUERY_MAX_PATH_LENGTH } from '@shared/types/session-query'
import { Type } from 'typebox'

export const sessionsToolAttachmentPaths = Type.Optional(
  Type.Array(Type.String({ minLength: 1, maxLength: SESSION_QUERY_MAX_PATH_LENGTH }), {
    maxItems: ATTACHMENT.MAX_COUNT,
    uniqueItems: true,
  }),
)
