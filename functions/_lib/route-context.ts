import type { IncomingRequest } from './cloudflare'
import type { StatisticsDependencies } from './dependencies'
import type { StatisticsEnvironment } from './environment'
import type { PostHogEvent } from './posthog'
import {
  type RequestSummary,
  requestEvent,
  requestRecord,
  type StatisticsRoutePath,
} from './request-log'

/** Everything a route handler receives for one request. */
export interface RouteContext {
  readonly request: IncomingRequest
  readonly environment: StatisticsEnvironment
  readonly dependencies: StatisticsDependencies
  /** The route's published path, which is what the request is logged under. */
  readonly path: StatisticsRoutePath
  /** When the endpoint received the request, from `dependencies.now`. */
  readonly startedAt: number
}

/** Milliseconds since the request arrived. */
export function elapsed(context: RouteContext) {
  return context.dependencies.now() - context.startedAt
}

/**
 * The `endpoint.request` event a route sends in the same PostHog batch as its data, so the
 * request costs one batch. It records the outcome the request has once that batch is accepted
 * and the latency up to sending it; if the batch fails, the log line records the failure.
 */
export function pendingRequestEvent(
  context: RouteContext,
  summary: RequestSummary & { readonly status: number },
): PostHogEvent {
  const record = requestRecord(context.path, summary, elapsed(context))
  return requestEvent(record, context.dependencies.now())
}
