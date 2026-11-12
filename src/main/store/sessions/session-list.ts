import { decodeSqlRows } from '../../adapters/sqlite-row-schema'
import {
  sessionActiveRunRowSchema,
  sessionBranchRowSchema,
  sessionLatestRunRowSchema,
  sessionSummaryRowSchema,
  sessionTreeUiStateRowSchema,
} from './types'
import * as SqlClient from '@effect/sql/SqlClient'
import { LIVE_RUN_STATUSES } from '@shared/domain/running-workers'
import type { SessionSummary } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { attentionCauseSql, parentWillActSql } from '../../adapters/sqlite-hive-next-actor-facts'
import { runStoreEffect } from '../store-runtime'
import {
  attachArchivedBranchState,
  attachSessionNavigationState,
  hydrateSessionRows,
  normalizeSessionListLimit,
  sessionIdsForQuery,
  sessionSummaryColumns,
} from './hydration'
import { attachSessionLineage, type SessionLineageRow } from './session-lineage-hydration'
import type { SessionSummaryRow } from './types'

export { attachSessionLineage } from './session-lineage-hydration'

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
      const latestRunRows = yield* loadLatestRunRows(sql, sessionIds)
      return attachSessionNavigationState(
        sessions,
        branchRows,
        uiStateRows,
        activeRunRows,
        latestRunRows,
      )
    }),
  )
}

export function hydrateSessionNavigationRows(
  sql: SqlClient.SqlClient,
  rows: readonly SessionSummaryRow[],
) {
  return Effect.gen(function* () {
    const hydrated = hydrateSessionRows(rows)
    if (!hydrated) return []
    const sessions = attachSessionLineage(
      hydrated,
      yield* loadSessionLineageRows(sql, sessionIdsForQuery(hydrated)),
    )
    const sessionIds = sessionIdsForQuery(sessions)
    return attachSessionNavigationState(
      sessions,
      yield* loadVisibleBranchRows(sql, sessionIds),
      yield* loadUiStateRows(sql, sessionIds),
      yield* loadInterruptedRunRows(sql, sessionIds),
      yield* loadLatestRunRows(sql, sessionIds),
    )
  })
}

function loadLatestRunRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return sql`
    SELECT session_id, status, updated_at
    FROM (
      SELECT session_id, status, updated_at,
        ROW_NUMBER() OVER (
          PARTITION BY session_id ORDER BY updated_at DESC, id DESC
        ) AS latest_position
      FROM session_runs
      WHERE session_id IN ${sql.in(sessionIds)}
    )
    WHERE latest_position = 1
  `.pipe(Effect.flatMap(decodeSqlRows(sessionLatestRunRowSchema, 'session runs')))
}

/**
 * Each requested Session's Running Workers and when the last Run below it ended (ADR 0065): the
 * whole Spawn-lineage subtree at any depth, never retired task-runner lineage. The Host counts so
 * a Worker on a page the window never loaded still keeps its parent Working.
 */
function workerRunFactsCte(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return sql`
    WITH RECURSIVE workers_below(ancestor_id, session_id) AS (
      SELECT parent_session_id, child_session_id
      FROM session_spawn_lineage
      WHERE parent_session_id IN ${sql.in(sessionIds)}
      UNION ALL
      SELECT workers_below.ancestor_id, deeper.child_session_id
      FROM session_spawn_lineage AS deeper
      JOIN workers_below ON deeper.parent_session_id = workers_below.session_id
    ),
    worker_run_facts AS (
      SELECT
        workers_below.ancestor_id,
        COUNT(DISTINCT CASE WHEN worker_runs.status IN ${sql.in([...LIVE_RUN_STATUSES])}
          THEN worker_runs.session_id END) AS running_worker_count,
        MAX(CASE WHEN worker_runs.status NOT IN ${sql.in([...LIVE_RUN_STATUSES])}
          THEN worker_runs.updated_at END) AS workers_last_run_ended_at
      FROM workers_below
      JOIN session_runs AS worker_runs ON worker_runs.session_id = workers_below.session_id
      GROUP BY workers_below.ancestor_id
    )
  `
}

