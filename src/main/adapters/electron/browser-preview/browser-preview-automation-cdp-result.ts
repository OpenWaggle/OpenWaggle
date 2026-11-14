import { Schema, safeDecodeUnknown } from '@shared/schema'

const evaluationResponseSchema = Schema.Struct({
  result: Schema.optionalWith(
    Schema.Struct({
      value: Schema.optionalWith(Schema.Unknown, { exact: true }),
      description: Schema.optionalWith(Schema.String, { exact: true }),
    }),
    { exact: true },
  ),
  exceptionDetails: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

export function browserPreviewCdpEvaluationValue(response: unknown) {
  const decoded = safeDecodeUnknown(evaluationResponseSchema, response)
  if (!decoded.success) throw new Error('Chromium returned a malformed evaluation response.')
  if (decoded.data.exceptionDetails !== undefined) {
    throw new Error('Browser preview JavaScript evaluation failed.')
  }
  return decoded.data.result?.value ?? decoded.data.result?.description ?? null
}
