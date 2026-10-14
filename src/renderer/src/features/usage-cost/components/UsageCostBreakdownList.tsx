import type { UsageCostBucket } from '@shared/types/usage-cost'
import { cn } from '@/shared/lib/cn'
import { formatTokenCount, formatUsd, totalCostUsd, usageShareOf } from '../lib/usage-cost-format'

export interface UsageCostBreakdownEntry {
  readonly key: string
  readonly label: string
  readonly detail: string
  readonly bucket: UsageCostBucket
  readonly totals: UsageCostBucket
  readonly isActive: boolean
  readonly onSelect: () => void
}

interface UsageCostBreakdownListProps {
  readonly rows: readonly UsageCostBreakdownEntry[]
}

/**
 * A clickable breakdown of one dimension (model, project). Rows show the
 * bucket's token share; selecting a row drills the session list down to it.
 */
export function UsageCostBreakdownList({ rows }: UsageCostBreakdownListProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary px-4 py-5 text-center text-xs text-text-tertiary">
        Nothing to break down in this window yet.
      </div>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-bg-secondary">
      {rows.slice(0, 12).map((row) => (
        <li key={row.key}>
          <button
            type="button"
            aria-pressed={row.isActive}
            onClick={row.onSelect}
            className={cn(
              'flex w-full flex-col gap-1.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover',
              row.isActive && 'bg-bg-active',
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'truncate text-sm',
                  row.isActive ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {row.label}
                {estimatedTierOnly(row.bucket) ? (
                  <span className="ml-1.5 align-middle text-[10px] text-text-tertiary">est.</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-tertiary">
                {formatTokenCount(row.bucket.tokens.total)} tok ·{' '}
                {formatUsd(totalCostUsd(row.bucket))}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(usageShareOf(row.bucket, row.totals) * 100, 1)}%` }}
                />
              </span>
              <span className="max-w-40 truncate text-[11px] text-text-tertiary">{row.detail}</span>
            </span>
          </button>
        </li>
      ))}
      {rows.length > 12 ? (
        <li className="px-3 py-2 text-center text-[11px] text-text-tertiary">
          {rows.length - 12} more — drill down to narrow
        </li>
      ) : null}
    </ul>
  )
}

function estimatedTierOnly(bucket: UsageCostBucket): boolean {
  return bucket.recordedCostUsd === 0 && bucket.estimatedCostUsd > 0
}
