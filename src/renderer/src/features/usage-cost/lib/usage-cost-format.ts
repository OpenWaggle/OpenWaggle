import type { UsageCostBucket } from '@shared/types/usage-cost'

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 1000) return `$${amount.toFixed(2)}`
  return `$${Math.round(amount).toLocaleString()}`
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
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
