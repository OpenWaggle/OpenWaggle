import type { UsageStatisticsValidation } from '../../src/shared/usage-statistics/validation'
import { firstUnexpectedKey, isRecord } from './http'
import {
  WEB_BEACON_MAX_PATH_LENGTH,
  WEB_BEACON_MAX_REFERRER_LENGTH,
  WEB_BEACON_MAX_UTM_LENGTH,
  WEB_DOWNLOAD_TARGETS,
  WEB_UTM_PARAMETERS,
  type WebBeacon,
  type WebBeaconUtm,
  type WebDownloadTarget,
  type WebUtmParameter,
} from './web-beacon-contract'

const BEACON_KEYS: ReadonlySet<string> = new Set([
  'type',
  'path',
  'referrer',
  'target',
  ...WEB_UTM_PARAMETERS,
])
const PAGE_PATH = /^\/[^\s?#\p{Cc}]*$/u
const UTM_VALUE = /^[^\p{Cc}]+$/u

function failure(field: string, reason: string) {
  return { ok: false, field, reason } as const
}

function isDownloadTarget(value: unknown): value is WebDownloadTarget {
  return WEB_DOWNLOAD_TARGETS.some((target) => target === value)
}

/** Parses an http(s) URL, or returns `undefined`. */
export function webUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined
  } catch {
    return undefined
  }
}

function isPagePath(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= WEB_BEACON_MAX_PATH_LENGTH && PAGE_PATH.test(value)
  )
}

function isReferrer(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > WEB_BEACON_MAX_REFERRER_LENGTH) return false
  return value === '' || webUrl(value) !== undefined
}

function validateUtm(beacon: Readonly<Record<string, unknown>>) {
  const utm: Partial<Record<WebUtmParameter, string>> = {}
  for (const parameter of WEB_UTM_PARAMETERS) {
    const value = beacon[parameter]
    if (value === undefined) continue
    if (
      typeof value !== 'string' ||
      value.length > WEB_BEACON_MAX_UTM_LENGTH ||
      !UTM_VALUE.test(value)
    ) {
      return failure(parameter, 'expected a short campaign tag')
    }
    utm[parameter] = value
  }
  return { ok: true, value: utm } as const
}

/** Validates a website beacon. Unknown fields, unknown types and stray targets are rejected. */
export function validateWebBeacon(value: unknown) {
  if (!isRecord(value)) {
    return failure('beacon', 'expected an object') satisfies UsageStatisticsValidation<WebBeacon>
  }
  if (firstUnexpectedKey(value, BEACON_KEYS) !== undefined) {
    return failure('beacon', 'unknown field') satisfies UsageStatisticsValidation<WebBeacon>
  }
  const { type, path, referrer, target } = value
  if (!isPagePath(path)) {
    return failure('path', 'expected a page path') satisfies UsageStatisticsValidation<WebBeacon>
  }
  if (!isReferrer(referrer)) {
    return failure('referrer', 'expected a page URL') satisfies UsageStatisticsValidation<WebBeacon>
  }
  const utm = validateUtm(value)
  if (!utm.ok) return utm
  const page = { path, referrer, ...utm.value }
  if (type === 'pageview') {
    return (
      target === undefined
        ? { ok: true, value: { type, ...page } }
        : failure('target', 'a page view has no target')
    ) satisfies UsageStatisticsValidation<WebBeacon>
  }
  if (type !== 'download_click') {
    return failure(
      'type',
      'value is not in the published list',
    ) satisfies UsageStatisticsValidation<WebBeacon>
  }
  if (!isDownloadTarget(target)) {
    return failure(
      'target',
      'value is not in the published list',
    ) satisfies UsageStatisticsValidation<WebBeacon>
  }
  return {
    ok: true,
    value: { type, target, ...page },
  } satisfies UsageStatisticsValidation<WebBeacon>
}

export const TRAFFIC_CHANNELS = ['direct', 'search', 'social', 'referral'] as const
export type TrafficChannel = (typeof TRAFFIC_CHANNELS)[number]

const SEARCH_HOSTS: readonly RegExp[] = [
  /^(?:www\.)?google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/u,
  /(?:^|\.)(?:bing\.com|duckduckgo\.com|baidu\.com|ecosia\.org|startpage\.com|kagi\.com)$/u,
  /(?:^|\.)(?:qwant\.com|search\.brave\.com|search\.yahoo\.com|yandex\.(?:com|ru))$/u,
]
const SOCIAL_HOSTS: readonly RegExp[] = [
  /(?:^|\.)(?:t\.co|twitter\.com|x\.com|bsky\.app|mastodon\.social|threads\.net)$/u,
  /(?:^|\.)(?:facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|reddit\.com|tiktok\.com)$/u,
  /(?:^|\.)(?:news\.ycombinator\.com|lobste\.rs|youtube\.com|youtu\.be|discord\.com)$/u,
  /(?:^|\.)(?:producthunt\.com|t\.me)$/u,
]
const SEARCH_SOURCES = /^(?:google|bing|duckduckgo|ddg|yahoo|baidu|yandex|ecosia|brave|kagi)$/iu
const SOCIAL_SOURCES =
  /^(?:twitter|x|bluesky|bsky|mastodon|facebook|instagram|linkedin|reddit|hn|hackernews|youtube|discord|producthunt)$/iu

export interface ReferrerDetails {
  /** PostHog's `$referrer`: the referring origin only, or `$direct`. */
  readonly referrer: string
  /** PostHog's `$referring_domain`: the referring host name, or `$direct`. */
  readonly referringDomain: string
  /** How the visit arrived; absent when the referrer is another openwaggle.ai page. */
  readonly channel?: TrafficChannel
}

function hostChannel(host: string) {
  if (SEARCH_HOSTS.some((pattern) => pattern.test(host))) return 'search' as const
  return SOCIAL_HOSTS.some((pattern) => pattern.test(host))
    ? ('social' as const)
    : ('referral' as const)
}

function campaignChannel(utm: WebBeaconUtm) {
  const source = utm.utm_source
  if (source === undefined) return 'direct' as const
  if (SEARCH_SOURCES.test(source)) return 'search' as const
  return SOCIAL_SOURCES.test(source) ? ('social' as const) : ('referral' as const)
}

const DIRECT = '$direct'

/**
 * Where a visit came from. The referring page is reduced to its origin, so the address of the
 * page that linked to the site is never stored, only its domain.
 */
export function referrerDetails(beacon: WebBeacon, siteHost: string) {
  const url = beacon.referrer === '' ? undefined : webUrl(beacon.referrer)
  if (url === undefined) {
    const details: ReferrerDetails = {
      referrer: DIRECT,
      referringDomain: DIRECT,
      channel: campaignChannel(beacon),
    }
    return details
  }
  const host = url.hostname.toLowerCase()
  if (host === siteHost) {
    const details: ReferrerDetails = { referrer: url.origin, referringDomain: host }
    return details
  }
  const details: ReferrerDetails = {
    referrer: url.origin,
    referringDomain: host,
    channel: hostChannel(host),
  }
  return details
}
