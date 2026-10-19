import type * as SqlClient from '@effect/sql/SqlClient'
import type { ArchivedItemSnippet } from '@shared/types/archived-items'
import * as Effect from 'effect/Effect'
import { type ArchivedSearchTerm, prefixRange } from './archived-items-sql'

const SNIPPET_OPEN = '\u0002'
const SNIPPET_CLOSE = '\u0003'
const SNIPPET_TOKENS = 16
const SNIPPET_COLUMN = 2

interface SnippetSourceRow {
  readonly session_id: string
  readonly kind: string
  readonly title: string
  readonly parent_title: string | null
  readonly project_path: string | null
}

/** Whether the term matched what the row shows anyway: its title, parent title, or project. */
function shownInRow(row: SnippetSourceRow, term: ArchivedSearchTerm) {
  return [row.title, row.parent_title ?? '', row.project_path ?? ''].some((value) =>
    value.toLowerCase().includes(term.text),
  )
}

/** Each token as a quoted prefix query: tokens are letters and digits, so nothing needs escaping. */
function snippetFtsQuery(terms: readonly ArchivedSearchTerm[]) {
  return [...new Set(terms.flatMap((term) => term.tokens))]
    .map((token) => `"${token}"*`)
    .join(' OR ')
}

/** Strips FTS5's highlight markers, keeping where each highlighted run starts and ends. */
export function parseSnippet(raw: string): ArchivedItemSnippet {
  let text = ''
  const highlights: [number, number][] = []
  let open: number | null = null
  for (const character of raw) {
    if (character === SNIPPET_OPEN) {
      open = text.length
      continue
    }
    if (character !== SNIPPET_CLOSE) {
      text += character
      continue
    }
    if (open !== null && text.length > open) highlights.push([open, text.length])
    open = null
  }
  return { text, highlights }
}

/**
 * The transcript excerpt for one session: the first message holding the first token the row's
 * own text does not explain. That message is read straight from the term index's first-node
 * record, so one excerpt costs one indexed FTS5 lookup, never a scan of the transcript corpus.
 */
function sessionSnippet(
  sql: SqlClient.SqlClient,
  sessionId: string,
  token: string,
  ftsQuery: string,
) {
  const range = prefixRange(token)
  return sql<{ readonly snippet: string | null }>`
    SELECT snippet(session_node_search, ${SNIPPET_COLUMN}, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE},
      '…', ${SNIPPET_TOKENS}) AS snippet
    FROM session_node_search
    WHERE session_node_search MATCH ${ftsQuery}
      AND session_node_search.rowid = (
        SELECT search_rows.search_rowid
        FROM session_transcript_terms AS transcript_terms
        JOIN session_node_search_rows AS search_rows
          ON search_rows.node_id = transcript_terms.first_node_id
        WHERE transcript_terms.session_id = ${sessionId}
          AND transcript_terms.term >= ${range.from} AND transcript_terms.term < ${range.to}
        ORDER BY transcript_terms.first_created_order
        LIMIT 1
      )
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]?.snippet ?? null))
}

/**
 * Transcript excerpts for the sessions on one page whose match the title, parent title, and project
 * do not explain on their own; a session matched by what its row already shows gets none.
 */
export function loadArchivedItemSnippets(
  sql: SqlClient.SqlClient,
  rows: readonly SnippetSourceRow[],
  terms: readonly ArchivedSearchTerm[],
) {
  const ftsQuery = snippetFtsQuery(terms)
  const wanted = rows.flatMap((row) => {
    if (row.kind !== 'session' || ftsQuery === '') return []
    const token = terms.find((term) => !shownInRow(row, term))?.tokens[0]
    return token ? [{ sessionId: row.session_id, token }] : []
  })
  return Effect.forEach(wanted, ({ sessionId, token }) =>
    sessionSnippet(sql, sessionId, token, ftsQuery).pipe(
      Effect.map((raw) => [sessionId, raw === null ? null : parseSnippet(raw)] as const),
    ),
  ).pipe(
    Effect.map(
      (entries) =>
        new Map(
          entries.flatMap(([sessionId, snippet]) =>
            snippet ? [[sessionId, snippet] as const] : [],
          ),
        ),
    ),
  )
}
