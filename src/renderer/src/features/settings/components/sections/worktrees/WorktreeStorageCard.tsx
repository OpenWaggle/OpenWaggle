import type {
  WorktreeInventoryEntry,
  WorktreeInventoryGroup,
} from '@shared/types/worktree-inventory'
import { formatBytes } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import type { WorktreeSpaceByPath } from './use-worktree-inventory'

const PERCENT = 100

const SEGMENTS: readonly {
  readonly group: WorktreeInventoryGroup
  readonly label: string
  readonly bar: string
}[] = [
  { group: 'safe', label: 'Safe to remove', bar: 'bg-success' },
  { group: 'decide', label: 'Needs a decision', bar: 'bg-warning' },
  { group: 'in-use', label: 'In use', bar: 'bg-text-tertiary' },
]

export interface StorageTotals {
  readonly byGroup: Readonly<Record<WorktreeInventoryGroup, number>>
  readonly total: number
  readonly measuring: number
}

export function storageTotals(
  entries: readonly WorktreeInventoryEntry[],
  space: WorktreeSpaceByPath,
): StorageTotals {
  const byGroup = { safe: 0, decide: 0, 'in-use': 0 }
  let measuring = 0
  for (const entry of entries) {
    const bytes = space.get(entry.path)
    if (bytes === undefined) measuring += 1
    byGroup[entry.group] += bytes ?? 0
  }
  return { byGroup, total: byGroup.safe + byGroup.decide + byGroup['in-use'], measuring }
}

/** How much the worktrees take, and the one button that frees the part nothing needs. */
export function WorktreeStorageCard(props: {
  readonly totals: StorageTotals
  readonly safeCount: number
  readonly worktreeCount: number
  readonly busy: boolean
  readonly onFreeSafe: () => void
}) {
  const { totals } = props
  const safe = totals.byGroup.safe
  return (
    <section
      aria-label="Worktree storage"
      className="space-y-3 rounded-lg border border-border bg-bg px-4 py-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-text-tertiary">
            {String(props.worktreeCount)} {props.worktreeCount === 1 ? 'worktree' : 'worktrees'} use
            about
          </span>
          <span className="text-xl font-semibold text-text-primary tabular-nums">
            {formatBytes(totals.total)}
          </span>
          <span
            className="text-xs text-text-tertiary"
            aria-live="polite"
            aria-busy={totals.measuring > 0}
          >
            {totals.measuring > 0
              ? `Measuring ${String(totals.measuring)} more…`
              : 'Files shared with other folders, such as a package store, are not counted.'}
          </span>
        </div>
        <Button
          variant={props.safeCount === 0 ? 'secondary' : 'primary'}
          size="sm"
          disabled={props.busy || props.safeCount === 0}
          onClick={props.onFreeSafe}
        >
          {props.safeCount === 0
            ? 'Nothing safe to remove'
            : `Free about ${formatBytes(safe)} (${String(props.safeCount)})…`}
        </Button>
      </div>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-bg-tertiary"
        role="img"
        aria-label={SEGMENTS.map(
          (segment) => `${segment.label} ${formatBytes(totals.byGroup[segment.group])}`,
        ).join(', ')}
      >
        {totals.total > 0
          ? SEGMENTS.map((segment) => (
              <div
                key={segment.group}
                className={segment.bar}
                style={{
                  width: `${String((totals.byGroup[segment.group] / totals.total) * PERCENT)}%`,
                }}
              />
            ))
          : null}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        {SEGMENTS.map((segment) => (
          <li key={segment.group} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2 rounded-full ${segment.bar}`} />
            {segment.label}
            <span className="text-text-tertiary tabular-nums">
              {formatBytes(totals.byGroup[segment.group])}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
