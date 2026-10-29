import { TRIPLE_FACTOR } from '@shared/constants/math'
import { TIME_UNIT } from '@shared/constants/time'

const FORMAT_DURATION_VALUE_60000 = 60000

/**
 * Format a duration in ms to a human readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < TIME_UNIT.MILLISECONDS_PER_SECOND) return `${ms}ms`
  if (ms < FORMAT_DURATION_VALUE_60000)
    return `${(ms / TIME_UNIT.MILLISECONDS_PER_SECOND).toFixed(1)}s`
  const mins = Math.floor(ms / FORMAT_DURATION_VALUE_60000)
  const secs = Math.floor((ms % FORMAT_DURATION_VALUE_60000) / TIME_UNIT.MILLISECONDS_PER_SECOND)
  return `${mins}m ${secs}s`
}

/**
 * Format a timestamp to a relative time string.
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / TIME_UNIT.MILLISECONDS_PER_SECOND)
  const minutes = Math.floor(seconds / TIME_UNIT.SECONDS_PER_MINUTE)
  const hours = Math.floor(minutes / TIME_UNIT.SECONDS_PER_MINUTE)
  const days = Math.floor(hours / TIME_UNIT.HOURS_PER_DAY)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

/**
 * The same age, compact, for places where the word "ago" is implied by context.
 *
 * A sidebar row's tail has room for a value, not a sentence: "4h ago" is 35px against this
 * form's 21px, and those 14px come out of the session title. Prose contexts keep
 * `formatRelativeTime`, where "Updated 4h" would read as unfinished.
 */
export function formatCompactRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / TIME_UNIT.MILLISECONDS_PER_SECOND)
  const minutes = Math.floor(seconds / TIME_UNIT.SECONDS_PER_MINUTE)
  const hours = Math.floor(minutes / TIME_UNIT.SECONDS_PER_MINUTE)
  const days = Math.floor(hours / TIME_UNIT.HOURS_PER_DAY)

  if (days > 0) return `${String(days)}d`
  if (hours > 0) return `${String(hours)}h`
  if (minutes > 0) return `${String(minutes)}m`
  return 'now'
}

/**
 * Truncate a string to a max length.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength - TRIPLE_FACTOR)}...`
}

/**
 * Extract a short project name from a full path.
 */
export function projectName(path: string | null): string {
  if (!path) return 'No project'
  const parts = path.split(/[\\/]/u).filter((part) => part.length > 0)
  return parts.at(-1) ?? path
}

const USD_SIGNIFICANT_DIGITS = 3
const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: USD_SIGNIFICANT_DIGITS,
})

/** A provider cost in US dollars with three significant digits, so cents-fractions stay visible. */
export function formatUsd(amount: number): string {
  return usdFormat.format(amount)
}

const BYTES_PER_UNIT = 1024
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
/** One decimal below ten units ("2.4 GB"), whole numbers above ("312 MB"). */
const ONE_DECIMAL_BELOW = 10

/** Bytes as people read disk space: 1024-based, short units. */
export function formatBytes(bytes: number) {
  let value = bytes
  let unit = 0
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT
    unit += 1
  }
  const digits = unit > 0 && value < ONE_DECIMAL_BELOW ? 1 : 0
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit] ?? 'B'}`
}
