import type { UsageCostBucket } from '@shared/types/usage-cost'

const MICRO_UNITS = 1_000_000
const TOKEN_SCALE_STEP = 1_000
const CENTS_PRECISION = 2
const SUB_CENT_PRECISION = 4
/** Below this a fixed cent readout would round to $0.00 and look broken. */
const SUB_CENT_THRESHOLD = 0.01
const PERCENT_MULTIPLIER = 100

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < SUB_CENT_THRESHOLD) return `$${amount.toFixed(SUB_CENT_PRECISION)}`
  if (amount < TOKEN_SCALE_STEP) return `$${amount.toFixed(CENTS_PRECISION)}`
  return `$${Math.round(amount).toLocaleString()}`
}

export function formatTokenCount(count: number): string {
  if (count >= MICRO_UNITS * TOKEN_SCALE_STEP)
    return `${(count / (MICRO_UNITS * TOKEN_SCALE_STEP)).toFixed(1)}B`
  if (count >= MICRO_UNITS) return `${(count / MICRO_UNITS).toFixed(1)}M`
  if (count >= TOKEN_SCALE_STEP) return `${(count / TOKEN_SCALE_STEP).toFixed(1)}k`
  return String(count)
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * PERCENT_MULTIPLIER)}%`
}

export function formatDayLabel(day: string): string {
  const [year, month, dayOfMonth] = day.split('-')
  if (year === undefined || month === undefined || dayOfMonth === undefined) return day
  const date = new Date(Number(year), Number(month) - 1, Number(dayOfMonth))
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatTimestampLabel(timestampMs: number | null): string {
  if (timestampMs === null) return 'Unknown time'
  return new Date(timestampMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function totalCostUsd(bucket: UsageCostBucket): number {
  return bucket.recordedCostUsd + bucket.estimatedCostUsd
}

export function usageShareOf(bucket: UsageCostBucket, totals: UsageCostBucket): number {
  return totals.tokens.total === 0 ? 0 : bucket.tokens.total / totals.tokens.total
}
