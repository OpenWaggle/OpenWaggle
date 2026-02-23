/**
 * Structured error types for the agent error pipeline.
 *
 * Errors are classified in the main process, transported through IPC
 * with a `code` field, and displayed in the renderer with user-friendly
 * messages and actionable suggestions.
 */

export type AgentErrorCode =
  | 'api-key-invalid'
  | 'rate-limited'
  | 'provider-down'
  | 'model-not-found'
  | 'provider-unavailable'
  | 'conversation-not-found'
  | 'persist-failed'
  | 'unknown'

export interface AgentErrorInfo {
  readonly code: AgentErrorCode
  readonly message: string
  readonly userMessage: string
  readonly suggestion?: string
  readonly retryable: boolean
}

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
    suggestion: 'The conversation may have been deleted. Start a new thread.',
    retryable: false,
  },
  'persist-failed': {
    userMessage: 'Failed to save conversation',
    suggestion: 'Check disk space and file permissions.',
    retryable: false,
  },
  unknown: {
    userMessage: 'Something went wrong',
    retryable: true,
  },
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
  const lower = message.toLowerCase()

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
    return makeErrorInfo('api-key-invalid', message)
  }

  // Rate limiting
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return makeErrorInfo('rate-limited', message)
  }

  // Provider server errors
  if (
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('internal server error') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway')
  ) {
    return makeErrorInfo('provider-down', message)
  }

  // Model not found
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('not exist'))) {
    return makeErrorInfo('model-not-found', message)
  }

  // Network / connectivity
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network error')
  ) {
    return makeErrorInfo('provider-unavailable', message)
  }

  return makeErrorInfo('unknown', message)
}
