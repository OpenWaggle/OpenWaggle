import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import type {
  ArchivedItem,
  ArchivedItemRef,
  ArchivedItemRefsPage,
  ArchivedItemsFacets,
  ArchivedItemsFilter,
  ArchivedItemsPage,
  ArchivedItemsQuery,
  ArchivedItemsRefsQuery,
} from '@shared/types/archived-items'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { loadMetadataHits } from './archived-items-metadata'
import { loadArchivedItemSnippets } from './archived-items-snippets'
import {
  type ArchivedSearchTerm,
  archivedItemsOrder,
  archivedSearchTerms,
  archivedWithinBounds,
  kindCondition,
  matchedArchivedItemsCtes,
  projectCondition,
  withinCondition,
} from './archived-items-sql'

interface ArchivedItemRow {
  readonly kind: string
  readonly session_id: string
  readonly branch_id: string | null
  readonly title: string
  readonly parent_title: string | null
  readonly project_path: string | null
  readonly archived_at: number
}

/** The facets row, LEFT JOINed to the page: an empty page still brings one row of NULL items. */
interface ArchivedItemsPageRow {
  readonly facets_json: string
  readonly total: number
  readonly kind: string | null
  readonly session_id: string | null
  readonly branch_id: string | null
  readonly title: string | null
  readonly parent_title: string | null
  readonly project_path: string | null
  readonly archived_at: number | null
}

const facetsSchema = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({ projectPath: Schema.NullOr(Schema.String), count: Schema.Number }),
  ),
  archivedWithin: Schema.Struct({
    any: Schema.Number,
    day: Schema.Number,
    week: Schema.Number,
    month: Schema.Number,
    older: Schema.Number,
  }),
  kinds: Schema.Struct({ all: Schema.Number, session: Schema.Number, branch: Schema.Number }),
})

function filterConditions(sql: SqlClient.SqlClient, filter: ArchivedItemsFilter, now: number) {
  const bounds = archivedWithinBounds(now)
  return {
    bounds,
    project: projectCondition(sql, filter.project),
    within: withinCondition(sql, filter.archivedWithin, bounds),
    kind: kindCondition(sql, filter.kind),
  }
}

/**
 * One JSON object of every Archive facet's counts (CONTEXT.md). Each facet counts the matches that
 * pass the other facets, so choosing one of its options shows exactly the count it promised.
 */
function facetsSelect(sql: SqlClient.SqlClient, conditions: ReturnType<typeof filterConditions>) {
  const { bounds } = conditions
  return sql`SELECT json_object(
      'projects', json((
        SELECT json_group_array(json_object('projectPath', project_path, 'count', count))
        FROM (
          SELECT matched.project_path AS project_path, COUNT(*) AS count FROM matched
          WHERE ${conditions.within} AND ${conditions.kind}
          GROUP BY matched.project_path
          ORDER BY count DESC, matched.project_path
        )
      )),
      'archivedWithin', json((
        SELECT json_object(
          'any', COUNT(*),
          'day', COALESCE(SUM(matched.archived_at >= ${bounds.day}), 0),
          'week', COALESCE(SUM(matched.archived_at >= ${bounds.week}), 0),
          'month', COALESCE(SUM(matched.archived_at >= ${bounds.month}), 0),
          'older', COALESCE(SUM(matched.archived_at < ${bounds.month}), 0)
        ) FROM matched WHERE ${conditions.project} AND ${conditions.kind}
      )),
      'kinds', json((
        SELECT json_object(
          'all', COUNT(*),
          'session', COALESCE(SUM(matched.kind = 'session'), 0),
          'branch', COALESCE(SUM(matched.kind = 'branch'), 0)
        ) FROM matched WHERE ${conditions.project} AND ${conditions.within}
      ))
    ) AS facets_json,
    (
      SELECT COUNT(*) FROM matched
      WHERE ${conditions.project} AND ${conditions.within} AND ${conditions.kind}
    ) AS total`
}

function decodeOffset(cursor: string | undefined) {
  return cursor === undefined ? 0 : Number(cursor)
}

function rowRef(row: Pick<ArchivedItemRow, 'kind' | 'session_id' | 'branch_id'>): ArchivedItemRef {
  const sessionId = SessionId(row.session_id)
  return row.kind === 'branch' && row.branch_id !== null
    ? { kind: 'branch', sessionId, branchId: SessionBranchId(row.branch_id) }
    : { kind: 'session', sessionId }
}

