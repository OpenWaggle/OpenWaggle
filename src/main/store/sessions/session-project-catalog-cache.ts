import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionProjectPage } from '@shared/types/session'
import * as Effect from 'effect/Effect'

interface ProjectPathEntry {
  readonly path: string
  readonly searchKey: string
}

interface ProjectPathCatalog {
  readonly token: string
  readonly entries: readonly ProjectPathEntry[]
}

const catalogs = new WeakMap<SqlClient.SqlClient, ProjectPathCatalog>()
const BINARY_SEARCH_DIVISOR = 2

function firstPathAfter(entries: readonly ProjectPathEntry[], cursor?: string) {
  if (!cursor) return 0
  const cursorBytes = Buffer.from(cursor)
  let start = 0
  let end = entries.length
  while (start < end) {
    const middle = Math.floor((start + end) / BINARY_SEARCH_DIVISOR)
    const entry = entries[middle]
    if (!entry) break
    if (Buffer.compare(Buffer.from(entry.path), cursorBytes) <= 0) {
      start = middle + 1
    } else {
      end = middle
    }
  }
  return start
}

function matchProjectPage(
  entries: readonly ProjectPathEntry[],
  limit: number,
  cursor: string | undefined,
  search: string,
  matchingDisplayNamePaths: readonly string[],
): SessionProjectPage {
  const searchKey = search.normalize('NFC').toLowerCase()
  const aliases = new Set(matchingDisplayNamePaths)
  const paths: string[] = []
  for (let index = firstPathAfter(entries, cursor); index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) break
    if (!aliases.has(entry.path) && !entry.searchKey.includes(searchKey)) continue
    paths.push(entry.path)
    if (paths.length > limit) break
  }
  const page = paths.slice(0, limit)
  const lastPath = page.at(-1)
  return {
    paths: page,
    ...(paths.length > limit && lastPath ? { nextCursor: lastPath } : {}),
  }
}

/** One indexed rebuild per active-project mutation, then in-memory normalized substring search. */
export function searchProjectPage(
  sql: SqlClient.SqlClient,
  limit: number,
  cursor: string | undefined,
  search: string,
  matchingDisplayNamePaths: readonly string[],
) {
  return Effect.gen(function* () {
    const entries = yield* sql.withTransaction(
      Effect.gen(function* () {
        const generations = yield* sql<{ readonly token: string }>`
        SELECT database_id || ':' || generation AS token
        FROM session_project_catalog_generation WHERE singleton = 1
      `
        const token = generations[0]?.token
        if (!token) throw new Error('Session project catalog generation is missing.')
        let catalog = catalogs.get(sql)
        if (catalog?.token !== token) {
          const rows = yield* sql<{ readonly project_path: string }>`
          SELECT DISTINCT project_path
          FROM sessions INDEXED BY idx_sessions_project_catalog_cursor
          WHERE archived = 0 AND project_path IS NOT NULL AND project_path <> ''
          ORDER BY project_path
        `
          catalog = {
            token,
            entries: rows.map((row) => ({
              path: row.project_path,
              searchKey: row.project_path.normalize('NFC').toLowerCase(),
            })),
          }
          catalogs.set(sql, catalog)
        }
        return catalog.entries
      }),
    )
    return matchProjectPage(entries, limit, cursor, search, matchingDisplayNamePaths)
  })
}
