import { Schema, safeDecodeUnknown } from '@shared/schema'

const evaluationResponseSchema = Schema.Struct({
  result: Schema.optional(
    Schema.Struct({
      value: Schema.optional(Schema.Unknown),
      description: Schema.optional(Schema.String),
    }),
  ),
  exceptionDetails: Schema.optional(Schema.Unknown),
})

export function browserPreviewCdpEvaluationValue(response: unknown) {
  const decoded = safeDecodeUnknown(evaluationResponseSchema, response)
  if (!decoded.success) throw new Error('Chromium returned a malformed evaluation response.')
  if (decoded.data.exceptionDetails !== undefined) {
    throw new Error('Browser preview JavaScript evaluation failed.')
  }
  return decoded.data.result?.value ?? decoded.data.result?.description ?? null
}
