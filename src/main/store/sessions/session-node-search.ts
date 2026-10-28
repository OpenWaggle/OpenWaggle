import * as SqlClient from '@effect/sql/SqlClient'
import { type SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionTreeSearchCursor, SessionTreeSearchPage } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { yieldToEventLoop } from '../../utils/event-loop-slice'
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

/** Nodes one page of a tree search reads before it lets the event loop run. */
const SESSION_TREE_SEARCH_PAGE_NODES = 500

interface TreeSearchRow {
  readonly node_id: string
  readonly created_order: number
  readonly content_json: string
  readonly metadata_json: string
  readonly search_content: string | null
}

/** Before every created order: a search from here reads the whole Session. */
const FROM_THE_START = Number.MIN_SAFE_INTEGER

/**
 * The Session tree filter's text match, run where the content is (B5): the tree the window reads
 * carries no content. Like the filter the window ran over full nodes before, it matches each
 * node's own `content_json` and `metadata_json` (tool-call arguments, tool output, model ids,
 * labels, commands) plus the transcript search text (message text without JSON escapes), folding
 * case and composition in JavaScript like the archived-items search, since SQLite folds ASCII
 * only. The search projection alone keeps message text and tool names, not tool arguments or
 * output. Cost follows the one Session's rows, read in pages with an event-loop turn between them,
 * never the corpus.
 *
 * A query stays open in the tree filter while a Run appends nodes, and every append used to read
 * and fold the whole Session again (review V2 P3-1). Given the previous search's cursor, and while
 * the node mutation revision it read still holds (no node it read was updated or deleted, and none
 * was inserted before it), only the nodes after it are read.
 */
export async function searchSessionTreePage(
  sessionId: SessionId,
  query: string,
  after?: SessionTreeSearchCursor,
): Promise<SessionTreeSearchPage> {
  const needle = foldSearchText(query.trim().replace(/\s+/gu, ' '))
  if (!needle) return { nodeIds: [], incremental: false, cursor: null }
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Read before the nodes, so the cursor never labels content newer than its revision.
      const revisionRows = yield* sql<{ readonly node_mutation_revision: number }>`
        SELECT node_mutation_revision FROM session_control_states
        WHERE session_id = ${sessionId}
        LIMIT 1
      `
      const revision = revisionRows[0]?.node_mutation_revision ?? null
      const incremental =
        after !== undefined && revision !== null && after.nodeMutationRevision === revision
      const matches: SessionNodeId[] = []
      // `(session_id, created_order)` is unique, so the created order alone pages the rows.
      let afterCreatedOrder = incremental ? after.throughCreatedOrder : FROM_THE_START
      const page = () => ({
        nodeIds: matches,
        incremental,
        cursor:
          revision === null
            ? null
            : { throughCreatedOrder: afterCreatedOrder, nodeMutationRevision: revision },
      })
      while (true) {
        const rows = yield* sql<TreeSearchRow>`
          SELECT nodes.id AS node_id, nodes.created_order, nodes.content_json,
            nodes.metadata_json, search.content AS search_content
          FROM session_nodes AS nodes
          LEFT JOIN session_node_search_rows AS rows ON rows.node_id = nodes.id
          LEFT JOIN session_node_search AS search ON search.rowid = rows.search_rowid
          WHERE nodes.session_id = ${sessionId}
            AND nodes.created_order > ${afterCreatedOrder}
          ORDER BY nodes.created_order ASC
          LIMIT ${SESSION_TREE_SEARCH_PAGE_NODES}
        `
        for (const row of rows) {
          afterCreatedOrder = row.created_order
          const text = [row.content_json, row.metadata_json, row.search_content ?? ''].join(' ')
          if (!foldSearchText(text.replace(/\s+/gu, ' ')).includes(needle)) continue
          matches.push(SessionNodeId(row.node_id))
          if (matches.length >= SESSION_TREE_SEARCH_MAX_MATCHES) return page()
        }
        if (rows.length < SESSION_TREE_SEARCH_PAGE_NODES) return page()
        yield* yieldToEventLoop
      }
    }),
  )
}
