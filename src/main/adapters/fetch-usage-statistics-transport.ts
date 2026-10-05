/**
 * Sends Usage statistics batches with Node's fetch. The request carries only the JSON body and
 * a content type; no cookie, credential, identifier or custom header is ever attached.
 */
import {
  USAGE_STATISTICS_EVENTS_PATH,
  USAGE_STATISTICS_ORIGIN,
} from '@shared/usage-statistics/contract'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  type UsageStatisticsDelivery,
  UsageStatisticsTransport,
  type UsageStatisticsTransportShape,
} from '../ports/usage-statistics-transport'

/** Longer than the endpoint takes to store a batch, so a slow answer is rarely cut off. */
export const USAGE_STATISTICS_REQUEST_TIMEOUT_MS = 30_000
const HTTP_SUCCESS_MIN = 200
const HTTP_REDIRECT_MIN = 300
const HTTP_SERVER_ERROR_MIN = 500
const HTTP_TOO_MANY_REQUESTS = 429
/** Failures that happen before the request is written: name resolution. */
const NAME_RESOLUTION_CODES: ReadonlySet<string> = new Set(['ENOTFOUND', 'EAI_AGAIN'])
/** Failures of the `connect` system call, also before the request is written. */
const CONNECT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
])
const UNDICI_CONNECT_TIMEOUT_CODE = 'UND_ERR_CONNECT_TIMEOUT'
const MAX_CAUSE_DEPTH = 4

interface UsageStatisticsFetchResponse {
  readonly status: number
  readonly body?: { readonly cancel: () => Promise<void> } | null
}

export type UsageStatisticsFetch = (
  url: string,
  init: {
    readonly method: 'POST'
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
    readonly redirect: 'error'
    readonly signal: AbortSignal
  },
) => Promise<UsageStatisticsFetchResponse>

export function classifyUsageStatisticsResponse(status: number): UsageStatisticsDelivery {
  if (status >= HTTP_SUCCESS_MIN && status < HTTP_REDIRECT_MIN) {
    return { outcome: 'accepted', status }
  }
  if (status >= HTTP_SERVER_ERROR_MIN || status === HTTP_TOO_MANY_REQUESTS) {
    return { outcome: 'retry', reason: 'endpoint-unavailable', status }
  }
  return { outcome: 'rejected', status }
}

function failedBeforeSending(error: unknown, depth = 0): boolean {
  if (depth > MAX_CAUSE_DEPTH || !isRecord(error)) return false
  const { code, syscall } = error
  if (typeof code === 'string') {
    if (NAME_RESOLUTION_CODES.has(code) || code === UNDICI_CONNECT_TIMEOUT_CODE) return true
    if (syscall === 'connect' && CONNECT_FAILURE_CODES.has(code)) return true
  }
  // Happy Eyeballs reports one connect failure per address in an AggregateError.
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.every((inner: unknown) => failedBeforeSending(inner, depth + 1))
  }
  return failedBeforeSending(error.cause, depth + 1)
}

/** A thrown fetch failure: retryable only when the request certainly never left. */
export function classifyUsageStatisticsFailure(error: unknown): UsageStatisticsDelivery {
  if (failedBeforeSending(error)) return { outcome: 'retry', reason: 'not-connected' }
  return {
    outcome: 'unknown',
    reason: error instanceof Error ? error.name : 'network failure',
  }
}

export const USAGE_STATISTICS_EVENTS_URL = new URL(
  USAGE_STATISTICS_EVENTS_PATH,
  USAGE_STATISTICS_ORIGIN,
).toString()

export function createFetchUsageStatisticsTransport(
  input: { readonly fetch?: UsageStatisticsFetch; readonly timeoutMs?: number } = {},
): UsageStatisticsTransportShape {
  const send = input.fetch ?? ((url, init) => fetch(url, init))
  const timeoutMs = input.timeoutMs ?? USAGE_STATISTICS_REQUEST_TIMEOUT_MS
  return {
    send: (request) =>
      Effect.promise(async (): Promise<UsageStatisticsDelivery> => {
        let response: UsageStatisticsFetchResponse
        try {
          response = await send(USAGE_STATISTICS_EVENTS_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (error) {
          return classifyUsageStatisticsFailure(error)
        }
        // The answer is in the status; release the connection instead of reading a body.
        await response.body?.cancel().catch(() => undefined)
        return classifyUsageStatisticsResponse(response.status)
      }),
  }
}

export const FetchUsageStatisticsTransportLive = Layer.sync(UsageStatisticsTransport, () =>
  UsageStatisticsTransport.of(createFetchUsageStatisticsTransport()),
)
