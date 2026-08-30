import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { DelegationState } from '@shared/types/session-collaboration'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import {
  attachArchivedBranchState,
  attachSessionNavigationState,
  hydrateSessionRows,
  normalizeSessionListLimit,
  sessionIdsForQuery,
  sessionSummaryColumns,
} from './hydration'
import type {
  SessionActiveRunRow,
  SessionBranchRow,
  SessionSummaryRow,
  SessionTreeUiStateRow,
} from './types'

interface SessionLineageRow {
  readonly session_id: string
  readonly parent_session_id: string | null
  readonly parent_title: string | null
  readonly hive_root_session_id: string | null
  readonly direct_worker_count: number
  readonly active_direct_worker_count: number
  readonly profile_json: string | null
  readonly delegation_id: string | null
  readonly delegation_state: DelegationState | null
  readonly source_session_id: string | null
  readonly source_title: string | null
  readonly source_node_id: string | null
  readonly derivation_position: 'before' | 'at' | null
}

function agentDefinitionName(profileJson: string | null) {
  if (!profileJson) return undefined
  try {
    const parsed: unknown = JSON.parse(profileJson)
    return typeof parsed === 'object' &&
      parsed !== null &&
      'agentDefinitionName' in parsed &&
      typeof parsed.agentDefinitionName === 'string'
      ? parsed.agentDefinitionName
      : undefined
  } catch {
    return undefined
  }
}

export function attachSessionLineage(
  sessions: readonly SessionSummary[],
  rows: readonly SessionLineageRow[],
) {
  const bySessionId = new Map(rows.map((row) => [row.session_id, row]))
  return sessions.map((session) => {
    const row = bySessionId.get(String(session.id))
    if (!row) return session
    const definitionName = agentDefinitionName(row.profile_json)
    const role: 'worker' | 'queen' | 'independent' = row.parent_session_id
      ? 'worker'
      : row.direct_worker_count > 0
        ? 'queen'
        : 'independent'
    return {
      ...session,
      ...(row.source_session_id && row.source_node_id && row.derivation_position
        ? {
            derivation: {
              sourceSessionId: SessionId(row.source_session_id),
              ...(row.source_title ? { sourceTitle: row.source_title } : {}),
              sourceNodeId: SessionNodeId(row.source_node_id),
              position: row.derivation_position,
            },
          }
        : {}),
      lineage: {
        role,
        ...(row.parent_session_id ? { parentSessionId: SessionId(row.parent_session_id) } : {}),
        ...(row.parent_title ? { parentTitle: row.parent_title } : {}),
        ...(row.hive_root_session_id
          ? { hiveRootSessionId: SessionId(row.hive_root_session_id) }
          : {}),
        directWorkerCount: row.direct_worker_count,
        activeDirectWorkerCount: row.active_direct_worker_count,
        ...(definitionName ? { agentDefinitionName: definitionName } : {}),
        ...(row.delegation_id ? { delegationId: row.delegation_id } : {}),
        ...(row.delegation_state ? { delegationState: row.delegation_state } : {}),
      },
    }
  })
}

export async function listSessions(limit?: number): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const hydrated = hydrateSessionRows(yield* loadSessionSummaryRows(sql, limit))
      const sessions = hydrated
        ? attachSessionLineage(
            hydrated,
            yield* loadSessionLineageRows(sql, sessionIdsForQuery(hydrated)),
          )
        : null
      if (!sessions) return []

      const sessionIds = sessionIdsForQuery(sessions)
      const branchRows = yield* loadVisibleBranchRows(sql, sessionIds)
      const uiStateRows = yield* loadUiStateRows(sql, sessionIds)
      const activeRunRows = yield* loadInterruptedRunRows(sql, sessionIds)
      return attachSessionNavigationState(sessions, branchRows, uiStateRows, activeRunRows)
    }),
  )
}

export function loadSessionLineageRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return sql<SessionLineageRow>`
    SELECT
      sessions.id AS session_id,
      session_spawn_lineage.parent_session_id,
      parent_sessions.title AS parent_title,
      session_spawn_lineage.hive_root_session_id,
      (SELECT COUNT(*) FROM session_spawn_lineage AS direct_lineage
        WHERE direct_lineage.parent_session_id = sessions.id) AS direct_worker_count,
      (SELECT COUNT(*)
        FROM delegation_contracts
        WHERE delegation_contracts.parent_session_id = sessions.id
          AND delegation_contracts.state NOT IN (${'accepted'}, ${'cancelled'}))
        AS active_direct_worker_count,
      session_execution_profiles.profile_json
      , delegation_contracts.id AS delegation_id
      , delegation_contracts.state AS delegation_state
      , session_derivations.source_session_id
      , source_sessions.title AS source_title
      , session_derivations.source_node_id
      , session_derivations.position AS derivation_position
    FROM sessions
    LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
    LEFT JOIN sessions AS parent_sessions ON parent_sessions.id = session_spawn_lineage.parent_session_id
    LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
    LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
    LEFT JOIN session_derivations ON session_derivations.derived_session_id = sessions.id
    LEFT JOIN sessions AS source_sessions ON source_sessions.id = session_derivations.source_session_id
    WHERE sessions.id IN ${sql.in(sessionIds)}
  `
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
      ${sessionSummaryColumns(sql)}
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
      ${sessionSummaryColumns(sql)}
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
