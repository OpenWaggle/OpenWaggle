/**
 * Buffered Usage statistics (ADR 0044, ADR 0045, and Storage in
 * docs/specs/usage-statistics-fields.md). The endpoint never forwards an app request as it
 * arrived: each accepted request becomes one short-lived KV entry of counts, and the flush adds
 * the entries of a day up before anything reaches PostHog.
 *
 * An entry is a compact list of `[event, field, value, count]` rows, one per value seen, plus
 * `[event, field, sum, count]` rows for integer fields. It is keyed `buf:<day>:<random UUID>`
 * and expires a fixed time after its day ends, so neither its key, its content nor its expiry
 * links it to an Install or to when it arrived.
 */
import {
  USAGE_STATISTICS_ENTRY_POINTS,
  type UsageStatisticsContext,
  type UsageStatisticsEvent,
  type UsageStatisticsValue,
} from '../../src/shared/usage-statistics/contract'
import { usageStatisticsEpochDay } from '../../src/shared/usage-statistics/validation'
import { isRecord, parseJsonText } from './http'
import { BUFFERED_REQUESTS_EVENT_NAME } from './request-log'
import { MS_PER_DAY, MS_PER_SECOND } from './time'

export const BUFFER_KEY_PREFIX = 'buf:'
/** Marks a buffer key whose entry was already published, while its delete is still pending. */
export const FLUSHED_KEY_PREFIX = 'flushed:'
/** Days an entry outlives its day: a flush missed for weeks still finds it; then KV drops it. */
const BUFFER_RETENTION_DAYS = 45
const BUFFER_ENTRY_VERSION = 1
const BUFFER_KEY =
  /^buf:(?<day>\d{4}-\d{2}-\d{2}):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const MAX_ROWS = 10_000
const MAX_TEXT_LENGTH = 256
/** Every row has four items: event, field, then value and count or sum and count. */
const ROW_LENGTH = 4
const SUM_INDEX = 2
const COUNT_INDEX = 3

/** Field of the row that counts the events themselves. */
export const COUNT_FIELD = '_count'
const COUNTRY_FIELD = 'country'

/** `[event, field, value, count]`: how many of the entry's events had that value. */
export type CountRow = readonly [event: string, field: string, value: string, count: number]
/** `[event, field, sum, count]`: an integer field added up over that many events. */
export type SumRow = readonly [event: string, field: string, sum: number, count: number]

export interface BufferEntry {
  readonly day: string
  readonly counts: readonly CountRow[]
  readonly sums: readonly SumRow[]
}

export function bufferKey(day: string, uuid: string) {
  return `${BUFFER_KEY_PREFIX}${day}:${uuid}`
}

/** The day of a buffer key, or `undefined` for a key the endpoint did not write. */
export function bufferKeyDay(key: string) {
  return BUFFER_KEY.exec(key)?.groups?.day
}

/** The tombstone of a buffer key, written only when deleting its published entry fails. */
export function flushedKey(key: string) {
  return `${FLUSHED_KEY_PREFIX}${key}`
}

/**
 * Absolute KV expiry, in seconds, of the entries of `day` and of their tombstones: a fixed time
 * after the day ends, never derived from when the entry arrived.
 */
export function bufferExpiration(day: string) {
  const dayEpochDay = usageStatisticsEpochDay(day) ?? 0
  return ((dayEpochDay + 1 + BUFFER_RETENTION_DAYS) * MS_PER_DAY) / MS_PER_SECOND
}

/** Collects the counts of one request, adding equal rows up. */
export class BufferEntryBuilder {
  private readonly countRows = new Map<string, [string, string, string, number]>()
  private readonly sumRows = new Map<string, [string, string, number, number]>()

  count(event: string, field: string, value: string, times = 1) {
    const key = JSON.stringify([event, field, value])
    const row = this.countRows.get(key)
    if (row === undefined) this.countRows.set(key, [event, field, value, times])
    else row[COUNT_INDEX] += times
  }

  sum(event: string, field: string, amount: number, times = 1) {
    const key = JSON.stringify([event, field])
    const row = this.sumRows.get(key)
    if (row === undefined) {
      this.sumRows.set(key, [event, field, amount, times])
      return
    }
    row[SUM_INDEX] += amount
    row[COUNT_INDEX] += times
  }

  get isEmpty() {
    return this.countRows.size === 0 && this.sumRows.size === 0
  }

  build(day: string): BufferEntry {
    return { day, counts: [...this.countRows.values()], sums: [...this.sumRows.values()] }
  }
}

