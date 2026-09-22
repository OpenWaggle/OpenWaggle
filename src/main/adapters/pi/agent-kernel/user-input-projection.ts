import { Schema, safeDecodeUnknown } from '@shared/schema'
import { preparedAttachmentSchema } from '@shared/schemas/validation'
import type { MessagePart } from '@shared/types/agent'
import {
  buildPersistedUserMessageParts,
  type PersistedUserMessagePartsPayload,
} from '../../../agent/shared'

export const OPENWAGGLE_USER_INPUT_CUSTOM_TYPE = 'openwaggle-user-input'

const userInputProjectionSchema = Schema.Struct({
  version: Schema.Literal(1),
  parts: Schema.Array(
    Schema.Union(
      Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
      Schema.Struct({ type: Schema.Literal('attachment'), attachment: preparedAttachmentSchema }),
    ),
  ),
})

export function buildUserInputProjection(payload: PersistedUserMessagePartsPayload) {
  return { version: 1 as const, parts: buildPersistedUserMessageParts(payload) }
}

export function appendUserInputProjection(
  sessionManager: {
    appendCustomEntry(customType: string, data?: unknown): string
  },
  payload: PersistedUserMessagePartsPayload,
) {
  sessionManager.appendCustomEntry(
    OPENWAGGLE_USER_INPUT_CUSTOM_TYPE,
    buildUserInputProjection(payload),
  )
}

export function decodeUserInputProjection(value: unknown): readonly MessagePart[] | null {
  const decoded = safeDecodeUnknown(userInputProjectionSchema, value)
  return decoded.success ? decoded.data.parts : null
}
