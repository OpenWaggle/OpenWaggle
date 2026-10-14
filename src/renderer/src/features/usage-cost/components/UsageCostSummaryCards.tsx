import type { UsageCostBucket } from '@shared/types/usage-cost'
import { formatPercent, formatTokenCount, formatUsd, totalCostUsd } from '../lib/usage-cost-format'

interface UsageCostSummaryCardsProps {
  readonly totals: UsageCostBucket
  readonly unpricedShare: number
  readonly sessionCount: number
}

export function UsageCostSummaryCards({
  totals,
  unpricedShare,
  sessionCount,
}: UsageCostSummaryCardsProps) {
  const cacheTokens = totals.tokens.cacheRead
  const inputTokens = totals.tokens.input + cacheTokens
  const cacheHitRate = inputTokens === 0 ? 0 : cacheTokens / inputTokens

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 @min-[720px]/usage:grid-cols-4">
        <SummaryCard
          label="Estimated spend"
          value={formatUsd(totalCostUsd(totals))}
          detail={tierSummary(totals)}
        />
        <SummaryCard
          label="Tokens"
          value={formatTokenCount(totals.tokens.total)}
          detail={`${formatTokenCount(totals.tokens.output)} output`}
        />
        <SummaryCard
          label="Cache hit rate"
          value={inputTokens === 0 ? '—' : formatPercent(cacheHitRate)}
          detail={`${formatTokenCount(cacheTokens)} cached input`}
        />
        <SummaryCard
          label="Sessions"
          value={String(sessionCount)}
          detail="with spending in range"
        />
      </div>
      {totals.unpricedTokens > 0 ? (
        <p className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-tertiary">
          {formatPercent(unpricedShare)} of these tokens have no recorded price and are excluded
          from cost totals. Cost shown is a floor.
        </p>
      ) : null}
    </div>
  )
}

function tierSummary(totals: UsageCostBucket): string {
  const recorded = totals.recordedCostUsd > 0
  const estimated = totals.estimatedCostUsd > 0
  if (recorded && estimated) return 'recorded + estimated'
  if (estimated) return 'estimated from model rates'
  if (recorded) return 'recorded in session history'
  return 'no priced tokens'
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  readonly label: string
  readonly value: string
  readonly detail: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-bg-secondary px-4 py-3">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-lg font-semibold text-text-primary">{value}</span>
      <span className="text-xs text-text-tertiary">{detail}</span>
    </div>
  )
}
