/**
 * Which buffered entries one flush call sends: the oldest day that may be published among the
 * keys it lists, read within the call's KV budget. See `handleFlushRequest` in ./flush-route.ts.
 */
import { usageStatisticsEpochDay } from '../../src/shared/usage-statistics/validation'
import {
  BUFFER_KEY_PREFIX,
  type BufferEntry,
  bufferKeyDay,
  flushedKey,
  hasAppEvents,
  parseBufferEntry,
} from './buffer-entry'
import type { KeyValueStore } from './cloudflare'
import { MAX_SELECTED_ENTRIES, type OperationBudget } from './flush-budget'
import { isRecord, parseJsonBytes, readLimitedBody } from './http'

/** Entries one flush adds up at most. */
const FLUSH_MAX_ENTRIES = 50
/**
 * Fewest entries with accepted app events that a recent day is sent with. All records of one
 * flush reach PostHog in one batch with one ingestion time, so a batch made of a single request's
 * entry would hand that Install's day back whole; a recent day waits until it has this many.
 */
export const FLUSH_MIN_DAY_ENTRIES = 5
/**
 * Age at which a day is sent whatever its count: once seven full UTC days, the day itself
 * included, have ended, so a day of 1 October is sent from 8 October. A small install base
 * still gets its statistics within a week, and no entry outlives its retention unsent.
 */
export const FLUSH_AGED_DAY_DAYS = 7
const LIST_LIMIT = 1000
const LIST_MAX_PAGES = 5
const FLUSH_BODY_MAX_BYTES = 4096
const CURSOR_MAX_LENGTH = 1024
/** Entries read for a day at a time, as many as KV serves in parallel. */
const READ_CHUNK = 6
/** KV operations an entry read can cost: its value, then its tombstone. */
const OPERATIONS_PER_READ = 2

interface DayGroup {
  readonly day: string
  readonly keys: readonly string[]
}

export interface ReadEntry {
  readonly key: string
  readonly entry: BufferEntry
}

export interface BufferListing {
  readonly keys: readonly string[]
  /** `false` when more keys follow; `cursor` then lists them. */
  readonly complete: boolean
  readonly cursor?: string
}

/** The cursor the job passes back to list on from where the last call stopped. */
export async function readFlushCursor(request: Request) {
  const body = await readLimitedBody(request.body, FLUSH_BODY_MAX_BYTES)
  if (!body.ok) return { ok: false } as const
  if (body.bytes.byteLength === 0) return { ok: true, cursor: undefined } as const
  const parsed = parseJsonBytes(body.bytes)
  if (!parsed.ok || !isRecord(parsed.value)) return { ok: false } as const
  const { cursor } = parsed.value
  if (cursor === undefined) return { ok: true, cursor: undefined } as const
  const valid = typeof cursor === 'string' && cursor.length <= CURSOR_MAX_LENGTH
  return valid ? ({ ok: true, cursor } as const) : ({ ok: false } as const)
}

/**
 * Buffer keys from `cursor`, or from the start, following KV's cursor: a page can be short,
 * even empty, while more keys follow. Stops after a few pages or when the budget runs low.
 */
export async function listBufferKeys(
  store: KeyValueStore,
  budget: OperationBudget,
  start: string | undefined,
): Promise<BufferListing> {
  const keys: string[] = []
  let cursor = start
  for (let page = 0; page < LIST_MAX_PAGES && budget.allows(1); page += 1) {
    const result = await store.list({
      prefix: BUFFER_KEY_PREFIX,
      limit: LIST_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    })
    keys.push(...result.keys.map(({ name }) => name))
    if (result.list_complete || result.cursor === undefined) {
      return { keys, complete: result.list_complete }
    }
    cursor = result.cursor
  }
  return { keys, complete: false, ...(cursor === undefined ? {} : { cursor }) }
}

/** Listed buffer keys grouped by day, oldest day first. Keys the endpoint did not write are left. */
export function dayGroups(keys: readonly string[]): DayGroup[] {
  const groups = new Map<string, string[]>()
  for (const key of keys) {
    const day = bufferKeyDay(key)
    if (day === undefined) continue
    const group = groups.get(day)
    if (group === undefined) groups.set(day, [key])
    else group.push(key)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, dayKeys]) => ({ day, keys: dayKeys }))
}

