import { bearerTokenMatches } from './bearer-token'
import type { KeyValueStore } from './cloudflare'
import { configuredValue, statisticsStore } from './environment'
import { carriesBrowserOrigin, HTTP_STATUS, jsonResponse } from './http'
import { type PostHogTarget, postHogSetting } from './posthog'
import type { RouteResult } from './request-log'
import type { RouteContext } from './route-context'

/**
 * Answers a job request the endpoint cannot serve as configured. The `skipped` body tells the
 * snapshot workflow that nothing is wrong with the request, so it warns instead of failing.
 */
function notConfigured(reason: string) {
  const result: RouteResult = {
    response: jsonResponse(HTTP_STATUS.serviceUnavailable, { skipped: reason }),
    outcome: 'skipped',
  }
  return result
}

function refused(status: number, field: string, error: string) {
  return {
    response: jsonResponse(status, { error }),
    outcome: 'rejected',
    field,
  } satisfies RouteResult
}

export type JobAdmission =
  | { readonly ok: true; readonly store: KeyValueStore; readonly target: PostHogTarget }
  | { readonly ok: false; readonly result: RouteResult }

/**
 * The checks every request of the daily job passes, `/snapshot` and `/flush` alike: it comes
 * from no browser, carries the bearer token, and the KV binding and PostHog are configured.
 */
export async function admitJobRequest(context: RouteContext) {
  const { request, environment } = context
  if (carriesBrowserOrigin(request)) {
    const admission: JobAdmission = {
      ok: false,
      result: refused(HTTP_STATUS.forbidden, 'origin', 'browser requests are not accepted'),
    }
    return admission
  }
  const token = configuredValue(environment.STATS_SNAPSHOT_TOKEN)
  if (token === undefined) {
    const admission: JobAdmission = {
      ok: false,
      result: notConfigured('STATS_SNAPSHOT_TOKEN is not set'),
    }
    return admission
  }
  if (!(await bearerTokenMatches(request.headers.get('Authorization'), token))) {
    const admission: JobAdmission = {
      ok: false,
      result: refused(HTTP_STATUS.unauthorized, 'authorization', 'invalid token'),
    }
    return admission
  }
  const store = statisticsStore(environment)
  if (store === undefined) {
    const admission: JobAdmission = { ok: false, result: notConfigured('STATS_KV is not bound') }
    return admission
  }
  const posthog = postHogSetting(environment)
  if (posthog.status === 'unset') {
    const admission: JobAdmission = {
      ok: false,
      result: notConfigured('POSTHOG_PROJECT_KEY is not set'),
    }
    return admission
  }
  if (posthog.status === 'refused') {
    const admission: JobAdmission = { ok: false, result: notConfigured(posthog.reason) }
    return admission
  }
  const admission: JobAdmission = { ok: true, store, target: posthog.target }
  return admission
}