function pageItemRow(row: ArchivedItemsPageRow): ArchivedItemRow | null {
  if (row.kind === null || row.session_id === null || row.archived_at === null) return null
  return {
    kind: row.kind,
    session_id: row.session_id,
    branch_id: row.branch_id,
    title: row.title ?? '',
    parent_title: row.parent_title,
    project_path: row.project_path,
    archived_at: row.archived_at,
  }
}

function decodeFacets(json: string | undefined): ArchivedItemsFacets {
  const decoded = safeDecodeUnknown(facetsSchema, parseJsonUnknown(json ?? 'null'))
  if (!decoded.success) {
    throw new Error(`Archived item facets could not be read: ${decoded.issues.join('; ')}`)
  }
  return decoded.data
}

function queryArchivedItemsPage(
  sql: SqlClient.SqlClient,
  query: ArchivedItemsQuery,
  terms: readonly ArchivedSearchTerm[],
  metadataHits: string,
  now: number,
) {
  const conditions = filterConditions(sql, query, now)
  const offset = decodeOffset(query.cursor)
  const order = archivedItemsOrder(sql, query.sort, terms.length > 0)
  return sql<ArchivedItemsPageRow>`
    WITH ${matchedArchivedItemsCtes(sql, terms, metadataHits)},
    facets AS (${facetsSelect(sql, conditions)}),
    page AS (
      SELECT matched.kind, matched.session_id, matched.branch_id, matched.title,
        matched.parent_title, matched.project_path, matched.archived_at,
        row_number() OVER (ORDER BY ${order}) AS ordinal
      FROM matched
      WHERE ${conditions.project} AND ${conditions.within} AND ${conditions.kind}
      ORDER BY ${order}
      LIMIT ${query.limit + 1} OFFSET ${offset}
    )
    SELECT facets.facets_json, facets.total, page.* FROM facets LEFT JOIN page ON 1
    ORDER BY page.ordinal
  `
}

/** Run inside the store's SQL connection; exposed for tests that drive their own runtime. */
export function archivedItemsPageEffect(query: ArchivedItemsQuery, now: number) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const terms = archivedSearchTerms(query.text)
    const metadataHits = yield* loadMetadataHits(sql, terms)
    const rows = yield* queryArchivedItemsPage(sql, query, terms, metadataHits, now)
    const itemRows = rows.flatMap((row) => {
      const item = pageItemRow(row)
      return item ? [item] : []
    })
    const visible = itemRows.slice(0, query.limit)
    const snippets = yield* loadArchivedItemSnippets(sql, visible, terms)
    const items = visible.map(
      (row) =>
        ({
          ref: rowRef(row),
          title: row.title,
          parentTitle: row.parent_title,
          projectPath: row.project_path,
          archivedAt: row.archived_at,
          snippet: snippets.get(row.session_id) ?? null,
        }) satisfies ArchivedItem,
    )
    const offset = decodeOffset(query.cursor)
    return {
      items,
      total: rows[0]?.total ?? 0,
      facets: decodeFacets(rows[0]?.facets_json),
      ...(itemRows.length > query.limit ? { nextCursor: String(offset + query.limit) } : {}),
    } satisfies ArchivedItemsPage
  })
}

export function archivedItemRefsEffect(query: ArchivedItemsRefsQuery, now: number) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const terms = archivedSearchTerms(query.text)
    const conditions = filterConditions(sql, query, now)
    const metadataHits = yield* loadMetadataHits(sql, terms)
    const rows = yield* sql<
      Pick<ArchivedItemRow, 'kind' | 'session_id' | 'branch_id'> & {
        readonly total: number
      }
    >`
      WITH ${matchedArchivedItemsCtes(sql, terms, metadataHits)}
      SELECT matched.kind, matched.session_id, matched.branch_id, COUNT(*) OVER () AS total
      FROM matched
      WHERE ${conditions.project} AND ${conditions.within} AND ${conditions.kind}
      ORDER BY ${archivedItemsOrder(sql, query.sort, terms.length > 0)}
      LIMIT ${query.limit}
    `
    return { refs: rows.map(rowRef), total: rows[0]?.total ?? 0 } satisfies ArchivedItemRefsPage
  })
}

/** One page of Archived items with its Archive facet counts. */
export async function queryArchivedItems(
  query: ArchivedItemsQuery,
  now = Date.now(),
): Promise<ArchivedItemsPage> {
  return runStoreEffect(archivedItemsPageEffect(query, now))
}

/** The references of the Archived items a filter matches, for Select all. */
export async function listArchivedItemRefs(
  query: ArchivedItemsRefsQuery,
  now = Date.now(),
): Promise<ArchivedItemRefsPage> {
  return runStoreEffect(archivedItemRefsEffect(query, now))
}
