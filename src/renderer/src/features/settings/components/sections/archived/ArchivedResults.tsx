import {
  ARCHIVED_ITEMS_SELECTION_LIMIT,
  type ArchivedItem,
  archivedItemKey,
} from '@shared/types/archived-items'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import type { ArchivedItemsList } from '../../../hooks/useArchivedItemsList'
import type { ArchivedItemsSelection } from '../../../hooks/useArchivedItemsSelection'
import { type ArchivedDateGroup, archivedDateGroup } from '../../../lib/archived-items-view'
import { ArchivedErrorAlert } from '../ArchivedErrorAlert'
import { ArchivedItemRow, type ArchivedItemRowActions } from './ArchivedItemRow'

interface ResultGroup {
  readonly label: ArchivedDateGroup | 'Best matches'
  readonly items: readonly ArchivedItem[]
}

/** Best match is one ranked list; the date sorts group by when each item was archived. */
function resultGroups(items: readonly ArchivedItem[], byMatch: boolean, now: number) {
  if (byMatch) return [{ label: 'Best matches', items }] satisfies ResultGroup[]
  const groups: { label: ArchivedDateGroup; items: ArchivedItem[] }[] = []
  for (const item of items) {
    const label = archivedDateGroup(item.archivedAt, now)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

function SelectAllHeader({
  list,
  selection,
}: {
  readonly list: ArchivedItemsList
  readonly selection: ArchivedItemsSelection
}) {
  const allSelected =
    selection.count > 0 && selection.count >= Math.min(list.total, ARCHIVED_ITEMS_SELECTION_LIMIT)
  const capped = list.total > ARCHIVED_ITEMS_SELECTION_LIMIT
  const label = capped
    ? `Select the first ${ARCHIVED_ITEMS_SELECTION_LIMIT.toLocaleString()}`
    : `Select all ${list.total.toLocaleString()}`
  return (
    <Checkbox
      checked={allSelected}
      disabled={selection.selectingAll || list.total === 0}
      onChange={() => {
        if (allSelected) selection.clear()
        else void selection.selectAll(list.filter, list.sort)
      }}
      label={label}
      labelClassName="px-3 text-xs text-text-tertiary"
    />
  )
}

/** The matching Archived items in groups, with Select all and Load more. */
export function ArchivedResults({
  list,
  selection,
  actions,
  pending,
}: {
  readonly list: ArchivedItemsList
  readonly selection: ArchivedItemsSelection
  readonly actions: ArchivedItemRowActions
  readonly pending: boolean
}) {
  const groups = resultGroups(list.items, list.sort === 'match', Date.now())

  return (
    <div className="space-y-3" aria-busy={list.isPlaceholderData ? true : undefined}>
      <SelectAllHeader list={list} selection={selection} />
      {selection.selectAllError ? (
        <ArchivedErrorAlert message={selection.selectAllError} subtle />
      ) : null}
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="space-y-1">
          <h3 className="px-1 text-xs font-medium text-text-tertiary">{group.label}</h3>
          {group.items.map((item) => (
            <ArchivedItemRow
              key={archivedItemKey(item.ref)}
              item={item}
              searchedText={list.searchedText}
              selected={selection.isSelected(item.ref)}
              pending={pending}
              actions={actions}
            />
          ))}
        </section>
      ))}
      {list.hasNextPage ? (
        <Button
          type="button"
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={list.fetchNextPage}
          className="w-full justify-center"
        >
          {list.isFetchingNextPage ? 'Loading more…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  )
}
