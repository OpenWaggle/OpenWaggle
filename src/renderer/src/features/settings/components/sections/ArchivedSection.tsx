import {
  type ArchivedItem,
  type ArchivedItemRef,
  archivedItemKey,
} from '@shared/types/archived-items'
import { Button } from '@/shared/ui/Button'
import { useArchivedItemActions } from '../../hooks/useArchivedItemActions'
import { type ArchivedItemsList, useArchivedItemsList } from '../../hooks/useArchivedItemsList'
import { useArchivedItemsSelection } from '../../hooks/useArchivedItemsSelection'
import { hasArchivedFacetFilter, isSearching } from '../../lib/archived-items-view'
import { ArchivedEmptyState } from './ArchivedEmptyState'
import { ArchivedErrorAlert } from './ArchivedErrorAlert'
import { ArchivedResults } from './archived/ArchivedResults'
import { ArchivedSelectionBar } from './archived/ArchivedSelectionBar'
import { ArchivedToolbar } from './archived/ArchivedToolbar'

function describeQueryError(error: Error | null) {
  if (!error) return null
  return error.message.trim() || 'Failed to load archived items.'
}

/** Titles of the loaded items, for naming what a restore brought back. */
function titled(refs: readonly ArchivedItemRef[], items: readonly ArchivedItem[]) {
  const titles = new Map(items.map((item) => [archivedItemKey(item.ref), item.title] as const))
  return refs.map((ref) => ({ ref, title: titles.get(archivedItemKey(ref)) ?? '' }))
}

function NoMatches({ list }: { readonly list: ArchivedItemsList }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center text-xs text-text-muted">
      <p>No archived items match.</p>
      {hasArchivedFacetFilter(list.view) ? (
        <Button type="button" variant="link" size="xs" onClick={list.resetFacets}>
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}

/** The toolbar, the results (or why there are none), and the selection bar. */
function ArchivedBrowser({ list }: { readonly list: ArchivedItemsList }) {
  const selection = useArchivedItemsSelection(list.items, JSON.stringify([list.filter, list.sort]))
  const actions = useArchivedItemActions(selection.forget)
  const queryError = describeQueryError(list.error)
  const showLoading = list.isPending && !queryError
  const showNoMatches = !list.isPending && !queryError && list.items.length === 0

  return (
    <>
      <ArchivedToolbar list={list} />
      {actions.actionError ? <ArchivedErrorAlert message={actions.actionError} /> : null}
      {queryError ? <ArchivedErrorAlert message={queryError} subtle /> : null}
      {showLoading ? (
        <output className="flex justify-center py-20 text-xs text-text-muted">
          Loading archived items…
        </output>
      ) : null}
      {showNoMatches ? <NoMatches list={list} /> : null}
      {list.items.length > 0 ? (
        <ArchivedResults
          list={list}
          selection={selection}
          pending={actions.pending}
          actions={{
            toggle: selection.toggle,
            restore: (item) => actions.restore([item]),
            open: (item) => actions.open(item.ref),
            remove: (item) => void actions.remove([item.ref]),
          }}
        />
      ) : null}
      <ArchivedSelectionBar
        selection={selection}
        pending={actions.pending}
        onRestore={() => actions.restore(titled(selection.selected, list.items))}
        onDelete={() => void actions.remove(selection.selected)}
      />
    </>
  )
}

/**
 * Settings > Archived items (CONTEXT.md): every archived session and branch in one list that the
 * search, the Archive facets, and the sort narrow, with bulk restore (and Undo) and delete.
 */
export function ArchivedSection() {
  const list = useArchivedItemsList()
  const filtered = isSearching(list.view) || hasArchivedFacetFilter(list.view)
  const archiveIsEmpty =
    !list.isPending && !list.error && list.total === 0 && !filtered && !list.isPlaceholderData

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-text-primary">Archived sessions and branches</h2>
        <p className="mt-1 text-xs text-text-tertiary">
          Sessions and branches removed from normal navigation. Restore them to bring them back.
        </p>
      </div>
      {archiveIsEmpty ? <ArchivedEmptyState /> : <ArchivedBrowser list={list} />}
    </div>
  )
}
