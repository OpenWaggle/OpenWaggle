import type { UsageCostBucket, UsageCostDay } from '@shared/types/usage-cost'
import { cn } from '@/shared/lib/cn'
import { formatDayLabel, formatTokenCount, formatUsd } from '../lib/usage-cost-format'

interface UsageCostDailyChartProps {
  readonly days: readonly UsageCostDay[]
  readonly totals: UsageCostBucket
  readonly activeDay: string | undefined
  readonly onSelectDay: (day: string) => void
}

const MIN_BAR_FRACTION = 0.04
const MAX_VISIBLE_DAYS = 60

/**
 * One column per day with spending. Long histories compress to the most recent
 * MAX_VISIBLE_DAYS days — the breakdown lists and drill-down still cover the
 * full window, so no data is hidden, only the overview is sampled.
 */
export function UsageCostDailyChart({
  days,
  totals,
  activeDay,
  onSelectDay,
}: UsageCostDailyChartProps) {
  if (days.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary px-4 py-6 text-center text-xs text-text-tertiary">
        No spending recorded in this window yet.
      </div>
    )
  }

  const visibleDays = days.slice(-MAX_VISIBLE_DAYS)
  const maxCost = Math.max(...visibleDays.map((day) => totalOf(day)), 0)
  const hasEstimated = visibleDays.some((day) => day.estimatedCostUsd > 0)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex h-36 items-end gap-1">
        {visibleDays.map((day) => {
          const dayCost = totalOf(day)
          const isActive = activeDay === day.day
          const heightPercent =
            dayCost === 0 ? 0 : Math.max((dayCost / maxCost) * 100, MIN_BAR_FRACTION * 100)
          const estimatedFraction = dayCost === 0 ? 0 : day.estimatedCostUsd / dayCost
          return (
            <button
              key={day.day}
              type="button"
              aria-pressed={isActive}
              title={`${formatDayLabel(day.day)} — ${formatUsd(dayCost)} (${formatTokenCount(day.tokens.total)} tokens)`}
              onClick={() => onSelectDay(day.day)}
              className={cn(
                'group relative flex min-w-1.5 flex-1 flex-col justify-end rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent',
                isActive && 'ring-1 ring-accent',
              )}
              style={{ height: '100%' }}
            >
              <span
                className={cn(
                  'flex w-full flex-col-reverse overflow-hidden rounded-sm transition-opacity group-hover:opacity-80',
                )}
                style={{ height: `${heightPercent}%` }}
              >
                <span className="w-full bg-accent" style={{ flexGrow: 1 - estimatedFraction }} />
                {estimatedFraction > 0 ? (
                  <span className="w-full bg-accent/50" style={{ flexGrow: estimatedFraction }} />
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-text-tertiary">
        <span>{formatDayLabel(visibleDays[0]?.day ?? '')}</span>
        <span className="flex items-center gap-3">
          {hasEstimated ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-accent" /> recorded
              <span className="ml-1 inline-block size-1.5 rounded-full bg-accent/50" /> estimated
            </span>
          ) : null}
          <span>{formatUsd(totalOf(totals))} total</span>
        </span>
        <span>{formatDayLabel(visibleDays[visibleDays.length - 1]?.day ?? '')}</span>
      </div>
    </div>
  )
}

function totalOf(bucket: UsageCostBucket): number {
  return bucket.recordedCostUsd + bucket.estimatedCostUsd
}
