import * as SqlClient from '@effect/sql/SqlClient'
import { type SessionId, SessionNodeId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { foldSearchText } from './archived-items-sql'

/** Most node ids one tree search returns; the tree panel shows matches, not an index. */
export const SESSION_TREE_SEARCH_MAX_MATCHES = 5_000

/**
 * The Session's node mutation revision (`session_control_states`), or null without a control
 * state row, in which case nothing may be reused across reads.
 */
export async function getSessionNodeMutationRevision(sessionId: SessionId) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly node_mutation_revision: number }>`
        SELECT node_mutation_revision FROM session_control_states
        WHERE session_id = ${sessionId}
        LIMIT 1
      `
      return rows[0]?.node_mutation_revision ?? null
    }),
  )
}

/**
 * The Session tree filter's text match, run where the content is (B5): the tree the window reads
 * carries no content. It reads the per-node transcript search text the search projection keeps
 * (`session_node_search`, at most 12,000 characters a node), through the Session's own rows, and
 * folds case and composition in JavaScript like the archived-items search, since SQLite folds
 * ASCII only. Cost follows the one Session's text, never the corpus.
 */
export async function searchSessionTreeNodes(
  sessionId: SessionId,
  query: string,
): Promise<readonly SessionNodeId[]> {
  const needle = foldSearchText(query.trim().replace(/\s+/gu, ' '))
  if (!needle) return []
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly node_id: string; readonly content: string | null }>`
        SELECT rows.node_id, search.content
        FROM session_node_search_rows AS rows
        JOIN session_node_search AS search ON search.rowid = rows.search_rowid
        WHERE rows.session_id = ${sessionId}
        ORDER BY rows.created_order ASC
      `
      const matches: SessionNodeId[] = []
      for (const row of rows) {
        if (!row.content) continue
        if (!foldSearchText(row.content.replace(/\s+/gu, ' ')).includes(needle)) continue
        matches.push(SessionNodeId(row.node_id))
        if (matches.length >= SESSION_TREE_SEARCH_MAX_MATCHES) break
      }
      return matches
    }),
  )
}
