import {
  USAGE_STATISTICS_ERROR_TUNNEL_PATH,
  USAGE_STATISTICS_EVENTS_PATH,
  USAGE_STATISTICS_SNAPSHOT_PATH,
  USAGE_STATISTICS_WEB_PATH,
} from '../../src/shared/usage-statistics/contract'
import {
  ANONYMOUS_DISTINCT_ID,
  type PostHogEvent,
  type PostHogPropertyValue,
  personlessProperties,
} from './posthog'
import { USAGE_STATS_FLUSH_PATH } from './snapshot-contract'

/** The endpoint's routes and the paths they answer. */
export const STATISTICS_ROUTE_PATHS = {
  events: USAGE_STATISTICS_EVENTS_PATH,
  errors: USAGE_STATISTICS_ERROR_TUNNEL_PATH,
  web: USAGE_STATISTICS_WEB_PATH,
  snapshot: USAGE_STATISTICS_SNAPSHOT_PATH,
  flush: USAGE_STATS_FLUSH_PATH,
} as const

export type StatisticsRoute = keyof typeof STATISTICS_ROUTE_PATHS
export type StatisticsRoutePath = (typeof STATISTICS_ROUTE_PATHS)[StatisticsRoute]

/** Logged instead of a path the endpoint does not serve, which is never logged itself. */
export const UNKNOWN_PATH = '(unknown)'
export type LoggedPath = StatisticsRoutePath | typeof UNKNOWN_PATH

export type RequestOutcome = 'accepted' | 'rejected' | 'forward_failed' | 'skipped' | 'error'

/**
 * What a request amounts to. `field` names a rejected field from a fixed list; nothing here
 * ever carries a value from the request.
 */
export interface RequestSummary {
  readonly outcome: RequestOutcome
  readonly field?: string
  readonly accepted?: number
  readonly rejected?: number
}

/**
 * What a route reports about one request. `accounted` is set when the route already counted
 * the request itself: it buffered the counts, or sent its `endpoint.request` event in the same
 * PostHog batch as its data, so the handler must not send another.
 */
export interface RouteResult extends RequestSummary {
  readonly response: Response
  readonly accounted?: boolean
}

/**
 * The one record of a request, used as its log line and its `endpoint.request` event. Its
 * fields are exactly the ones the privacy notice lists: path, outcome, rejected field name,
 * accepted and rejected counts, status and latency.
 */
export interface RequestRecord {
  readonly path: LoggedPath
  readonly outcome: RequestOutcome
  readonly field?: string
  readonly accepted?: number
  readonly rejected?: number
  readonly status: number
  readonly latency_ms: number
}

export const REQUEST_EVENT_NAME = 'endpoint.request'
/**
 * The buffered counts of app requests to `/events`, published per day by the flush. A name of
 * its own, so these totals never mix with the one-per-request `endpoint.request` events.
 */
export const BUFFERED_REQUESTS_EVENT_NAME = 'endpoint.requests'

export function requestRecord(
  path: LoggedPath,
  summary: RequestSummary & { readonly status: number },
  latencyMs: number,
): RequestRecord {
  return {
    path,
    outcome: summary.outcome,
    ...(summary.field === undefined ? {} : { field: summary.field }),
    ...(summary.accepted === undefined ? {} : { accepted: summary.accepted }),
    ...(summary.rejected === undefined ? {} : { rejected: summary.rejected }),
    status: summary.status,
    latency_ms: latencyMs,
  }
}

/** The request's log line, built from the record alone and never from the request. */
export function requestLogLine(record: RequestRecord) {
  return JSON.stringify(record)
}

/**
 * The record as a PostHog event. Besides the record it carries only the constant
 * `distinct_id` and the flags that keep PostHog from creating a person or geolocating it.
 */
export function requestEvent(record: RequestRecord, now: number): PostHogEvent {
  const properties: Record<string, PostHogPropertyValue> = {
    ...personlessProperties(ANONYMOUS_DISTINCT_ID),
    ...record,
  }
  return { event: REQUEST_EVENT_NAME, timestamp: new Date(now).toISOString(), properties }
}

const LATENCY_BUCKETS: readonly (readonly [number, string])[] = [
  [50, '<50ms'],
  [200, '50-200ms'],
  [1000, '200ms-1s'],
  [5000, '1-5s'],
]
const SLOWEST_LATENCY_BUCKET = '>5s'

/** Latency as a coarse bucket, for counts that are added up across requests. */
export function latencyBucket(latencyMs: number) {
  return LATENCY_BUCKETS.find(([limit]) => latencyMs < limit)?.[1] ?? SLOWEST_LATENCY_BUCKET
}