export function loadSessionLineageRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return sql<SessionLineageRow>`
    ${workerRunFactsCte(sql, sessionIds)}
    SELECT
      sessions.id AS session_id,
      COALESCE(session_spawn_lineage.parent_session_id, legacy_lineage.parent_session_id)
        AS parent_session_id,
      parent_sessions.title AS parent_title,
      session_spawn_lineage.hive_root_session_id,
      ((SELECT COUNT(*) FROM session_spawn_lineage AS direct_lineage
        WHERE direct_lineage.parent_session_id = sessions.id)
       + (SELECT COUNT(*) FROM session_lineage AS historical_lineage
        WHERE historical_lineage.parent_session_id = sessions.id
          AND NOT EXISTS (SELECT 1 FROM session_spawn_lineage AS live_lineage
            WHERE live_lineage.child_session_id = historical_lineage.session_id)))
        AS direct_worker_count,
      (SELECT COUNT(*)
        FROM delegation_contracts
        WHERE delegation_contracts.parent_session_id = sessions.id
          AND delegation_contracts.state NOT IN (${'ready_for_review'}, ${'accepted'}, ${'cancelled'}))
        AS active_direct_worker_count,
      COALESCE(worker_run_facts.running_worker_count, 0) AS running_worker_count,
      worker_run_facts.workers_last_run_ended_at,
      session_execution_profiles.profile_json
      , legacy_lineage.agent_definition_name AS legacy_agent_definition_name
      , (legacy_lineage.session_id IS NOT NULL
         AND session_spawn_lineage.child_session_id IS NULL) AS historical_lineage
      , delegation_contracts.id AS delegation_id
      , COALESCE(delegation_contracts.state, legacy_lineage.delegation_state)
        AS delegation_state
      , ${sql.literal(attentionCauseSql('delegation_contracts'))} AS attention_cause
      , CASE WHEN delegation_contracts.id IS NULL THEN NULL
          ELSE ${sql.literal(parentWillActSql('delegation_contracts'))} END AS parent_will_act
      , session_derivations.source_session_id
      , source_sessions.title AS source_title
      , session_derivations.source_node_id
      , session_derivations.position AS derivation_position
    FROM sessions
    LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
    LEFT JOIN session_lineage AS legacy_lineage ON legacy_lineage.session_id = sessions.id
    LEFT JOIN sessions AS parent_sessions ON parent_sessions.id =
      COALESCE(session_spawn_lineage.parent_session_id, legacy_lineage.parent_session_id)
    LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
    LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
    LEFT JOIN session_derivations ON session_derivations.derived_session_id = sessions.id
    LEFT JOIN sessions AS source_sessions ON source_sessions.id = session_derivations.source_session_id
    LEFT JOIN worker_run_facts ON worker_run_facts.ancestor_id = sessions.id
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
  return sql`
    SELECT
      ${sessionSummaryColumns(sql)}
    FROM sessions
    WHERE archived = 0
    ORDER BY updated_at DESC
    LIMIT ${normalizeSessionListLimit(limit)}
  `.pipe(Effect.flatMap(decodeSqlRows(sessionSummaryRowSchema, 'sessions')))
}

function loadVisibleBranchRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
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
    WHERE session_id IN ${sql.in(sessionIds)}
    ORDER BY session_id ASC, created_at ASC
  `.pipe(Effect.flatMap(decodeSqlRows(sessionBranchRowSchema, 'session_branches')))
}

function loadUiStateRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
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
    WHERE session_tree_ui_state.session_id IN ${sql.in(sessionIds)}
  `.pipe(Effect.flatMap(decodeSqlRows(sessionTreeUiStateRowSchema, 'session_tree_ui_state')))
}

function loadInterruptedRunRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
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
    WHERE session_id IN ${sql.in(sessionIds)}
      AND status = ${'interrupted'}
    ORDER BY updated_at DESC
  `.pipe(Effect.flatMap(decodeSqlRows(sessionActiveRunRowSchema, 'session_active_runs')))
}

function loadSessionsWithArchivedBranches(sql: SqlClient.SqlClient, limit?: number) {
  return sql`
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
  `.pipe(Effect.flatMap(decodeSqlRows(sessionSummaryRowSchema, 'sessions')))
}

export function loadArchivedBranchRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
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
    WHERE session_id IN ${sql.in(sessionIds)}
      AND archived_at IS NOT NULL
    ORDER BY session_id ASC, archived_at DESC, created_at ASC
  `.pipe(Effect.flatMap(decodeSqlRows(sessionBranchRowSchema, 'session_branches')))
}
