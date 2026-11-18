/**
 * The flush manifest: the exact set of entries a flush is about to publish, written to KV
 * before the batch goes to PostHog and deleted only once every entry of the set is deleted or
 * tombstoned. A flush that finds a manifest finishes it before selecting anything new.
 */
import { usageStatisticsEpochDay } from '../../src/shared/usage-statistics/validation'
import { bufferExpiration, bufferKeyDay, flushedKey, parseBufferEntry } from './buffer-entry'
import type { KeyValueStore } from './cloudflare'
import { EndpointError } from './exception-report'
import { inKvBatches, MAX_SELECTED_ENTRIES } from './flush-budget'
import type { ReadEntry } from './flush-selection'
import { isRecord, parseJsonText } from './http'

export const FLUSH_MANIFEST_KEY = 'flush-manifest:v1'
const MANIFEST_VERSION = 1

export interface FlushManifest {
  readonly day: string
  readonly keys: readonly string[]
}

function isManifestKeys(value: unknown, day: string): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SELECTED_ENTRIES) {
    return false
  }
  const keys: readonly unknown[] = value
  return keys.every((key) => typeof key === 'string' && bufferKeyDay(key) === day)
}

/** The pending manifest, if any. An unreadable one stops the flush rather than being guessed. */
export async function readFlushManifest(store: KeyValueStore) {
  const text = await store.get(FLUSH_MANIFEST_KEY)
  if (text === null) return undefined
  const parsed = parseJsonText(text)
  const value = parsed.ok && isRecord(parsed.value) ? parsed.value : {}
  const { v, day, keys } = value
  const validDay = typeof day === 'string' && usageStatisticsEpochDay(day) !== undefined
  if (v !== MANIFEST_VERSION || !validDay || !isManifestKeys(keys, day)) {
    throw new EndpointError(`${FLUSH_MANIFEST_KEY} in STATS_KV is unreadable`)
  }
  return { day, keys } satisfies FlushManifest
}

/** Records the set about to be published, expiring with its entries. */
export async function writeFlushManifest(store: KeyValueStore, manifest: FlushManifest) {
  try {
    await store.put(
      FLUSH_MANIFEST_KEY,
      JSON.stringify({ v: MANIFEST_VERSION, day: manifest.day, keys: manifest.keys }),
      { expiration: bufferExpiration(manifest.day) },
    )
    return true
  } catch {
    return false
  }
}

/**
 * The entries of a manifest as they are now. `complete` holds only when every entry is still
 * there, untouched: an entry is deleted or tombstoned only after PostHog accepted its batch, so
 * any missing or tombstoned entry means the batch was accepted, and only retiring is left.
 */
export async function readManifestEntries(store: KeyValueStore, manifest: FlushManifest) {
  const reads = await inKvBatches(manifest.keys, async (key) => ({
    key,
    text: await store.get(key),
    tombstone: await store.get(flushedKey(key)),
  }))
  const entries: ReadEntry[] = []
  for (const { key, text, tombstone } of reads) {
    const entry =
      text === null || tombstone !== null ? undefined : parseBufferEntry(text, manifest.day)
    if (entry !== undefined) entries.push({ key, entry })
  }
  const present = reads.filter(({ text }) => text !== null).map(({ key }) => key)
  return { entries, present, complete: entries.length === manifest.keys.length }
}
