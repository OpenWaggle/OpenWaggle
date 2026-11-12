import { Schema, safeDecodeUnknown } from '@shared/schema'

export interface ExtractedError {
  readonly message: string
  readonly classifyTarget: string
}

const innerErrorSchema = Schema.Struct({
  error: Schema.optionalWith(
    Schema.Struct({
      message: Schema.optionalWith(Schema.String, { exact: true }),
      status: Schema.optionalWith(Schema.String, { exact: true }),
      type: Schema.optionalWith(Schema.String, { exact: true }),
    }),
    { exact: true },
  ),
  message: Schema.optionalWith(Schema.String, { exact: true }),
})

type InnerErrorData = typeof innerErrorSchema.Type

function parseInnerErrorData(raw: string): InnerErrorData | null {
  const jsonStart = raw.indexOf('{')
  if (jsonStart < 0) return null

  try {
    const parsed: unknown = JSON.parse(raw.slice(jsonStart))
    const result = safeDecodeUnknown(innerErrorSchema, parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * The inner message is what the user reads, but classification also needs the provider's error
 * type, status, and the HTTP status that prefixes the JSON (`402 {...billing_error...}`). Dropping
 * them classified an OpenRouter billing error as "Something went wrong".
 */
function extractedFromErrorMessage(
  message: string,
  context: readonly (string | undefined)[],
): ExtractedError {
  const lower = message.toLowerCase()
  const extra = context.filter(
    (value): value is string =>
      value !== undefined && value !== '' && !lower.includes(value.toLowerCase()),
  )
  return {
    message,
    classifyTarget: extra.length > 0 ? `${message} [${extra.join('] [')}]` : message,
  }
}

function extractedFromInnerErrorData(
  data: InnerErrorData,
  httpStatus: string | undefined,
): ExtractedError | null {
  if (data.error?.message) {
    return extractedFromErrorMessage(data.error.message, [
      data.error.status,
      data.error.type,
      httpStatus,
    ])
  }

  if (data.message) {
    return extractedFromErrorMessage(data.message, [httpStatus])
  }

  return null
}

const LEADING_HTTP_STATUS = /^\s*(\d{3})\b/

/**
 * Extract provider SDK inner error messages while keeping provider status
 * context available for classification.
 */
export function extractInnerErrorMessage(raw: string): ExtractedError | null {
  const data = parseInnerErrorData(raw)
  return data ? extractedFromInnerErrorData(data, LEADING_HTTP_STATUS.exec(raw)?.[1]) : null
}
