import { USAGE_STATISTICS_ORIGIN } from '../../src/shared/usage-statistics/contract'
import { isLikelyBot } from './bot-filter'
import type { IncomingRequest } from './cloudflare'
import { statisticsStore } from './environment'
import { emptyResponse, HTTP_STATUS, jsonResponse, parseJsonBytes, readLimitedBody } from './http'
import {
  type PostHogEvent,
  type PostHogPropertyValue,
  personlessProperties,
  postHogSetting,
  sendPostHogEvents,
} from './posthog'
import { requestCountry } from './request-country'
import type { RouteResult } from './request-log'
import { pendingRequestEvent, type RouteContext } from './route-context'
import { dailySalt, visitorKey } from './visitor-key'
import { referrerDetails, validateWebBeacon, webUrl } from './web-beacon'
import { WEB_BEACON_MAX_BYTES, WEB_UTM_PARAMETERS, type WebBeacon } from './web-beacon-contract'

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLoopbackOrigin(origin: string) {
  const url = webUrl(origin)
  return url?.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

/**
 * Whether the browser itself says not to track: the site's script already sends nothing then,
 * and the endpoint drops any beacon that carries the signal anyway.
 */
export function sendsPrivacySignal(request: IncomingRequest) {
  return request.headers.get('Sec-GPC') === '1' || request.headers.get('DNT') === '1'
}

/**
 * Beacons come only from openwaggle.ai pages, or from a loopback page when the endpoint itself
 * runs on loopback during development. Previews and other sites are refused.
 */
export function isAllowedBeaconOrigin(request: IncomingRequest) {
  const origin = request.headers.get('Origin')
  if (origin === null) return false
  if (origin === USAGE_STATISTICS_ORIGIN) return true
  return isLoopbackOrigin(origin) && isLoopbackOrigin(new URL(request.url).origin)
}

function utmProperties(beacon: WebBeacon) {
  const properties: Record<string, string> = {}
  for (const parameter of WEB_UTM_PARAMETERS) {
    const value = beacon[parameter]
    if (value !== undefined) properties[parameter] = value
  }
  return properties
}

/** The PostHog event of a beacon: `$pageview` or `download_click`, without a person. */
export function webPostHogEvent(
  beacon: WebBeacon,
  input: { readonly visitor: string; readonly country: string; readonly origin: string },
  now: number,
): PostHogEvent {
  const host = new URL(input.origin).hostname
  const source = referrerDetails(beacon, host)
  const properties: Record<string, PostHogPropertyValue> = {
    ...personlessProperties(input.visitor),
    $current_url: `${input.origin}${beacon.path}`,
    $host: host,
    $pathname: beacon.path,
    $referrer: source.referrer,
    $referring_domain: source.referringDomain,
    ...(source.channel === undefined ? {} : { traffic_channel: source.channel }),
    ...utmProperties(beacon),
    country: input.country,
    ...(beacon.type === 'download_click' ? { target: beacon.target } : {}),
  }
  const event = beacon.type === 'pageview' ? '$pageview' : 'download_click'
  return { event, timestamp: new Date(now).toISOString(), properties }
}

function rejectBeacon(status: number, field: string, reason: string): RouteResult {
  return { response: jsonResponse(status, { error: reason }), outcome: 'rejected', field }
}

function skipBeacon(status: number): RouteResult {
  return { response: emptyResponse(status), outcome: 'skipped' }
}

async function readBeacon(request: IncomingRequest) {
  const body = await readLimitedBody(request.body, WEB_BEACON_MAX_BYTES)
  if (!body.ok) {
    const status =
      body.reason === 'too large' ? HTTP_STATUS.payloadTooLarge : HTTP_STATUS.badRequest
    return { ok: false, status, field: 'beacon', reason: `beacon is ${body.reason}` } as const
  }
  const parsed = parseJsonBytes(body.bytes)
  const beacon = validateWebBeacon(parsed.ok ? parsed.value : undefined)
  return beacon.ok ? beacon : { ...beacon, status: HTTP_STATUS.badRequest }
}

/**
 * `POST /api/v1/web`: a page view or download click from openwaggle.ai, forwarded with its
 * `endpoint.request` event in one PostHog batch. The address and User-Agent are read only to
 * derive the daily visitor key and are never stored or forwarded. Skips are told apart by
 * status: 204 for a Do Not Track or Global Privacy Control signal or an automated client, 202
 * without `POSTHOG_PROJECT_KEY`, and 503 for a refused `POSTHOG_HOST` or without `STATS_KV`.
 */
export async function handleWebRequest(context: RouteContext): Promise<RouteResult> {
  const { request, environment, dependencies } = context
  if (!isAllowedBeaconOrigin(request)) {
    return rejectBeacon(HTTP_STATUS.forbidden, 'origin', 'not an openwaggle.ai page')
  }
  const userAgent = request.headers.get('User-Agent') ?? ''
  if (sendsPrivacySignal(request) || isLikelyBot(userAgent)) {
    return skipBeacon(HTTP_STATUS.noContent)
  }
  const beacon = await readBeacon(request)
  if (!beacon.ok) return rejectBeacon(beacon.status, beacon.field, beacon.reason)
  const posthog = postHogSetting(environment)
  if (posthog.status === 'unset') return skipBeacon(HTTP_STATUS.accepted)
  const store = statisticsStore(environment)
  if (posthog.status === 'refused' || store === undefined) {
    return skipBeacon(HTTP_STATUS.serviceUnavailable)
  }
  const now = dependencies.now()
  const origin = new URL(request.url).origin
  const visitor = await visitorKey({
    salt: await dailySalt(store, now, dependencies.randomBytes),
    address: request.headers.get('CF-Connecting-IP') ?? '',
    userAgent,
    host: new URL(origin).host,
  })
  const event = webPostHogEvent(
    beacon.value,
    { visitor, country: requestCountry(request), origin },
    now,
  )
  const accounting = pendingRequestEvent(context, {
    outcome: 'accepted',
    status: HTTP_STATUS.noContent,
  })
  const forwarded = await sendPostHogEvents([event, accounting], posthog.target, dependencies.fetch)
  if (forwarded.ok) {
    return { response: emptyResponse(HTTP_STATUS.noContent), outcome: 'accepted', accounted: true }
  }
  return {
    response: jsonResponse(HTTP_STATUS.badGateway, { error: forwarded.reason }),
    outcome: 'forward_failed',
    accounted: true,
  }
}
