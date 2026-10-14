import type { UsageCostSessionRow } from '@shared/types/usage-cost'
import { X } from 'lucide-react'
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
          <button
            type="button"
            onClick={onClearDrillDown}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            <X className="size-3" />
            Clear selection
          </button>
        ) : null}
      </div>

      {hasActiveDrillDown ? (
        <p className="text-xs text-text-tertiary">
          {drillDown.day !== undefined ? `Day ${drillDown.day} · ` : ''}
          {drillDown.provider !== undefined
            ? `${drillDown.provider}/${drillDown.modelId ?? ''} · `
            : ''}
          {drillDown.cwd !== undefined ? `${drillDown.cwd ?? 'no working directory'} · ` : ''}
          {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </p>
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
          {sessions.slice(0, 20).map((session) => (
            <li key={session.file} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-text-secondary">
                  {formatTimestampLabel(session.startedAtMs)}
                  <span className="ml-2 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                    {ORIGIN_LABELS[session.origin]}
                  </span>
                </span>
                <span className="truncate text-[11px] text-text-tertiary">
                  {session.cwd ?? 'No working directory recorded'}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-tertiary">
                {formatTokenCount(session.tokens.total)} tok · {formatUsd(totalCostUsd(session))}
              </span>
            </li>
          ))}
          {sessions.length > 20 ? (
            <li className="px-3 py-2 text-center text-[11px] text-text-tertiary">
              {sessions.length - 20} more — narrow the selection
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}
