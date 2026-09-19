import { setTimeout } from 'node:timers/promises'
import { fetch, type Response } from 'undici'

const MAX_ATTEMPTS = 5
const RETRY_BUDGET_MS = 6 * 60 * 1_000
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const BACKOFF_MULTIPLIER = 2
const HTTP_SUCCESS_MINIMUM = 200
const HTTP_SUCCESS_MAXIMUM = 300
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const MILLISECONDS_PER_SECOND = 1_000
const HTTP_DATE_PATTERN =
  /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/u
const HUGGING_FACE_RATE_LIMIT_PATTERN = /^"(?:api|pages|resolvers)"\s*;\s*r=\d+\s*;\s*t=(\d+)$/u

interface ModelDownloadDependencies {
  readonly fetch?: (url: string) => Promise<Response>
  readonly wait?: (milliseconds: number) => Promise<void>
  readonly now?: () => number
}

function retryAfterDelay(value: string | null, now: number) {
  if (value === null) return undefined
  const normalized = value.trim()
  // Overflow is an unserviceable server delay, not a reason to retry earlier.
  if (/^\d+$/u.test(normalized)) return Number(normalized) * MILLISECONDS_PER_SECOND
  if (!HTTP_DATE_PATTERN.test(normalized)) return undefined
  const retryAt = Date.parse(normalized)
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now)
}

function responseRetryDelay(response: Response, attempt: number, now: number) {
  const retryAfter = retryAfterDelay(response.headers.get('retry-after'), now)
  const rateLimit = response.headers.get('ratelimit')?.trim()
  const resetSeconds = rateLimit?.match(HUGGING_FACE_RATE_LIMIT_PATTERN)?.[1]
  const resetDelay =
    resetSeconds === undefined ? undefined : Number(resetSeconds) * MILLISECONDS_PER_SECOND
  const fallback = Math.min(
    INITIAL_BACKOFF_MS * BACKOFF_MULTIPLIER ** (attempt - 1),
    MAX_BACKOFF_MS,
  )
  return Math.max(INITIAL_BACKOFF_MS, retryAfter ?? resetDelay ?? fallback)
}

/** Bounds retry admission and waiting, not successful model transfer duration. */
export async function fetchModelDownloadResponse(
  url: string,
  dependencies: ModelDownloadDependencies = {},
) {
  const fetchResponse = dependencies.fetch ?? fetch
  const wait = dependencies.wait ?? setTimeout
  const now = dependencies.now ?? Date.now
  const startedAt = now()
  let waitedMs = 0
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchResponse(url)
    if (response.status >= HTTP_SUCCESS_MINIMUM && response.status < HTTP_SUCCESS_MAXIMUM) {
      return response
    }
    await response.body?.cancel()
    const failure = new Error(
      `Model download failed with HTTP ${String(response.status)} for ${url}.`,
    )
    const delay = responseRetryDelay(response, attempt, now())
    const remainingMs = RETRY_BUDGET_MS - Math.max(waitedMs, now() - startedAt)
    if (
      !RETRYABLE_STATUSES.has(response.status) ||
      attempt === MAX_ATTEMPTS ||
      delay >= remainingMs
    ) {
      throw failure
    }
    await wait(delay)
    waitedMs += delay
    if (Math.max(waitedMs, now() - startedAt) >= RETRY_BUDGET_MS) throw failure
  }
  throw new Error('Model download exhausted its HTTP attempts.')
}