/** The context fields in contract order; a unit test keeps this in step with the contract. */
export function contextEntries(context: UsageStatisticsContext) {
  return [
    ['version', context.version],
    ['build_channel', context.build_channel],
    ['update_channel', context.update_channel],
    ['os', context.os],
    ['arch', context.arch],
  ] as const
}

const ENTRY_POINT_SEPARATOR = '+'

/**
 * The entry points of an `install.active` day as one value, in contract order: `app`, `cli`,
 * `agent`, `app+cli`, `app+agent`, `cli+agent` or `app+cli+agent`. Every such day has at least
 * one entry point, so counting them one by one would let the item counts minus `_count` reveal
 * how many installs used more than one; as one value per entry, the small-cell rules cover it.
 */
export function entryPointCombination(entryPoints: readonly string[]) {
  return USAGE_STATISTICS_ENTRY_POINTS.filter((entryPoint) =>
    entryPoints.includes(entryPoint),
  ).join(ENTRY_POINT_SEPARATOR)
}

function isEntryPointList(event: string, field: string) {
  return event === 'install.active' && field === 'entry_points'
}

function addProperty(
  builder: BufferEntryBuilder,
  event: string,
  field: string,
  value: UsageStatisticsValue,
) {
  if (typeof value === 'number') {
    builder.sum(event, field, value)
    return
  }
  if (typeof value === 'object' && isEntryPointList(event, field)) {
    const combination = entryPointCombination(value)
    if (combination !== '') builder.count(event, field, combination)
    return
  }
  if (typeof value === 'object') {
    for (const item of value) builder.count(event, field, item)
    return
  }
  builder.count(event, field, String(value))
}

/**
 * Adds one validated event: a `_count` row, a row per context field, the country and every
 * property, a row per list item, except that `install.active` entry points are one combination
 * value, and integers as sums.
 */
export function addEventCounts(
  builder: BufferEntryBuilder,
  event: UsageStatisticsEvent,
  context: UsageStatisticsContext,
  country: string,
) {
  builder.count(event.name, COUNT_FIELD, '1')
  for (const [field, value] of contextEntries(context)) builder.count(event.name, field, value)
  builder.count(event.name, COUNTRY_FIELD, country)
  for (const [field, value] of Object.entries(event.properties)) {
    addProperty(builder, event.name, field, value)
  }
}

/** Whether the entry counts at least one accepted app event, beyond its request counts. */
export function hasAppEvents(entry: BufferEntry) {
  return entry.counts.some(([event]) => event !== BUFFERED_REQUESTS_EVENT_NAME)
}

export function serializeBufferEntry(entry: BufferEntry) {
  return JSON.stringify({ v: BUFFER_ENTRY_VERSION, day: entry.day, c: entry.counts, s: entry.sums })
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH
}

function isPositiveCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function rowItems(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: readonly unknown[] = value
  return items.length === ROW_LENGTH ? items : undefined
}

function countRow(value: unknown): CountRow | undefined {
  const items = rowItems(value)
  if (items === undefined) return undefined
  const [event, field, text, count] = items
  if (!isText(event) || !isText(field) || !isText(text) || !isPositiveCount(count)) return undefined
  return [event, field, text, count]
}

function sumRow(value: unknown): SumRow | undefined {
  const items = rowItems(value)
  if (items === undefined) return undefined
  const [event, field, sum, count] = items
  const isSum = typeof sum === 'number' && Number.isSafeInteger(sum) && sum >= 0
  if (!isText(event) || !isText(field) || !isSum || !isPositiveCount(count)) return undefined
  return [event, field, sum, count]
}

function rows<T>(value: unknown, parse: (row: unknown) => T | undefined) {
  if (!Array.isArray(value) || value.length > MAX_ROWS) return undefined
  const items: readonly unknown[] = value
  const parsed: T[] = []
  for (const item of items) {
    const row = parse(item)
    if (row === undefined) return undefined
    parsed.push(row)
  }
  return parsed
}

/** Reads a stored entry, or returns `undefined` when it is not one this version wrote. */
export function parseBufferEntry(text: string, day: string): BufferEntry | undefined {
  const parsed = parseJsonText(text)
  if (!parsed.ok || !isRecord(parsed.value)) return undefined
  const { v, c, s } = parsed.value
  if (v !== BUFFER_ENTRY_VERSION || parsed.value.day !== day) return undefined
  if (usageStatisticsEpochDay(day) === undefined) return undefined
  const counts = rows(c, countRow)
  const sums = rows(s, sumRow)
  return counts === undefined || sums === undefined ? undefined : { day, counts, sums }
}
