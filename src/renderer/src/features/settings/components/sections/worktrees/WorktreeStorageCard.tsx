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
  /** The measured worktrees' total; a floor while some are measuring or unreadable. */
  readonly total: number
  readonly measuring: number
  readonly unreadable: number
  readonly measured: number
}

export function storageTotals(
  entries: readonly Pick<WorktreeInventoryEntry, 'path' | 'group'>[],
  space: WorktreeSpaceByPath,
): StorageTotals {
  const byGroup = { safe: 0, decide: 0, 'in-use': 0 }
  let measuring = 0
  let unreadable = 0
  for (const entry of entries) {
    const bytes = space.get(entry.path)
    if (bytes === undefined) measuring += 1
    if (bytes === null) unreadable += 1
    byGroup[entry.group] += bytes ?? 0
  }
  const total = byGroup.safe + byGroup.decide + byGroup['in-use']
  const measured = entries.length - measuring - unreadable
  return { byGroup, total, measuring, unreadable, measured }
}

/** "about X" when every worktree is measured, "at least X" while not, and nothing before any is. */
function headline(totals: StorageTotals) {
  if (totals.measured === 0) return null
  const qualifier = totals.measuring + totals.unreadable === 0 ? 'about' : 'at least'
  return { qualifier, size: formatBytes(totals.total) }
}

/** How much the worktrees take, and the one button that frees the part nothing needs. */
export function WorktreeStorageCard(props: {
  readonly totals: StorageTotals
  readonly safeCount: number
  /** The safe worktrees' size as copy, or null before any is measured. */
  readonly safeSpace: string | null
  readonly worktreeCount: number
  readonly busy: boolean
  readonly onFreeSafe: () => void
}) {
  const { totals } = props
  const summary = headline(totals)
  return (
    <section
      aria-label="Worktree storage"
      className="space-y-3 rounded-lg border border-border bg-bg px-4 py-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-text-tertiary">
            {String(props.worktreeCount)} {props.worktreeCount === 1 ? 'worktree' : 'worktrees'}
            {summary === null ? '' : ` use ${summary.qualifier}`}
          </span>
          <span className="text-xl font-semibold text-text-primary tabular-nums">
            {summary === null ? '—' : summary.size}
          </span>
          <span
            className="text-xs text-text-tertiary"
            aria-live="polite"
            aria-busy={totals.measuring > 0}
          >
            {totals.measuring > 0
              ? `Measuring ${String(totals.measuring)} more…`
              : totals.unreadable > 0
                ? `${String(totals.unreadable)} could not be measured. Files shared with other folders are not counted.`
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
            : props.safeSpace === null
              ? `Free ${String(props.safeCount)} safe ${props.safeCount === 1 ? 'worktree' : 'worktrees'}…`
              : `Free ${props.safeSpace} (${String(props.safeCount)})…`}
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
