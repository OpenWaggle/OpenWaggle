import {
  type ArchivedItem,
  type ArchivedItemsFacets,
  archivedItemKey,
} from '@shared/types/archived-items'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { archivedItemsQueryOptions } from '@/queries/archived-sessions'
import {
  type ArchivedItemsView,
  archivedItemsFilter,
  DEFAULT_ARCHIVED_ITEMS_VIEW,
  effectiveArchivedSort,
} from '../lib/archived-items-view'

/** Long enough to skip the keystrokes of a word, short enough that results follow the typing. */
const SEARCH_DEBOUNCE_MS = 120

const EMPTY_ITEMS: readonly ArchivedItem[] = []

function useSettledText(text: string) {
  const [settled, setSettled] = useState(text)
  // Clearing the search applies at once and forgets the old text, so typing again right after
  // never shows the cleared search's results while the new text settles.
  if (text.trim() === '' && settled !== text) setSettled(text)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(text), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text])
  return text.trim() === '' ? text : settled
}

/** Pages read by offset can overlap when the archive changes between them; keep the first. */
function uniqueItems(pages: readonly { readonly items: readonly ArchivedItem[] }[]) {
  const seen = new Set<string>()
  return pages.flatMap((page) =>
    page.items.filter((item) => {
      const key = archivedItemKey(item.ref)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  )
}

/**
 * The Settings > Archived items view and its results. The search text settles before it queries,
 * and clearing it applies at once; the facets and sort apply on change. Earlier results stay on
 * screen while the next ones load.
 */
export function useArchivedItemsList() {
  const [view, setView] = useState<ArchivedItemsView>(DEFAULT_ARCHIVED_ITEMS_VIEW)
  const settledText = useSettledText(view.text)
  const queryView = { ...view, text: settledText }
  const filter = archivedItemsFilter(queryView)
  const sort = effectiveArchivedSort(queryView)
  const query = useInfiniteQuery(archivedItemsQueryOptions(filter, sort))
  const pages = query.data?.pages ?? []
  const firstPage = pages[0]
  const facets: ArchivedItemsFacets | null = firstPage?.facets ?? null

  return {
    view,
    updateView: (patch: Partial<ArchivedItemsView>) =>
      setView((current) => ({ ...current, ...patch })),
    resetFacets: () =>
      setView((current) => ({
        ...DEFAULT_ARCHIVED_ITEMS_VIEW,
        text: current.text,
        sort: current.sort,
      })),
    /** The text the shown results were searched with, for highlighting them. */
    searchedText: settledText,
    filter,
    sort,
    items: pages.length === 0 ? EMPTY_ITEMS : uniqueItems(pages),
    total: firstPage?.total ?? 0,
    facets,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => void query.fetchNextPage(),
  }
}

export type ArchivedItemsList = ReturnType<typeof useArchivedItemsList>
