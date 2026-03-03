import { createLogger } from '../logger'

const MAX_ATTEMPTS = 2
const DELAY_MS = 1000
const IS_TRANSIENT_ERROR_VALUE_429 = 429
const IS_TRANSIENT_ERROR_VALUE_502 = 502
const IS_TRANSIENT_ERROR_VALUE_503 = 503
const IS_TRANSIENT_ERROR_VALUE_529 = 529

const logger = createLogger('retry')

interface RetryOptions {
  readonly maxAttempts: number
  readonly delayMs: number
}

const DEFAULT_OPTIONS: RetryOptions = { maxAttempts: MAX_ATTEMPTS, delayMs: DELAY_MS }

/**
 * Extract a numeric HTTP status from an error, if available.
 * Provider SDKs typically expose `status` on their error objects.
 */
function getErrorStatus(error: Error): number | undefined {
  if ('status' in error && typeof (error as { status: unknown }).status === 'number') {
    return (error as { status: number }).status
  }
  return undefined
}

/**
 * Returns true for errors that are likely transient and worth retrying.
 * Retries on network errors, rate limits (429), service unavailable (502/503),
 * and overloaded (529). Auth errors (401, 403) are never retried.
 */
function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  // Prefer structured status code when available
  const status = getErrorStatus(error)
  if (
    status === IS_TRANSIENT_ERROR_VALUE_429 ||
    status === IS_TRANSIENT_ERROR_VALUE_502 ||
    status === IS_TRANSIENT_ERROR_VALUE_503 ||
    status === IS_TRANSIENT_ERROR_VALUE_529
  )
    return true
  if (status !== undefined) return false // Known HTTP status, not transient

  const message = error.message.toLowerCase()

  // Network-level errors (no HTTP status)
  if (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('network error')
  ) {
    return true
  }

  // Fallback: string patterns for providers that don't expose structured status
  if (message.includes('rate limit')) return true
  if (message.includes('service unavailable')) return true
  if (message.includes('bad gateway')) return true
  if (message.includes('overloaded')) return true

  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry a function with exponential backoff on transient errors.
 * Non-transient errors (auth, validation) are thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxAttempts, delayMs } = { ...DEFAULT_OPTIONS, ...options }

  if (maxAttempts < 1) {
    throw new Error('withRetry: maxAttempts must be >= 1')
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts || !isTransientError(err)) {
        throw err
      }
      const backoff = delayMs * attempt
      logger.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${backoff}ms`, {
        error: err instanceof Error ? err.message : String(err),
      })
      await delay(backoff)
    }
  }

  // Unreachable — loop always returns or throws. Satisfies TypeScript.
  throw new Error('withRetry: unexpected exit')
}
