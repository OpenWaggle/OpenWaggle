import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type { SessionTreeUiStatePatch } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX, EXPANDED_NODE_IDS_DEFAULT_JSON } from './constants'
import type { SessionTreeUiStateRow } from './types'

export async function updateSessionTreeUiState(
  sessionId: SessionId,
  patch: SessionTreeUiStatePatch,
) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const existingRows = yield* loadExistingUiState(sql, sessionId)
      const existing = existingRows[EMPTY_INDEX]
      const now = Date.now()

      yield* sql`
        INSERT INTO session_tree_ui_state (
          session_id,
          expanded_node_ids_json,
          expanded_node_ids_touched,
          branches_sidebar_collapsed,
          updated_at
        )
        VALUES (
          ${sessionId},
          ${expandedNodeIdsJson(patch, existing)},
          ${expandedNodeIdsTouched(patch, existing) ? 1 : 0},
          ${branchesSidebarCollapsed(patch, existing) ? 1 : 0},
          ${now}
        )
        ON CONFLICT(session_id) DO UPDATE SET
          expanded_node_ids_json = excluded.expanded_node_ids_json,
          expanded_node_ids_touched = excluded.expanded_node_ids_touched,
          branches_sidebar_collapsed = excluded.branches_sidebar_collapsed,
          updated_at = excluded.updated_at
      `
    }),
  )
}

function loadExistingUiState(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql<SessionTreeUiStateRow>`
    SELECT
      session_id,
      expanded_node_ids_json,
      expanded_node_ids_touched,
      branches_sidebar_collapsed,
      updated_at
    FROM session_tree_ui_state
    WHERE session_id = ${sessionId}
    LIMIT 1
  `
}

function expandedNodeIdsJson(
  patch: SessionTreeUiStatePatch,
  existing: SessionTreeUiStateRow | undefined,
) {
  return patch.expandedNodeIds
    ? JSON.stringify(patch.expandedNodeIds.map((id) => String(id)))
    : (existing?.expanded_node_ids_json ?? EXPANDED_NODE_IDS_DEFAULT_JSON)
}

function expandedNodeIdsTouched(
  patch: SessionTreeUiStatePatch,
  existing: SessionTreeUiStateRow | undefined,
) {
  return patch.expandedNodeIds !== undefined ? true : existing?.expanded_node_ids_touched === 1
}

function branchesSidebarCollapsed(
  patch: SessionTreeUiStatePatch,
  existing: SessionTreeUiStateRow | undefined,
) {
  return patch.branchesSidebarCollapsed ?? existing?.branches_sidebar_collapsed === 1
}