/** Whether `day` is old enough to be sent whatever its count. */
export function isAgedDay(day: string, todayEpochDay: number) {
  const dayEpochDay = usageStatisticsEpochDay(day)
  return dayEpochDay !== undefined && todayEpochDay - dayEpochDay >= FLUSH_AGED_DAY_DAYS
}

/**
 * How many of a day's `available` entries to send so that what stays is none or enough. When
 * fewer than enough exist, as for a small aged day, all of them go together.
 */
export function flushTake(available: number) {
  if (available <= FLUSH_MAX_ENTRIES) return available
  const left = available - FLUSH_MAX_ENTRIES
  return left < FLUSH_MIN_DAY_ENTRIES ? available - FLUSH_MIN_DAY_ENTRIES : FLUSH_MAX_ENTRIES
}

/**
 * Reads a day's entries until a flush's worth is found or the budget runs low. A key that reads
 * as nothing was flushed moments ago and is still listed, as KV lists are eventually consistent;
 * a key with a tombstone was published and only its delete failed, so it is `published`; an
 * entry that does not parse is `corrupt`.
 */
async function readDay(store: KeyValueStore, group: DayGroup, budget: OperationBudget) {
  const entries: ReadEntry[] = []
  const corrupt: string[] = []
  const published: string[] = []
  let next = 0
  while (next < group.keys.length && entries.length < MAX_SELECTED_ENTRIES) {
    const keys = group.keys.slice(next, next + READ_CHUNK)
    if (!budget.allows(keys.length * OPERATIONS_PER_READ)) break
    next += keys.length
    const texts = await Promise.all(keys.map(async (key) => ({ key, text: await store.get(key) })))
    const present = texts.filter(
      (read): read is { key: string; text: string } => read.text !== null,
    )
    const tombstones = await Promise.all(present.map(({ key }) => store.get(flushedKey(key))))
    present.forEach(({ key, text }, index) => {
      if (tombstones[index] !== null) {
        published.push(key)
        return
      }
      const entry = parseBufferEntry(text, group.day)
      if (entry === undefined) corrupt.push(key)
      else entries.push({ key, entry })
    })
  }
  return { entries, corrupt, published, unread: group.keys.length - next }
}

export interface FlushSelection {
  readonly day?: string
  readonly entries: readonly ReadEntry[]
  readonly corrupt: readonly string[]
  readonly published: readonly string[]
  readonly remaining: number
  readonly held: number
}

/**
 * Picks the oldest day that may be sent, one with enough entries holding accepted app events or
 * an aged one, and reads up to one flush's worth of its entries. Only entries with accepted app
 * events count toward the threshold; any others are sent along with them.
 */
export async function selectEntries(
  store: KeyValueStore,
  keys: readonly string[],
  todayEpochDay: number,
  budget: OperationBudget,
): Promise<FlushSelection> {
  let remaining = 0
  let held = 0
  const corrupt: string[] = []
  const published: string[] = []
  let chosen: { readonly day: string; readonly entries: readonly ReadEntry[] } | undefined
  for (const group of dayGroups(keys)) {
    const minimum = isAgedDay(group.day, todayEpochDay) ? 1 : FLUSH_MIN_DAY_ENTRIES
    if (group.keys.length < minimum) {
      held += group.keys.length
      continue
    }
    if (chosen !== undefined || !budget.allows(OPERATIONS_PER_READ)) {
      remaining += group.keys.length
      continue
    }
    const read = await readDay(store, group, budget)
    corrupt.push(...read.corrupt)
    published.push(...read.published)
    const appEntries = read.entries.filter(({ entry }) => hasAppEvents(entry))
    if (appEntries.length < minimum) {
      // Too few to send: the day waits for more, unless unread keys may still hold enough.
      if (read.unread > 0) remaining += read.entries.length + read.unread
      else held += read.entries.length
      continue
    }
    const available = appEntries.length + read.unread
    const take = Math.min(appEntries.length, flushTake(available))
    const others = read.entries.filter(({ entry }) => !hasAppEvents(entry))
    const entries = [...appEntries.slice(0, take), ...others].slice(0, MAX_SELECTED_ENTRIES)
    chosen = { day: group.day, entries }
    remaining += available - take
  }
  const selection: FlushSelection = { entries: [], corrupt, published, remaining, held }
  return chosen === undefined ? selection : { ...selection, ...chosen }
}
