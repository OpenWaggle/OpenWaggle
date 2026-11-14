import type { SchemaType } from '@shared/schema'
import type {
  archivedItemChangeTargetSchema,
  archivedItemRefSchema,
  archivedItemsChangeSchema,
  archivedItemsFilterSchema,
  archivedItemsQuerySchema,
  archivedItemsRefsQuerySchema,
} from '@shared/schemas/archived-items'
import type { SessionId } from './brand'

/**
 * Archived items (CONTEXT.md): the archived sessions and archived branches of active sessions that
 * Settings > Archived items lists, searches, and restores as one collection.
 */
export const ARCHIVED_ITEM_KINDS = ['session', 'branch'] as const

/** The Type facet: one kind, or both. */
export const ARCHIVED_ITEM_KIND_FILTERS = ['all', ...ARCHIVED_ITEM_KINDS] as const
export type ArchivedItemKindFilter = (typeof ARCHIVED_ITEM_KIND_FILTERS)[number]

/**
 * The Archived date facet. The windows are relative to the query's `now` and nest: an item archived
 * in the last day also counts toward the last week and the last month. `older` is the complement
 * of `month`.
 */
export const ARCHIVED_WITHIN_FILTERS = ['any', 'day', 'week', 'month', 'older'] as const
export type ArchivedWithinFilter = (typeof ARCHIVED_WITHIN_FILTERS)[number]

export const ARCHIVED_ITEMS_SORTS = ['match', 'recent', 'oldest'] as const
export type ArchivedItemsSort = (typeof ARCHIVED_ITEMS_SORTS)[number]

export const ARCHIVED_ITEMS_PAGE_LIMIT = 100
export const ARCHIVED_ITEMS_MAX_TEXT_LENGTH = 200
export const ARCHIVED_ITEMS_MAX_TERMS = 8
/** The most items one bulk restore, archive, or Select all can carry. */
export const ARCHIVED_ITEMS_SELECTION_LIMIT = 1_000

export type ArchivedItemRef = SchemaType<typeof archivedItemRefSchema>

export type ArchivedItemsFilter = SchemaType<typeof archivedItemsFilterSchema>

export type ArchivedItemsQuery = SchemaType<typeof archivedItemsQuerySchema>

export type ArchivedItemsRefsQuery = SchemaType<typeof archivedItemsRefsQuerySchema>

/** A transcript excerpt around a match; each range is `[start, end)` in UTF-16 code units. */
export interface ArchivedItemSnippet {
  readonly text: string
  readonly highlights: readonly (readonly [start: number, end: number])[]
}

export interface ArchivedItem {
  readonly ref: ArchivedItemRef
  /** The session title, or the branch name. */
  readonly title: string
  /** For a branch, the title of the session it belongs to. */
  readonly parentTitle: string | null
  readonly projectPath: string | null
  /** Archive time (CONTEXT.md), in epoch milliseconds. */
  readonly archivedAt: number
  readonly snippet: ArchivedItemSnippet | null
}

export interface ArchivedItemsProjectCount {
  readonly projectPath: string | null
  readonly count: number
}

/**
 * Archive facet counts (CONTEXT.md): each facet's counts apply the search text and every other
 * facet, but not its own selection.
 */
export interface ArchivedItemsFacets {
  readonly projects: readonly ArchivedItemsProjectCount[]
  readonly archivedWithin: Readonly<Record<ArchivedWithinFilter, number>>
  readonly kinds: Readonly<Record<ArchivedItemKindFilter, number>>
}

export interface ArchivedItemsPage {
  readonly items: readonly ArchivedItem[]
  /** Every item the query matches, across all pages. */
  readonly total: number
  readonly facets: ArchivedItemsFacets
  readonly nextCursor?: string
}

export interface ArchivedItemRefsPage {
  readonly refs: readonly ArchivedItemRef[]
  readonly total: number
}

export type ArchivedItemChangeTarget = SchemaType<typeof archivedItemChangeTargetSchema>

export type ArchivedItemsChange = SchemaType<typeof archivedItemsChangeSchema>

export interface ArchivedItemChanged {
  readonly ref: ArchivedItemRef
  /** The item's Archive time before the change, or null when it was not archived. */
  readonly archivedAt: number | null
}

export interface ArchivedItemChangeFailure {
  readonly ref: ArchivedItemRef
  readonly message: string
}

export interface ArchivedItemsChangeResult {
  readonly changed: readonly ArchivedItemChanged[]
  /** Already in the requested state, for example restored elsewhere: left untouched. */
  readonly skipped: readonly ArchivedItemRef[]
  readonly failed: readonly ArchivedItemChangeFailure[]
}

export interface ArchivedSessionsDeletionResult {
  readonly deleted: readonly SessionId[]
  /** No longer archived, so kept: Archived items never deletes an active session. */
  readonly skipped: readonly SessionId[]
  /** Already gone, for example deleted in another window. */
  readonly missing: readonly SessionId[]
  readonly failed: readonly { readonly sessionId: SessionId; readonly message: string }[]
}

/**
 * The failure a `requireArchived` delete reports for a session that is no longer archived. It is
 * checked before the session's runs stop, inside the removal fence, and where the deletion is
 * journaled, so a session restored elsewhere is kept.
 */
export const SESSION_NOT_ARCHIVED_MESSAGE = 'The session is no longer archived, so it was kept.'

/** The failure a `requireArchived` delete reports for a session that no longer exists. */
export const SESSION_ALREADY_DELETED_MESSAGE = 'The session was already deleted.'

export function archivedItemKey(ref: ArchivedItemRef) {
  return ref.kind === 'session'
    ? `session:${String(ref.sessionId)}`
    : `branch:${String(ref.sessionId)}:${String(ref.branchId)}`
}
