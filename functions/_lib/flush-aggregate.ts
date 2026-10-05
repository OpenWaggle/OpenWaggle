/**
 * The PostHog records of one day's published totals, each under a UUID derived from what it
 * counts and from the exact entries behind it, so publishing the same entries again is
 * deduplicated by PostHog instead of counted twice.
 */

import { type DayTotals, publishableTotals } from './flush-totals'
import { encodeUtf8 } from './http'
import {
  ANONYMOUS_DISTINCT_ID,
  middayTimestamp,
  type PostHogEvent,
  personlessProperties,
} from './posthog'
import { hexEncode } from './visitor-key'

const UUID_BYTES = 16
const UUID_VERSION_BYTE = 6
const UUID_VARIANT_BYTE = 8
const UUID_VERSION_MASK = 0x0f
const UUID_VERSION_4 = 0x40
const UUID_VARIANT_MASK = 0x3f
const UUID_VARIANT_RFC_4122 = 0x80
const UUID_GROUP_ENDS = [8, 12, 16, 20, 32] as const

async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encodeUtf8(text)))
}

/** A v4-formatted UUID derived from `material`: the same material always gives the same UUID. */
export async function deterministicUuid(material: string) {
  const bytes = (await sha256(material)).slice(0, UUID_BYTES)
  bytes[UUID_VERSION_BYTE] = ((bytes[UUID_VERSION_BYTE] ?? 0) & UUID_VERSION_MASK) | UUID_VERSION_4
  bytes[UUID_VARIANT_BYTE] =
    ((bytes[UUID_VARIANT_BYTE] ?? 0) & UUID_VARIANT_MASK) | UUID_VARIANT_RFC_4122
  const hex = hexEncode(bytes)
  return UUID_GROUP_ENDS.map((end, index) => hex.slice(UUID_GROUP_ENDS[index - 1] ?? 0, end)).join(
    '-',
  )
}

/**
 * The PostHog events of a day's published totals: one per event, field and value with its
 * `count`, and one per integer field with its `sum` and `count`. Each carries the day at 12:00
 * UTC, no other property, and a UUID derived from the sorted keys of the entries it adds up and
 * from what it counts, so a retried flush of the same entries publishes the same UUIDs.
 */
export async function aggregatedEvents(
  totals: DayTotals,
  entryKeys: readonly string[],
): Promise<PostHogEvent[]> {
  const published = publishableTotals(totals)
  const timestamp = middayTimestamp(published.day)
  const base = personlessProperties(ANONYMOUS_DISTINCT_ID)
  const keysDigest = hexEncode(await sha256([...entryKeys].sort().join('\n')))
  const uuid = (kind: string, event: string, field: string, value: string) =>
    deterministicUuid(JSON.stringify([keysDigest, published.day, kind, event, field, value]))
  const counts = published.counts.map(async ([event, field, value, count]) => ({
    event,
    uuid: await uuid('count', event, field, value),
    timestamp,
    properties: { ...base, field, value, count },
  }))
  const sums = published.sums.map(async ([event, field, sum, count]) => ({
    event,
    uuid: await uuid('sum', event, field, ''),
    timestamp,
    properties: { ...base, field, sum, count },
  }))
  return Promise.all([...counts, ...sums])
}
