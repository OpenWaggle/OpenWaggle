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

/** A base character and the combining marks after it, folded together. */
const CHARACTER_CLUSTER = /\P{M}\p{M}*|\p{M}+/gu

const DOTTED_I = 'i\u0307'

/** As the archive search folds (see the main store's `foldSearchText`). */
function foldText(value: string) {
  return value.normalize('NFC').toLowerCase().replaceAll(DOTTED_I, 'i')
}

/**
 * `text` Unicode case-folded as the archive search folds it, with, for each folded code unit, the
 * span of the original text it came from. Folding can change length (`İ` lowercases to two
 * units, a decomposed `é` composes to one), so ranges found in the folded text map back here.
 */
function foldedWithSources(text: string) {
  let folded = ''
  const sources: TextRange[] = []
  for (const cluster of text.matchAll(CHARACTER_CLUSTER)) {
    const start = cluster.index
    const part = foldText(cluster[0])
    folded += part
    for (let unit = 0; unit < part.length; unit += 1) {
      sources.push([start, start + cluster[0].length])
    }
  }
  return { folded, sources }
}

/** Where the search words occur in `text`, case-insensitively, merged where they overlap. */
export function searchHighlightRanges(text: string, search: string): readonly TextRange[] {
  const { folded, sources } = foldedWithSources(text)
  const words = [...new Set(foldText(search).split(/\s+/u))].filter((word) => word.length > 0)
  const ranges: [number, number][] = []
  for (const word of words) {
    let from = folded.indexOf(word)
    while (from !== -1) {
      const first = sources[from]
      const last = sources[from + word.length - 1]
      if (first && last) ranges.push([first[0], last[1]])
      from = folded.indexOf(word, from + word.length)
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
