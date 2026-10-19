import type {
  ArchivedItemKindFilter,
  ArchivedItemsFilter,
  ArchivedItemsSort,
  ArchivedWithinFilter,
} from '@shared/types/archived-items'

/** What Settings > Archived items shows: the search, the three Archive facets, and the sort. */
export interface ArchivedItemsView {
  readonly text: string
  /** `undefined` is every project; `null` is the sessions that have no project. */
  readonly projectPath: string | null | undefined
  readonly archivedWithin: ArchivedWithinFilter
  readonly kind: ArchivedItemKindFilter
  /** `auto` ranks by match while searching and by Archive time otherwise. */
  readonly sort: ArchivedItemsSort | 'auto'
}

export const DEFAULT_ARCHIVED_ITEMS_VIEW: ArchivedItemsView = {
  text: '',
  projectPath: undefined,
  archivedWithin: 'any',
  kind: 'all',
  sort: 'auto',
}

export function hasArchivedFacetFilter(view: ArchivedItemsView) {
  return view.projectPath !== undefined || view.archivedWithin !== 'any' || view.kind !== 'all'
}

export function isSearching(view: Pick<ArchivedItemsView, 'text'>) {
  return view.text.trim().length > 0
}

export function effectiveArchivedSort(view: ArchivedItemsView): ArchivedItemsSort {
  if (view.sort !== 'auto') return view.sort
  return isSearching(view) ? 'match' : 'recent'
}

/** The filter half of a query: omitted fields mean "any", so equal views share one cache key. */
export function archivedItemsFilter(view: ArchivedItemsView): ArchivedItemsFilter {
  const text = view.text.trim()
  return {
    ...(text ? { text } : {}),
    ...(view.projectPath === undefined ? {} : { project: { projectPath: view.projectPath } }),
    ...(view.archivedWithin === 'any' ? {} : { archivedWithin: view.archivedWithin }),
    ...(view.kind === 'all' ? {} : { kind: view.kind }),
  }
}

const DAYS_PER_WEEK = 7

export type ArchivedDateGroup =
  | 'Today'
  | 'Yesterday'
  | 'Earlier this week'
  | 'Earlier this month'
  | 'Earlier this year'
  | 'Older'

function startOfDay(time: number) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date
}

/** Which local-calendar group an Archive time falls in, as of `now`. Weeks start on Monday. */
export function archivedDateGroup(archivedAt: number, now: number): ArchivedDateGroup {
  const today = startOfDay(now)
  if (archivedAt >= today.getTime()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (archivedAt >= yesterday.getTime()) return 'Yesterday'
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - ((today.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK))
  if (archivedAt >= weekStart.getTime()) return 'Earlier this week'
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  if (archivedAt >= monthStart.getTime()) return 'Earlier this month'
  const yearStart = new Date(today.getFullYear(), 0, 1)
  if (archivedAt >= yearStart.getTime()) return 'Earlier this year'
  return 'Older'
}

export type TextRange = readonly [start: number, end: number]

/** Where the search words occur in `text`, case-insensitively, merged where they overlap. */
export function searchHighlightRanges(text: string, search: string): readonly TextRange[] {
  const lower = text.toLowerCase()
  const words = [...new Set(search.toLowerCase().split(/\s+/u))].filter((word) => word.length > 0)
  const ranges: [number, number][] = []
  for (const word of words) {
    let from = lower.indexOf(word)
    while (from !== -1) {
      ranges.push([from, from + word.length])
      from = lower.indexOf(word, from + word.length)
    }
  }
  ranges.sort((left, right) => left[0] - right[0])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}
