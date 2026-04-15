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
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}
