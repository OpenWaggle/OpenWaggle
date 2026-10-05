import type { OutboundFetch } from './cloudflare'
import { configuredValue, type StatisticsEnvironment } from './environment'
import { discardBody, encodeUtf8 } from './http'

export type PostHogPropertyValue = string | number | boolean | readonly string[]

export interface PostHogEvent {
  readonly event: string
  /** Set on aggregated records, so each one is a distinct event for PostHog. */
  readonly uuid?: string
  /** ISO 8601 time PostHog files the event under. */
  readonly timestamp: string
  readonly properties: Readonly<Record<string, PostHogPropertyValue>>
}

/** `$lib` of every event the endpoint forwards, so PostHog shows where it came from. */
export const ENDPOINT_LIBRARY = 'openwaggle-statistics-endpoint'
export const ENDPOINT_LIBRARY_VERSION = '1'

/**
 * `distinct_id` of every statistics, endpoint and snapshot event. PostHog requires one; a
 * constant links nothing, so it identifies no Install (ADR 0044).
 */
export const ANONYMOUS_DISTINCT_ID = 'openwaggle-anonymous'

/** The only PostHog host the endpoint forwards to: the EU region (ADR 0045). */
const POSTHOG_EU_HOST = 'https://eu.i.posthog.com'
const BATCH_URL = `${POSTHOG_EU_HOST}/batch/`
/** Below PostHog's batch request limit, so an oversized batch fails here, not halfway there. */
const MAX_BATCH_BYTES = 16_777_216
const FORWARD_TIMEOUT_MS = 10_000

/** Properties that keep PostHog from creating a person profile or geolocating the request. */
export function personlessProperties(distinctId: string) {
  return {
    distinct_id: distinctId,
    $process_person_profile: false,
    $geoip_disable: true,
    $lib: ENDPOINT_LIBRARY,
    $lib_version: ENDPOINT_LIBRARY_VERSION,
  } as const
}

export interface PostHogTarget {
  readonly apiKey: string
  readonly batchUrl: string
}

/**
 * Whether events may go to PostHog: `unset` without `POSTHOG_PROJECT_KEY`, `refused` when
 * `POSTHOG_HOST` names anything but the EU host, so a misconfiguration fails closed.
 */
export type PostHogSetting =
  | { readonly status: 'unset' }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'ready'; readonly target: PostHogTarget }

function isEuHost(host: string) {
  try {
    const url = new URL(host)
    const bare = url.pathname === '/' && url.search === '' && url.hash === ''
    return url.origin === POSTHOG_EU_HOST && bare && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export function postHogSetting(environment: StatisticsEnvironment): PostHogSetting {
  const apiKey = configuredValue(environment.POSTHOG_PROJECT_KEY)
  if (apiKey === undefined) return { status: 'unset' }
  const host = configuredValue(environment.POSTHOG_HOST)
  if (host !== undefined && !isEuHost(host)) {
    return { status: 'refused', reason: `POSTHOG_HOST must be ${POSTHOG_EU_HOST}` }
  }
  return { status: 'ready', target: { apiKey, batchUrl: BATCH_URL } }
}

export type ForwardResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Sends events to PostHog's batch API in exactly one request, so a request is either stored
 * whole or not at all and a retry never duplicates part of it. An empty list sends nothing.
 */
export async function sendPostHogEvents(
  events: readonly PostHogEvent[],
  target: PostHogTarget,
  fetcher: OutboundFetch,
): Promise<ForwardResult> {
  if (events.length === 0) return { ok: true }
  const body = JSON.stringify({ api_key: target.apiKey, batch: events })
  if (encodeUtf8(body).byteLength > MAX_BATCH_BYTES) {
    return { ok: false, reason: 'the PostHog batch is too large' }
  }
  try {
    const response = await fetcher(target.batchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    })
    await discardBody(response)
    if (response.ok) return { ok: true }
    return { ok: false, reason: `PostHog answered ${String(response.status)}` }
  } catch {
    return { ok: false, reason: 'PostHog is unreachable' }
  }
}

const NOON_SUFFIX = 'T12:00:00Z'

/** Midday of a UTC day: statistics carry a day, never a time of day (ADR 0044). */
export function middayTimestamp(day: string) {
  return `${day}${NOON_SUFFIX}`
}
