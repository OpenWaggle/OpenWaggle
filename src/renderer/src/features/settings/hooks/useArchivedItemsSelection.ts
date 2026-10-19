import {
  ARCHIVED_ITEMS_SELECTION_LIMIT,
  type ArchivedItem,
  type ArchivedItemRef,
  type ArchivedItemsFilter,
  type ArchivedItemsSort,
  archivedItemKey,
} from '@shared/types/archived-items'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'

type Selection = ReadonlyMap<string, ArchivedItemRef>

const EMPTY_SELECTION: Selection = new Map()

/** Adds or removes refs, never growing past {@link ARCHIVED_ITEMS_SELECTION_LIMIT}. */
function withRefs(selection: Selection, refs: readonly ArchivedItemRef[], selected: boolean) {
  const next = new Map(selection)
  for (const ref of refs) {
    const key = archivedItemKey(ref)
    if (!selected) {
      next.delete(key)
      continue
    }
    if (next.size < ARCHIVED_ITEMS_SELECTION_LIMIT) next.set(key, ref)
  }
  return next
}

interface ScopedSelection {
  readonly scope: string
  readonly items: Selection
  /** The row the last click started from, for Shift-click ranges. */
  readonly anchorKey: string | null
  readonly selectAllError: string | null
}

function scoped(current: ScopedSelection, scope: string): ScopedSelection {
  return current.scope === scope
    ? current
    : { scope, items: EMPTY_SELECTION, anchorKey: null, selectAllError: null }
}

function describeError(error: unknown) {
  return ipcErrorMessage(error).trim() || 'Could not select every match.'
}

/**
 * Which Archived items are selected for a bulk action. Shift-click selects the run of loaded rows
 * from the last row clicked. Select all asks the Host for the items the current filter matches, in
 * the order the list shows them, so it also covers rows not loaded yet, up to
 * {@link ARCHIVED_ITEMS_SELECTION_LIMIT}.
 *
 * A selection belongs to the filter it was made under (`scope`): changing the search or a facet
 * discards it, so a bulk action never reaches items the list no longer shows, and returning to the
 * earlier filter does not bring it back.
 */
export function useArchivedItemsSelection(items: readonly ArchivedItem[], scope: string) {
  const [state, setState] = useState<ScopedSelection>({
    scope,
    items: EMPTY_SELECTION,
    anchorKey: null,
    selectAllError: null,
  })
  const [selectingAll, setSelectingAll] = useState(false)
  // Adjusting state while rendering (React's documented pattern) discards the old selection the
  // moment the filter changes, so it cannot come back when the filter returns.
  if (state.scope !== scope) setState(scoped(state, scope))
  const current = scoped(state, scope)
  const selection = current.items

  /**
   * Changes the selection made under this render's filter. An async caller (Select all, a bulk
   * restore's clean-up) that settles after the filter changed finds another scope and does
   * nothing, so it never wipes or overwrites the selection made under the new filter.
   */
  const update = (change: (current: ScopedSelection) => Partial<ScopedSelection>) =>
    setState((previous) =>
      previous.scope === scope ? { ...previous, ...change(previous) } : previous,
    )

  const toggle = (item: ArchivedItem, range: boolean) => {
    const key = archivedItemKey(item.ref)
    const selected = !selection.has(key)
    const anchorIndex = items.findIndex(
      (candidate) => archivedItemKey(candidate.ref) === current.anchorKey,
    )
    const index = items.indexOf(item)
    const run =
      range && anchorIndex !== -1 && index !== -1
        ? items.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1)
        : [item]
    update((base) => ({
      anchorKey: key,
      items: withRefs(
        base.items,
        run.map((candidate) => candidate.ref),
        selected,
      ),
    }))
  }

  const selectAll = async (filter: ArchivedItemsFilter, sort: ArchivedItemsSort) => {
    setSelectingAll(true)
    update(() => ({ selectAllError: null }))
    try {
      const page = await api.listArchivedItemRefs({
        ...filter,
        sort,
        limit: ARCHIVED_ITEMS_SELECTION_LIMIT,
      })
      update(() => ({ items: withRefs(EMPTY_SELECTION, page.refs, true) }))
    } catch (error) {
      update(() => ({ selectAllError: describeError(error) }))
    } finally {
      setSelectingAll(false)
    }
  }

  return {
    selected: [...selection.values()],
    count: selection.size,
    selectingAll,
    selectAllError: current.selectAllError,
    /** At {@link ARCHIVED_ITEMS_SELECTION_LIMIT}: unselected rows cannot be added. */
    atLimit: selection.size >= ARCHIVED_ITEMS_SELECTION_LIMIT,
    isSelected: (ref: ArchivedItemRef) => selection.has(archivedItemKey(ref)),
    toggle,
    selectAll,
    clear: () => update(() => ({ items: EMPTY_SELECTION, anchorKey: null })),
    /** Drops items a restore or delete took out of the archive. */
    forget: (refs: readonly ArchivedItemRef[]) =>
      update((base) => ({ items: withRefs(base.items, refs, false) })),
  }
}

export type ArchivedItemsSelection = ReturnType<typeof useArchivedItemsSelection>
