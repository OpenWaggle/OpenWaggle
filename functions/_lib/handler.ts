/**
 * The statistics endpoint behind `functions/api/v1/[[path]].ts` (ADR 0045): routing, the one
 * structured log line per request, request accounting and exception reporting.
 */
import type { BackgroundTasks, IncomingRequest } from './cloudflare'
import { runtimeDependencies, type StatisticsDependencies } from './dependencies'
import type { StatisticsEnvironment } from './environment'
import { handleErrorsRequest } from './errors-route'
import { handleEventsRequest } from './events-route'
import { reportEndpointException } from './exception-report'
import { handleFlushRequest } from './flush-route'
import { HTTP_STATUS, jsonResponse } from './http'
import { postHogSetting, sendPostHogEvents } from './posthog'
import {
  type LoggedPath,
  type RequestRecord,
  type RouteResult,
  requestEvent,
  requestLogLine,
  requestRecord,
  STATISTICS_ROUTE_PATHS,
  type StatisticsRoute,
  UNKNOWN_PATH,
} from './request-log'
import type { RouteContext } from './route-context'
import { handleSnapshotRequest } from './snapshot-route'
import { handleWebRequest } from './web-route'

/** What a Pages Function receives; `waitUntil` lets reporting finish after the response. */
export interface StatisticsFunctionContext extends BackgroundTasks {
  readonly request: IncomingRequest
  readonly env: StatisticsEnvironment
}

/**
 * How a route's requests are counted. `event`: an `endpoint.request` event per request, sent
 * with the route's own PostHog batch when it has one. `buffered`: counted with the buffered
 * statistics and never sent alone, so no app request leaves a trace of its own in PostHog.
 */
interface RouteDefinition {
  readonly handle: (context: RouteContext) => Promise<RouteResult>
  readonly accounting: 'event' | 'buffered'
}

const ROUTES: Readonly<Record<StatisticsRoute, RouteDefinition>> = {
  events: { handle: handleEventsRequest, accounting: 'buffered' },
  errors: { handle: handleErrorsRequest, accounting: 'event' },
  web: { handle: handleWebRequest, accounting: 'event' },
  snapshot: { handle: handleSnapshotRequest, accounting: 'event' },
  flush: { handle: handleFlushRequest, accounting: 'event' },
}

const ROUTES_BY_PATH: ReadonlyMap<string, StatisticsRoute> = new Map(
  Object.entries(STATISTICS_ROUTE_PATHS).flatMap(([route, path]) =>
    isStatisticsRoute(route) ? [[path, route] as const] : [],
  ),
)

const TRAILING_SLASHES = /\/+$/u

function isStatisticsRoute(value: string): value is StatisticsRoute {
  return Object.hasOwn(ROUTES, value)
}

/** The route serving `pathname`, ignoring a trailing slash. */
export function routeForPath(pathname: string) {
  return ROUTES_BY_PATH.get(pathname.replace(TRAILING_SLASHES, ''))
}

async function sendRequestEvent(
  record: RequestRecord,
  environment: StatisticsEnvironment,
  dependencies: StatisticsDependencies,
) {
  const posthog = postHogSetting(environment)
  if (posthog.status !== 'ready') return
  await sendPostHogEvents(
    [requestEvent(record, dependencies.now())],
    posthog.target,
    dependencies.fetch,
  )
}

function notFound(): RouteResult {
  return {
    response: jsonResponse(HTTP_STATUS.notFound, { error: 'not found' }),
    outcome: 'rejected',
  }
}

function methodNotAllowed(): RouteResult {
  const response = jsonResponse(
    HTTP_STATUS.methodNotAllowed,
    { error: 'use POST' },
    { Allow: 'POST' },
  )
  return { response, outcome: 'rejected', field: 'method' }
}

/**
 * Handles one `/api/v1/*` request. Every request produces exactly one log line, built from its
 * {@link RequestRecord}, and an exception becomes a 500 plus a Sentry report instead of a raw
 * runtime error. Only requests to a route, by POST, are counted in PostHog, so unknown paths
 * and methods cost nothing beyond the log line.
 */
export async function handleStatisticsRequest(
  request: IncomingRequest,
  environment: StatisticsEnvironment,
  tasks: BackgroundTasks,
  dependencies: StatisticsDependencies = runtimeDependencies(),
): Promise<Response> {
  const startedAt = dependencies.now()
  const logOnly = (path: LoggedPath, refused: RouteResult) => {
    const status = refused.response.status
    const record = requestRecord(path, { ...refused, status }, dependencies.now() - startedAt)
    dependencies.log(requestLogLine(record))
    return refused.response
  }
  const route = routeForPath(new URL(request.url).pathname)
  if (route === undefined) return logOnly(UNKNOWN_PATH, notFound())
  const path = STATISTICS_ROUTE_PATHS[route]
  if (request.method !== 'POST') return logOnly(path, methodNotAllowed())
  const definition = ROUTES[route]
  const context: RouteContext = { request, environment, dependencies, path, startedAt }
  let result: RouteResult
  try {
    result = await definition.handle(context)
  } catch (error) {
    result = {
      response: jsonResponse(HTTP_STATUS.internalServerError, { error: 'internal error' }),
      outcome: 'error',
    }
    tasks.waitUntil(reportEndpointException(error, path, environment, dependencies))
  }
  const status = result.response.status
  const record = requestRecord(path, { ...result, status }, dependencies.now() - startedAt)
  dependencies.log(requestLogLine(record))
  if (definition.accounting === 'event' && result.accounted !== true) {
    tasks.waitUntil(sendRequestEvent(record, environment, dependencies))
  }
  return result.response
}
