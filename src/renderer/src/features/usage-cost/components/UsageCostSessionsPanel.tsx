import type { UsageCostSessionRow } from '@shared/types/usage-cost'
import { X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { UsageCostDrillDown } from '../hooks/use-usage-cost-view'
import {
  formatTimestampLabel,
  formatTokenCount,
  formatUsd,
  totalCostUsd,
} from '../lib/usage-cost-format'

interface UsageCostSessionsPanelProps {
  readonly sessions: readonly UsageCostSessionRow[]
  readonly isLoading: boolean
  readonly drillDown: UsageCostDrillDown
  readonly hasActiveDrillDown: boolean
  readonly onClearDrillDown: () => void
}

const ORIGIN_LABELS = {
  openwaggle: 'OpenWaggle',
  'other-pi-clients': 'pi CLI & other',
} as const

const MAX_VISIBLE_SESSIONS = 20

export function UsageCostSessionsPanel({
  sessions,
  isLoading,
  drillDown,
  hasActiveDrillDown,
  onClearDrillDown,
}: UsageCostSessionsPanelProps) {
  return (
    <section aria-label="Sessions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-secondary">
          Sessions{hasActiveDrillDown ? ' in selection' : ''}
        </h2>
        {hasActiveDrillDown ? (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="gap-1 text-text-tertiary"
            onClick={onClearDrillDown}
          >
            <X className="size-3" />
            Clear selection
          </Button>
        ) : null}
      </div>

      {hasActiveDrillDown ? (
        <SelectionSummary drillDown={drillDown} count={sessions.length} />
      ) : null}

      {isLoading ? (
        <div className="rounded-lg border border-border bg-bg-secondary px-4 py-5 text-center text-xs text-text-tertiary">
          Loading sessions…
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-secondary px-4 py-5 text-center text-xs text-text-tertiary">
          No sessions match the current selection.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-bg-secondary">
          {sessions.slice(0, MAX_VISIBLE_SESSIONS).map((session) => (
            <li key={session.file} className="flex items-center justify-between gap-3 px-3 py-2.5">
              {/* The title leads: a date, a badge and a project name alone left a dozen rows
                  that could not be told apart (#356). */}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className="truncate text-sm text-text-secondary"
                  title={session.title ?? undefined}
                >
                  {session.title ?? 'Untitled session'}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-tertiary">
                  <span className="shrink-0">{formatTimestampLabel(session.startedAtMs)}</span>
                  <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5">
                    {ORIGIN_LABELS[session.origin]}
                  </span>
                  <span className="min-w-0 truncate">
                    {session.projectLabel ?? session.displayCwd ?? 'No working directory recorded'}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-tertiary">
                {formatTokenCount(session.tokens.total)} tok · {formatUsd(totalCostUsd(session))}
              </span>
            </li>
          ))}
          {sessions.length > MAX_VISIBLE_SESSIONS ? (
            <li className="px-3 py-2 text-center text-xs text-text-tertiary">
              {sessions.length - MAX_VISIBLE_SESSIONS} more — narrow the selection
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}

function SelectionSummary({
  drillDown,
  count,
}: {
  readonly drillDown: UsageCostDrillDown
  readonly count: number
}) {
  return (
    <p className="text-xs text-text-tertiary">
      {drillDown.day !== undefined ? `Day ${drillDown.day} · ` : ''}
      {drillDown.provider !== undefined
        ? `${drillDown.provider}/${drillDown.modelId ?? ''} · `
        : ''}
      {drillDown.projectPath !== undefined
        ? `${drillDown.projectLabel ?? drillDown.projectPath ?? 'no working directory'} · `
        : ''}
      {count} session{count === 1 ? '' : 's'}
    </p>
  )
}
