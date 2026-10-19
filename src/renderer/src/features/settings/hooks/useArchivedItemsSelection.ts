import {
  ARCHIVED_ITEMS_SELECTION_LIMIT,
  type ArchivedItem,
  type ArchivedItemRef,
  type ArchivedItemsFilter,
  archivedItemKey,
} from '@shared/types/archived-items'
import { useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'

type Selection = ReadonlyMap<string, ArchivedItemRef>

const EMPTY_SELECTION: Selection = new Map()

function withRefs(selection: Selection, refs: readonly ArchivedItemRef[], selected: boolean) {
  const next = new Map(selection)
  for (const ref of refs) {
    if (selected) next.set(archivedItemKey(ref), ref)
    else next.delete(archivedItemKey(ref))
  }
  return next
}

interface ScopedSelection {
  readonly scope: string
  readonly items: Selection
}

/**
 * Which Archived items are selected for a bulk action. Shift-click selects the run of loaded rows
 * from the last row clicked. Select all asks the Host for every item the current filter matches,
 * so it also covers rows not loaded yet, up to {@link ARCHIVED_ITEMS_SELECTION_LIMIT}.
 *
 * A selection belongs to the filter it was made under (`scope`): changing the search or a facet
 * starts an empty one, so a bulk action never reaches items the list no longer shows.
 */
export function useArchivedItemsSelection(items: readonly ArchivedItem[], scope: string) {
  const [scoped, setScoped] = useState<ScopedSelection>({ scope, items: EMPTY_SELECTION })
  const selection = scoped.scope === scope ? scoped.items : EMPTY_SELECTION
  const setSelection = (update: Selection | ((current: Selection) => Selection)) =>
    setScoped((current) => {
      const base = current.scope === scope ? current.items : EMPTY_SELECTION
      return { scope, items: typeof update === 'function' ? update(base) : update }
    })
  const [selectingAll, setSelectingAll] = useState(false)
  const anchorKey = useRef<string | null>(null)

  const toggle = (item: ArchivedItem, range: boolean) => {
    const key = archivedItemKey(item.ref)
    const selected = !selection.has(key)
    const anchorIndex = items.findIndex(
      (candidate) => archivedItemKey(candidate.ref) === anchorKey.current,
    )
    const index = items.indexOf(item)
    const run =
      range && anchorIndex !== -1 && index !== -1
        ? items.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1)
        : [item]
    anchorKey.current = key
    setSelection((current) =>
      withRefs(
        current,
        run.map((candidate) => candidate.ref),
        selected,
      ),
    )
  }

  const selectAll = async (filter: ArchivedItemsFilter) => {
    setSelectingAll(true)
    try {
      const page = await api.listArchivedItemRefs({
        ...filter,
        limit: ARCHIVED_ITEMS_SELECTION_LIMIT,
      })
      setSelection(withRefs(EMPTY_SELECTION, page.refs, true))
    } finally {
      setSelectingAll(false)
    }
  }

  return {
    selected: [...selection.values()],
    count: selection.size,
    selectingAll,
    isSelected: (ref: ArchivedItemRef) => selection.has(archivedItemKey(ref)),
    toggle,
    selectAll,
    clear: () => {
      anchorKey.current = null
      setSelection(EMPTY_SELECTION)
    },
    /** Drops items a restore or delete took out of the archive. */
    forget: (refs: readonly ArchivedItemRef[]) =>
      setSelection((current) => withRefs(current, refs, false)),
  }
}

export type ArchivedItemsSelection = ReturnType<typeof useArchivedItemsSelection>
