import type * as SqlClient from '@effect/sql/SqlClient'
import type { ArchivedItemSnippet } from '@shared/types/archived-items'
import * as Effect from 'effect/Effect'
import { shownInRow } from './archived-items-metadata'
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

interface MatchedTermRow {
  readonly term: string
  readonly search_rowid: number
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
 * The indexed word a prefix token matched in one session, and the search row of the first message
 * holding it, read from the term index's first-node record.
 */
function matchedTerm(sql: SqlClient.SqlClient, sessionId: string, token: string) {
  const range = prefixRange(token)
  return sql<MatchedTermRow>`
    SELECT transcript_terms.term, search_rows.search_rowid
    FROM session_transcript_terms AS transcript_terms
    JOIN session_node_search_rows AS search_rows
      ON search_rows.node_id = transcript_terms.first_node_id
    WHERE transcript_terms.session_id = ${sessionId}
      AND transcript_terms.term >= ${range.from} AND transcript_terms.term < ${range.to}
    ORDER BY transcript_terms.first_created_order
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0] ?? null))
}

/**
 * The transcript excerpt for one session, from the first message holding the first word its row
 * does not explain. FTS5 is asked only for exact indexed words on one row: a prefix query (`f*`)
 * would merge the doclist of every word with that prefix across the corpus, which takes seconds
 * on a large transcript index and blocks the Host's connection.
 */
function sessionSnippet(sql: SqlClient.SqlClient, sessionId: string, tokens: readonly string[]) {
  return Effect.gen(function* () {
    const matches = yield* Effect.forEach(tokens, (token) => matchedTerm(sql, sessionId, token))
    const found = matches.filter((match) => match !== null)
    const [first] = found
    if (!first) return null
    const ftsQuery = [...new Set(found.map((match) => `"${match.term}"`))].join(' OR ')
    const rows = yield* sql<{ readonly snippet: string | null }>`
      SELECT snippet(session_node_search, ${SNIPPET_COLUMN}, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE},
        '…', ${SNIPPET_TOKENS}) AS snippet
      FROM session_node_search
      WHERE session_node_search MATCH ${ftsQuery}
        AND session_node_search.rowid = ${first.search_rowid}
      LIMIT 1
    `
    return rows[0]?.snippet ?? null
  })
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
  const wanted = rows.flatMap((row) => {
    if (row.kind !== 'session') return []
    const tokens = terms.filter((term) => !shownInRow(row, term)).flatMap((term) => term.tokens)
    return tokens.length > 0 ? [{ sessionId: row.session_id, tokens: [...new Set(tokens)] }] : []
  })
  return Effect.forEach(wanted, ({ sessionId, tokens }) =>
    sessionSnippet(sql, sessionId, tokens).pipe(
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
