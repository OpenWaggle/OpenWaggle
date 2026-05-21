import { Schema, safeDecodeUnknown } from '@shared/schema'

export interface ExtractedError {
  readonly message: string
  readonly classifyTarget: string
}

const innerErrorSchema = Schema.Struct({
  error: Schema.optional(
    Schema.Struct({
      message: Schema.optional(Schema.String),
      status: Schema.optional(Schema.String),
    }),
  ),
  message: Schema.optional(Schema.String),
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

function extractedFromErrorMessage(message: string, status: string | undefined): ExtractedError {
  if (status && !message.toLowerCase().includes(status.toLowerCase())) {
    return { message, classifyTarget: `${message} [${status}]` }
  }
  return { message, classifyTarget: message }
}

function extractedFromInnerErrorData(data: InnerErrorData): ExtractedError | null {
  if (data.error?.message) {
    return extractedFromErrorMessage(data.error.message, data.error.status)
  }

  if (data.message) {
    return { message: data.message, classifyTarget: data.message }
  }

  return null
}

/**
 * Extract provider SDK inner error messages while keeping provider status
 * context available for classification.
 */
export function extractInnerErrorMessage(raw: string): ExtractedError | null {
  const data = parseInnerErrorData(raw)
  return data ? extractedFromInnerErrorData(data) : null
}
