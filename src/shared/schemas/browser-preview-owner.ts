import { Schema } from 'effect'
import { browserPreviewIdSchema, browserPreviewOwnerKeySchema } from './browser-preview'

const REQUEST_ID_MAX_LENGTH = 128
const CONTROL_CODE_POINT_MAX = 0x1f
const DELETE_CODE_POINT = 0x7f
const ACKNOWLEDGMENT_ERROR_MAX_LENGTH = 1_024

const requestIdSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1),
  Schema.maxLength(REQUEST_ID_MAX_LENGTH),
  Schema.pattern(/^[A-Za-z0-9._:-]+$/),
)

const requestGenerationSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.finite(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

function containsNoControlCharacters(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (
      codePoint !== undefined &&
      (codePoint <= CONTROL_CODE_POINT_MAX || codePoint === DELETE_CODE_POINT)
    ) {
      return false
    }
  }
  return true
}

const acknowledgmentErrorSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1),
  Schema.maxLength(ACKNOWLEDGMENT_ERROR_MAX_LENGTH),
  Schema.filter(containsNoControlCharacters, {
    message: () => 'Browser preview errors must contain no control characters.',
  }),
)

export const browserPreviewOpenRequestAckSchema = Schema.Struct({
  requestId: requestIdSchema,
  generation: requestGenerationSchema,
  ownerKey: browserPreviewOwnerKeySchema,
  previewId: browserPreviewIdSchema,
  success: Schema.Boolean,
  error: Schema.optional(acknowledgmentErrorSchema),
})

export const browserPreviewOwnerSelectionSchema = Schema.Tuple(
  browserPreviewOwnerKeySchema,
  Schema.NullOr(browserPreviewIdSchema),
)
