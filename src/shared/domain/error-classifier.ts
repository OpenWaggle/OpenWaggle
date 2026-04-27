import { Schema, safeDecodeUnknown } from '@shared/schema'
import type { AgentErrorCode, AgentErrorInfo } from '../types/errors'

interface ErrorCodeMeta {
  readonly userMessage: string
  readonly suggestion?: string
  readonly retryable: boolean
}

export const ERROR_CODE_META: Record<AgentErrorCode, ErrorCodeMeta> = {
  'api-key-invalid': {
    userMessage: 'Invalid API key',
    suggestion: 'Check your API key in Settings.',
    retryable: false,
  },
  'session-expired': {
    userMessage: 'Session expired',
    suggestion: 'Sign in again to refresh your provider session.',
    retryable: false,
  },
  'insufficient-credits': {
    userMessage: 'Insufficient API credits',
    suggestion:
      'Your credit balance is too low. Purchase more credits or try a different provider.',
    retryable: false,
  },
  'rate-limited': {
    userMessage: 'Rate limited by provider',
    suggestion: 'Wait a moment and try again.',
    retryable: true,
  },
  'provider-down': {
    userMessage: 'Provider is temporarily unavailable',
    suggestion: 'The provider may be experiencing issues. Try again shortly.',
    retryable: true,
  },
  'model-not-found': {
    userMessage: 'Model not found',
    suggestion: 'The selected model may not be available — try a different one.',
    retryable: false,
  },
  'provider-unavailable': {
    userMessage: 'Could not connect to provider',
    suggestion: 'Check your network connection and provider base URL in Settings.',
    retryable: true,
  },
  'conversation-not-found': {
    userMessage: 'Conversation not found',
    suggestion: 'The session may have been deleted. Start a new session.',
    retryable: false,
  },
  'no-project': {
    userMessage: 'No project selected',
    suggestion: 'Select a project folder before starting Waggle mode.',
    retryable: false,
  },
  'persist-failed': {
    userMessage: 'Failed to save conversation',
    suggestion: 'Check disk space and file permissions.',
    retryable: false,
  },
  'context-overflow': {
    userMessage: 'Context window exceeded',
    suggestion: 'Start a new branch or switch to a model with a larger context window.',
    retryable: true,
  },
  unknown: {
    userMessage: 'Something went wrong',
    retryable: true,
  },
}

/** Type guard for validating a string is a known AgentErrorCode. */
export function isAgentErrorCode(code: string): code is AgentErrorCode {
  return code in ERROR_CODE_META
}

/**
 * Build an `AgentErrorInfo` from a known error code and raw message.
 */
export function makeErrorInfo(code: AgentErrorCode, message: string): AgentErrorInfo {
  const meta = ERROR_CODE_META[code]
  return {
    code,
    message,
    userMessage: meta.userMessage,
    suggestion: meta.suggestion,
    retryable: meta.retryable,
  }
}

/**
 * Classify an error message string into a structured `AgentErrorInfo`.
 * Pattern-matches against known error message patterns.
 * Falls back to `'unknown'` if no pattern matches.
 *
 * This is the single source of truth for string-based error classification,
 * shared across main process and renderer.
 */
