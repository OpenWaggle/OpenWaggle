import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { ArchivedItemsSelection } from '../../../hooks/useArchivedItemsSelection'

/** Bulk actions on the selection; delete applies to its sessions, as branches can only be restored. */
export function ArchivedSelectionBar({
  selection,
  pending,
  onRestore,
  onDelete,
}: {
  readonly selection: ArchivedItemsSelection
  readonly pending: boolean
  readonly onRestore: () => void
  readonly onDelete: () => void
}) {
  if (selection.count === 0) return null
  const sessionCount = selection.selected.filter((ref) => ref.kind === 'session').length

  return (
    <div className="sticky bottom-0 z-10 flex justify-center pt-2 pb-1">
      <output
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border border-border-light bg-bg-secondary py-1.5 pr-1.5 pl-3 text-xs text-text-secondary shadow-lg"
      >
        <span className="tabular-nums">{selection.count.toLocaleString()} selected</span>
        <Button
          type="button"
          variant="primary"
          size="xs"
          radius="md"
          disabled={pending}
          leftIcon={<RotateCcw aria-hidden="true" className="size-3.5" />}
          onClick={onRestore}
        >
          Restore {selection.count.toLocaleString()}
        </Button>
        {sessionCount > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            radius="md"
            disabled={pending}
            leftIcon={<Trash2 aria-hidden="true" className="size-3.5" />}
            onClick={onDelete}
          >
            {sessionCount === selection.count
              ? 'Delete'
              : `Delete ${sessionCount.toLocaleString()} ${sessionCount === 1 ? 'session' : 'sessions'}`}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="xs" radius="md" onClick={selection.clear}>
          Clear
        </Button>
      </output>
    </div>
  )
}
