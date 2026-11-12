import { decodeSqlRows } from '../../adapters/sqlite-row-schema'
import {
  sessionActiveRunRowSchema,
  sessionBranchRowSchema,
  sessionBranchStateRowSchema,
  sessionSummaryRowSchema,
  sessionTreeUiStateRowSchema,
} from './types'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type { SessionContentTree } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import type { SessionNodeRow } from '../session-details'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'
import {
  buildSessionNodes,
  fallbackBranches,
  fallbackBranchStates,
  hydrateBranch,
  hydrateBranchState,
  hydrateSessionSummary,
  hydrateUiState,
  interruptedRunsByBranchId,
  sessionSummaryColumns,
  visibleNodeIdForHead,
} from './hydration'
import { attachSessionLineage, loadSessionLineageRows } from './session-list'
import type { SessionBranchRow, SessionBranchStateRow } from './types'

export async function getSessionTree(sessionId: SessionId): Promise<SessionContentTree | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const data = yield* loadSessionTreeRows(sql, sessionId)
      const sessionRow = data.sessionRows[EMPTY_INDEX]
      if (!sessionRow) return null

      const session = attachSessionLineage(
        [hydrateSessionSummary(sessionRow)],
        yield* loadSessionLineageRows(sql, [String(sessionId)]),
      )[EMPTY_INDEX]
      if (!session) return null
      const nodes = buildSessionNodes(data.nodeRows)
      const interruptedRunByBranchId = interruptedRunsByBranchId(data.activeRunRows)

      return {
        session,
        nodes,
        branches: buildTreeBranches(
          session,
          nodes,
          data.nodeRows,
          data.branchRows,
          interruptedRunByBranchId,
        ),
        branchStates: buildTreeBranchStates(session, data.branchStateRows),
        uiState: data.uiStateRows[EMPTY_INDEX]
          ? hydrateUiState(data.uiStateRows[EMPTY_INDEX])
          : null,
      }
    }),
  )
}

function loadSessionTreeRows(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return Effect.gen(function* () {
    const sessionRows = yield* loadSessionRows(sql, sessionId)
    const nodeRows = yield* loadNodeRows(sql, sessionId)
    const branchRows = yield* loadBranchRows(sql, sessionId)
    const branchStateRows = yield* loadBranchStateRows(sql, branchRows)
    const uiStateRows = yield* loadTreeUiRows(sql, sessionId)
    const activeRunRows = yield* loadInterruptedActiveRunRows(sql, sessionId)
    return { sessionRows, nodeRows, branchRows, branchStateRows, uiStateRows, activeRunRows }
  })
}

function loadSessionRows(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql`
    SELECT
      ${sessionSummaryColumns(sql)}
    FROM sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `.pipe(Effect.flatMap(decodeSqlRows(sessionSummaryRowSchema, 'sessions')))
}

function loadNodeRows(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql<SessionNodeRow>`
    SELECT
      id,
      session_id,
      parent_id,
      pi_entry_type,
      kind,
      role,
      timestamp_ms,
      content_json,
      metadata_json,
      branch_hint_id,
      path_depth,
      created_order
    FROM session_nodes
    WHERE session_id = ${sessionId}
    ORDER BY created_order ASC
  `
}

function loadBranchRows(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql`
    SELECT
      id,
      session_id,
      source_node_id,
      head_node_id,
      name,
      is_main,
      archived_at,
      created_at,
      updated_at
    FROM session_branches
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `.pipe(Effect.flatMap(decodeSqlRows(sessionBranchRowSchema, 'session_branches')))
}

function loadBranchStateRows(sql: SqlClient.SqlClient, branchRows: readonly SessionBranchRow[]) {
  return branchRows.length > 0
    ? sql`
        SELECT
          branch_id,
          future_mode,
          waggle_config_json,
          last_active_at,
          ui_state_json
        FROM session_branch_state
        WHERE branch_id IN ${sql.in(branchRows.map((branch) => branch.id))}
      `.pipe(Effect.flatMap(decodeSqlRows(sessionBranchStateRowSchema, 'session_branch_state')))
    : Effect.succeed([])
}

/** The tree's UI state with its read receipt, as every other tree UI state read selects it. */
function loadTreeUiRows(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql`
    SELECT
      session_tree_ui_state.session_id,
      expanded_node_ids_json,
      expanded_node_ids_touched,
      branches_sidebar_collapsed,
      session_visit_receipts.last_visited_at,
      session_tree_ui_state.updated_at
    FROM session_tree_ui_state
    LEFT JOIN session_visit_receipts
      ON session_visit_receipts.session_id = session_tree_ui_state.session_id
    WHERE session_tree_ui_state.session_id = ${sessionId}
    LIMIT 1
  `.pipe(Effect.flatMap(decodeSqlRows(sessionTreeUiStateRowSchema, 'session_tree_ui_state')))
}

function loadInterruptedActiveRunRows(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql`
    SELECT
      run_id,
      session_id,
      branch_id,
      run_mode,
      status,
      runtime_json,
      updated_at
    FROM session_active_runs
    WHERE session_id = ${sessionId}
      AND status = ${'interrupted'}
    ORDER BY updated_at DESC
  `.pipe(Effect.flatMap(decodeSqlRows(sessionActiveRunRowSchema, 'session_active_runs')))
}

function buildTreeBranches(
  session: ReturnType<typeof hydrateSessionSummary>,
  nodes: ReturnType<typeof buildSessionNodes>,
  nodeRows: readonly SessionNodeRow[],
  branchRows: readonly SessionBranchRow[],
  interruptedRunByBranchId: ReturnType<typeof interruptedRunsByBranchId>,
) {
  return branchRows.length > 0
    ? branchRows.map((row) =>
        hydrateBranch(
          { ...row, head_node_id: visibleNodeIdForHead(row.head_node_id, nodeRows) },
          interruptedRunByBranchId,
        ),
      )
    : fallbackBranches(session, nodes, interruptedRunByBranchId)
}

function buildTreeBranchStates(
  session: ReturnType<typeof hydrateSessionSummary>,
  branchStateRows: readonly SessionBranchStateRow[],
) {
  return branchStateRows.length > 0
    ? branchStateRows.map(hydrateBranchState)
    : fallbackBranchStates(session)
}
