import type { AgentErrorCode, AgentErrorInfo } from '../types/errors'
import { extractInnerErrorMessage } from './error-message-extraction'

interface ErrorCodeMeta {
  readonly userMessage: string
  readonly suggestion?: string
  readonly retryable: boolean
}

interface ErrorClassificationRule {
  readonly code: AgentErrorCode
  readonly matches: (lowerMessage: string) => boolean
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
  'session-not-found': {
    userMessage: 'Session not found',
    suggestion: 'The session may have been deleted. Start a new session.',
    retryable: false,
  },
  'no-project': {
    userMessage: 'No project selected',
    suggestion: 'Select a project folder before starting Waggle mode.',
    retryable: false,
  },
  'persist-failed': {
    userMessage: 'Failed to save session',
    suggestion: 'Check disk space and file permissions.',
    retryable: false,
  },
  'context-overflow': {
    userMessage: 'Context window exceeded',
    suggestion: 'Start a new branch or switch to a model with a larger context window.',
    retryable: true,
  },
  'runtime-package-manager-unavailable': {
    userMessage: 'Runtime package manager unavailable',
    suggestion: 'OpenWaggle could not run npm while loading Pi extensions. Check the app logs.',
    retryable: false,
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
    ...(meta.suggestion ? { suggestion: meta.suggestion } : {}),
    retryable: meta.retryable,
  }
}

function containsAny(message: string, patterns: readonly string[]) {
  return patterns.some((pattern) => message.includes(pattern))
}

function isInsufficientCreditsError(lower: string) {
  return (
    containsAny(lower, [
      'credit balance',
      'insufficient_quota',
      'insufficient credits',
      'exceeded your current quota',
      'quota exceeded',
      'resource_exhausted',
      'purchase credits',
      'spending limit',
      'out of credits',
    ]) ||
    (lower.includes('payment required') && !lower.includes('subscription')) ||
    (lower.includes('billing') && !lower.includes('billing address'))
  )
}

function isAuthError(lower: string) {
  return containsAny(lower, [
    '401',
    '403',
    'unauthorized',
    'authentication',
    'api key',
    'invalid_api_key',
    'incorrect api key',
  ])
}

function isRuntimePackageManagerError(lower: string) {
  return containsAny(lower, ['failed to run npm', 'invalid npmcommand', 'npm root -g'])
}

function isRateLimitedError(lower: string) {
  return containsAny(lower, ['429', 'rate limit', 'too many requests'])
}

function isProviderDownError(lower: string) {
  return containsAny(lower, [
    '500',
    '502',
    '503',
    '529',
    'overloaded',
    'internal server error',
    'service unavailable',
    'bad gateway',
  ])
}

function isContextOverflowError(lower: string) {
  return (
    containsAny(lower, [
      'prompt is too long',
      'prompt_too_long',
      'maximum context length',
      'context_length_exceeded',
      'exceeds the maximum number of tokens',
      'exceeds the maximum token limit',
    ]) ||
    (lower.includes('too many tokens') && lower.includes('context') && !lower.includes('rate'))
  )
}

function isModelNotFoundError(lower: string) {
  return lower.includes('model') && (lower.includes('not found') || lower.includes('not exist'))
}

function isProviderUnavailableError(lower: string) {
  return containsAny(lower, [
    'econnrefused',
    'enotfound',
    'etimedout',
    'fetch failed',
    'network error',
  ])
}

const ERROR_CLASSIFICATION_RULES: readonly ErrorClassificationRule[] = [
  {
    code: 'insufficient-credits',
    matches: isInsufficientCreditsError,
  },
  {
    code: 'api-key-invalid',
    matches: isAuthError,
  },
  {
    code: 'session-expired',
    matches: (lower) => containsAny(lower, ['session expired', 'sign in again']),
  },
  {
    code: 'runtime-package-manager-unavailable',
    matches: isRuntimePackageManagerError,
  },
  {
    code: 'rate-limited',
    matches: isRateLimitedError,
  },
  {
    code: 'provider-down',
    matches: isProviderDownError,
  },
  {
    code: 'context-overflow',
    matches: isContextOverflowError,
  },
  {
    code: 'model-not-found',
    matches: isModelNotFoundError,
  },
  {
    code: 'provider-unavailable',
    matches: isProviderUnavailableError,
  },
]

function resolveErrorCode(lowerMessage: string) {
  return ERROR_CLASSIFICATION_RULES.find((rule) => rule.matches(lowerMessage))?.code ?? 'unknown'
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
  const extracted = extractInnerErrorMessage(message)
  const displayMessage = extracted?.message ?? message
  const classifyTarget = extracted?.classifyTarget ?? message
  return makeErrorInfo(resolveErrorCode(classifyTarget.toLowerCase()), displayMessage)
}