export function classifyErrorMessage(message: string): AgentErrorInfo {
  // Provider SDKs often wrap errors as `400 {"type":"error","error":{"message":"..."}}`.
  // Extract the inner human-readable message for classification and display.
  // The status code name (e.g. Gemini's RESOURCE_EXHAUSTED) is returned separately
  // so classification can match on it without polluting the display message.
  const extracted = extractInnerErrorMessage(message)
  const displayMessage = extracted?.message ?? message
  const classifyTarget = extracted?.classifyTarget ?? message
  const lower = classifyTarget.toLowerCase()

  // Insufficient credits / billing — checked BEFORE auth because some provider
  // messages (e.g. OpenRouter "API key has insufficient credits") mention "api key"
  // but are credit errors, not auth errors.
  //   Anthropic: "Your credit balance is too low..."
  //   OpenAI:    "You exceeded your current quota..." / code "insufficient_quota"
  //   Gemini:    "RESOURCE_EXHAUSTED" / "Quota exceeded"
  //   Grok:      "used all available credits or reached its monthly spending limit"
  //   OpenRouter: "insufficient credits" / HTTP 402 "payment required"
  if (
    lower.includes('credit balance') ||
    lower.includes('insufficient_quota') ||
    lower.includes('insufficient credits') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('quota exceeded') ||
    lower.includes('resource_exhausted') ||
    lower.includes('purchase credits') ||
    lower.includes('spending limit') ||
    (lower.includes('payment required') && !lower.includes('subscription')) ||
    lower.includes('out of credits') ||
    (lower.includes('billing') && !lower.includes('billing address'))
  ) {
    return makeErrorInfo('insufficient-credits', displayMessage)
  }

  // Auth errors
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect api key')
  ) {
    return makeErrorInfo('api-key-invalid', displayMessage)
  }

  if (lower.includes('session expired') || lower.includes('sign in again')) {
    return makeErrorInfo('session-expired', displayMessage)
  }

  // Rate limiting
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return makeErrorInfo('rate-limited', displayMessage)
  }

  // Provider server errors (includes Anthropic 529 overloaded)
  if (
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('529') ||
    lower.includes('overloaded') ||
    lower.includes('internal server error') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway')
  ) {
    return makeErrorInfo('provider-down', displayMessage)
  }

  // Context overflow — prompt too long for the model's context window.
  // Patterns are specific to known provider error messages to avoid false positives
  // on unrelated 400 errors that happen to mention "tokens".
  //   Anthropic: "prompt is too long" / "exceeds the maximum number of tokens"
  //   OpenAI:    "maximum context length exceeded" / "context_length_exceeded"
  //   Gemini:    "exceeds the maximum token limit"
  if (
    lower.includes('prompt is too long') ||
    lower.includes('prompt_too_long') ||
    lower.includes('maximum context length') ||
    lower.includes('context_length_exceeded') ||
    lower.includes('exceeds the maximum number of tokens') ||
    lower.includes('exceeds the maximum token limit') ||
    (lower.includes('too many tokens') && lower.includes('context') && !lower.includes('rate'))
  ) {
    return makeErrorInfo('context-overflow', displayMessage)
  }

  // Model not found
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('not exist'))) {
    return makeErrorInfo('model-not-found', displayMessage)
  }

  // Network / connectivity
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network error')
  ) {
    return makeErrorInfo('provider-unavailable', displayMessage)
  }

  return makeErrorInfo('unknown', displayMessage)
}

/**
 * Result from extracting inner error messages. Separates the clean display
 * message from the classification target (which may include extra context
 * like Gemini's status code name for pattern matching).
 */
interface ExtractedError {
  /** Clean human-readable message for display / logging. */
  readonly message: string
  /** Message augmented with extra context (e.g. status codes) for classification. */
  readonly classifyTarget: string
}

/**
 * Extract the inner human-readable message from SDK error wrappers.
 * Provider SDKs produce various formats:
 *   Anthropic: `400 {"type":"error","error":{"type":"...","message":"Human-readable text"}}`
 *   OpenAI:    `429 {"error":{"message":"...","type":"insufficient_quota","code":"insufficient_quota"}}`
 *   Gemini:    `{"error":{"code":429,"message":"...","status":"RESOURCE_EXHAUSTED"}}`
 *   OpenRouter: `{"error":{"code":402,"message":"..."}}`
 * Returns the extracted messages if found, or `null` to use the original.
 */
const innerErrorSchema = Schema.Struct({
  error: Schema.optional(
    Schema.Struct({
      message: Schema.optional(Schema.String),
      status: Schema.optional(Schema.String),
    }),
  ),
  message: Schema.optional(Schema.String),
})

export function extractInnerErrorMessage(raw: string): ExtractedError | null {
  // Match pattern: optional status code, then JSON body
  const jsonStart = raw.indexOf('{')
  if (jsonStart < 0) return null

  try {
    const parsed: unknown = JSON.parse(raw.slice(jsonStart))
    const result = safeDecodeUnknown(innerErrorSchema, parsed)
    if (!result.success) return null
    if (!result.data.error?.message && !result.data.message) return null

    // Anthropic / OpenAI / Gemini / OpenRouter: { error: { message: "..." } }
    if (result.data.error?.message) {
      const msg = result.data.error.message
      // Gemini includes a status code name (e.g. RESOURCE_EXHAUSTED).
      // Append it to the classification target so patterns can match on it,
      // but keep the display message clean for the user.
      const status = result.data.error.status
      if (status && !msg.toLowerCase().includes(status.toLowerCase())) {
        return { message: msg, classifyTarget: `${msg} [${status}]` }
      }
      return { message: msg, classifyTarget: msg }
    }
    // Generic: { message: "..." }
    if (result.data.message) {
      return { message: result.data.message, classifyTarget: result.data.message }
    }
  } catch {
    // Not valid JSON — use original
  }
  return null
}
