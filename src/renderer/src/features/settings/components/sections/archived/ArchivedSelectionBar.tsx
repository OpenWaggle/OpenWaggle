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
  const sessionCount = selection.selected.filter((ref) => ref.kind === 'session').length
  const announcement = selection.count === 0 ? '' : `${selection.count.toLocaleString()} selected`

  return (
    <>
      {/* Stays mounted so screen readers announce the count as it changes. */}
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>
      {selection.count === 0 ? null : (
        <SelectionToolbar
          selection={selection}
          pending={pending}
          sessionCount={sessionCount}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      )}
    </>
  )
}

function SelectionToolbar({
  selection,
  pending,
  sessionCount,
  onRestore,
  onDelete,
}: {
  readonly selection: ArchivedItemsSelection
  readonly pending: boolean
  readonly sessionCount: number
  readonly onRestore: () => void
  readonly onDelete: () => void
}) {
  return (
    <div className="sticky bottom-0 z-10 flex justify-center pt-2 pb-1">
      <fieldset
        aria-label="Selected archived items"
        className="m-0 flex min-w-0 items-center gap-2 rounded-lg border border-border-light bg-bg-secondary py-1.5 pr-1.5 pl-3 text-xs text-text-secondary shadow-lg"
      >
        <span className="tabular-nums">
          {selection.count.toLocaleString()} selected
          {selection.atLimit ? ' (the most one action can take)' : null}
        </span>
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
      </fieldset>
    </div>
  )
}
