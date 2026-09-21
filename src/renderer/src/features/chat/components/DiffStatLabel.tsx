import { cn } from '@/shared/lib/cn'

const DIFF_STAT_COMPACT_THRESHOLD = 1000
const DIFF_STAT_COMPACT_MILLION = 1_000_000
const DIFF_STAT_COMPACT_PRECISION = 10

/** Diff stat label mirroring the T3 Code reference: mono, tabular, +green/-red. */
export function hasNonZeroStat(stat: { additions: number; deletions: number }): boolean {
  return stat.additions > 0 || stat.deletions > 0
}

function formatCompactDiffCount(value: number) {
  if (value < DIFF_STAT_COMPACT_THRESHOLD) return String(value)
  if (value < DIFF_STAT_COMPACT_MILLION) {
    const k = value / DIFF_STAT_COMPACT_THRESHOLD
    const rounded =
      k < DIFF_STAT_COMPACT_PRECISION ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)
    return `${rounded}k`
  }
  const m = value / DIFF_STAT_COMPACT_MILLION
  const rounded = m < DIFF_STAT_COMPACT_PRECISION ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)
  return `${rounded}m`
}

interface DiffStatLabelProps {
  readonly additions: number
  readonly deletions: number
  readonly className?: string
  /** `aligned` column-aligns counts across rows (tree rows); `inline` hugs the header count. */
  readonly layout?: 'aligned' | 'inline'
}

export function DiffStatLabel({
  additions,
  deletions,
  className,
  layout = 'aligned',
}: DiffStatLabelProps) {
  return (
    <span
      className={cn(
        layout === 'inline'
          ? 'inline-flex items-center gap-1 tabular-nums align-middle'
          : 'inline-grid grid-cols-[4ch_4ch] gap-2 text-right tabular-nums align-middle',
        className,
      )}
    >
      <span className="sr-only">{`${additions} additions, ${deletions} deletions`}</span>
      <span aria-hidden="true" className="font-mono text-success">
        +{formatCompactDiffCount(additions)}
      </span>
      <span aria-hidden="true" className="font-mono text-error-text">
        -{formatCompactDiffCount(deletions)}
      </span>
    </span>
  )
}
