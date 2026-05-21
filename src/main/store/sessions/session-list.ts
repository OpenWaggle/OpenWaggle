import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionSummary } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import {
  attachArchivedBranchState,
  attachSessionNavigationState,
  hydrateSessionRows,
  normalizeSessionListLimit,
  sessionIdsForQuery,
} from './hydration'
import type {
  SessionActiveRunRow,
  SessionBranchRow,
  SessionSummaryRow,
  SessionTreeUiStateRow,
} from './types'

export async function listSessions(limit?: number): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = hydrateSessionRows(yield* loadSessionSummaryRows(sql, limit))
      if (!sessions) return []

      const sessionIds = sessionIdsForQuery(sessions)
      const branchRows = yield* loadVisibleBranchRows(sql, sessionIds)
      const uiStateRows = yield* loadUiStateRows(sql, sessionIds)
      const activeRunRows = yield* loadInterruptedRunRows(sql, sessionIds)
      return attachSessionNavigationState(sessions, branchRows, uiStateRows, activeRunRows)
    }),
  )
}

export async function listArchivedSessionBranches(limit?: number): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = hydrateSessionRows(yield* loadSessionsWithArchivedBranches(sql, limit))
      if (!sessions) return []

      const branchRows = yield* loadArchivedBranchRows(sql, sessionIdsForQuery(sessions))
      return attachArchivedBranchState(sessions, branchRows)
    }),
  )
}

function loadSessionSummaryRows(sql: SqlClient.SqlClient, limit?: number) {
  return sql<SessionSummaryRow>`
    SELECT
      id,
      title,
      project_path,
      archived,
      created_at,
      updated_at,
      last_active_node_id,
      last_active_branch_id
    FROM sessions
    WHERE archived = 0
    ORDER BY updated_at DESC
    LIMIT ${normalizeSessionListLimit(limit)}
  `
}

function loadVisibleBranchRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return sql<SessionBranchRow>`
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
    WHERE session_id IN ${sql.in(sessionIds)}
    ORDER BY session_id ASC, created_at ASC
  `
}

function loadUiStateRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return sql<SessionTreeUiStateRow>`
    SELECT
      session_id,
      expanded_node_ids_json,
      expanded_node_ids_touched,
      branches_sidebar_collapsed,
      updated_at
    FROM session_tree_ui_state
    WHERE session_id IN ${sql.in(sessionIds)}
  `
}

function loadInterruptedRunRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return sql<SessionActiveRunRow>`
    SELECT
      run_id,
      session_id,
      branch_id,
      run_mode,
      status,
      runtime_json,
      updated_at
    FROM session_active_runs
    WHERE session_id IN ${sql.in(sessionIds)}
      AND status = ${'interrupted'}
    ORDER BY updated_at DESC
  `
}

function loadSessionsWithArchivedBranches(sql: SqlClient.SqlClient, limit?: number) {
  return sql<SessionSummaryRow>`
    SELECT
      id,
      title,
      project_path,
      archived,
      created_at,
      updated_at,
      last_active_node_id,
      last_active_branch_id
    FROM sessions
    WHERE archived = 0
      AND EXISTS (
        SELECT 1
        FROM session_branches
        WHERE session_branches.session_id = sessions.id
          AND session_branches.archived_at IS NOT NULL
      )
    ORDER BY updated_at DESC
    LIMIT ${normalizeSessionListLimit(limit)}
  `
}

function loadArchivedBranchRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return sql<SessionBranchRow>`
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
    WHERE session_id IN ${sql.in(sessionIds)}
      AND archived_at IS NOT NULL
    ORDER BY session_id ASC, archived_at DESC, created_at ASC
  `
}
