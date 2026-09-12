import * as SqlClient from '@effect/sql/SqlClient'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type { SessionDetail, SessionSummary } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { sessionIdsForQuery } from '../sessions/hydration'
import { attachSessionLineage, loadSessionLineageRows } from '../sessions/session-list'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX, MESSAGE_ENTRY_TYPE } from './constants'
import { hydrateWaggleConfig, parseJsonValue } from './json'
import {
  getActivePathRows,
  hydrateSessionMessages,
  logSessionHydrationFailure,
} from './message-hydration'
import type { SessionNodeRow, SessionRow, SessionSummaryRow } from './types'

/**
 * The detail-side summary shape, which carries `messageCount` and deliberately omits the
 * session-list fields (environment mode, worktree path, last-active ids).
 *
 * Named apart from `hydrateSessionSummary` in `store/sessions/hydration.ts` on purpose:
 * when both were called the same thing, a change intended for the session list was made
 * here instead. It typechecked, its own test passed, and the feature was simply missing
 * until the app was opened.
 */
function hydrateSessionDetailSummary(row: SessionSummaryRow) {
  return {
    id: SessionId(row.id),
    title: row.title,
    projectPath: row.project_path,
    messageCount: row.message_count,
    archived: row.archived === 1 ? true : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function hydrateSessionDetail(sessionRow: SessionRow, nodeRows: readonly SessionNodeRow[]) {
  try {
    const environmentMode: SessionEnvironmentMode =
      sessionRow.environment_mode === 'worktree' ? 'worktree' : 'local'
    return {
      id: SessionId(sessionRow.id),
      title: sessionRow.title,
      projectPath: sessionRow.project_path,
      piSessionId: sessionRow.pi_session_id,
      piSessionFile: sessionRow.pi_session_file ?? undefined,
      messages: hydrateSessionMessages(getActivePathRows(sessionRow.last_active_node_id, nodeRows)),
      waggleConfig: hydrateWaggleConfig(parseJsonValue(sessionRow.waggle_config_json)),
      archived: sessionRow.archived === 1 ? true : undefined,
      createdAt: sessionRow.created_at,
      updatedAt: sessionRow.updated_at,
      environmentMode,
      worktreePath: sessionRow.worktree_path,
      worktreeBaseRef: sessionRow.worktree_base_ref,
      worktreeStartFromOrigin: sessionRow.worktree_start_from_origin === 1,
      ...(isAgentAuthorizationMode(sessionRow.authorization_mode_override)
        ? { authorizationMode: sessionRow.authorization_mode_override }
        : {}),
      ...(sessionRow.execution_model_id
        ? { executionModel: SupportedModelId(sessionRow.execution_model_id) }
        : {}),
    }
  } catch (error) {
    logSessionHydrationFailure(sessionRow, error)
    return null
  }
}

function isSessionDetail(session: SessionDetail | null) {
  return session !== null
}

function selectSessionRow(sql: SqlClient.SqlClient, id: SessionId) {
  return sql<SessionRow>`
    SELECT
      sessions.id,
      sessions.pi_session_id,
      sessions.pi_session_file,
      sessions.project_path,
      sessions.title,
      sessions.archived,
      sessions.waggle_config_json,
      sessions.created_at,
      sessions.updated_at,
      sessions.last_active_node_id,
      sessions.last_active_branch_id,
      sessions.environment_mode,
      sessions.worktree_path,
      sessions.worktree_base_ref,
      sessions.worktree_start_from_origin,
      sessions.authorization_mode_override,
      json_extract(session_execution_profiles.profile_json, '$.modelId') AS execution_model_id
    FROM sessions
    LEFT JOIN session_execution_profiles
      ON session_execution_profiles.session_id = sessions.id
    WHERE sessions.id = ${id}
    LIMIT 1
  `
}

function selectSessionNodeRows(sql: SqlClient.SqlClient, id: SessionId) {
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
    WHERE session_id = ${id}
    ORDER BY created_order ASC
  `
}

function summaryCountSql(
  sql: SqlClient.SqlClient,
  archived: number,
  limit: number | null,
  offset = 0,
) {
  return sql<SessionSummaryRow>`
    SELECT
      s.id,
      s.title,
      s.project_path,
      s.archived,
      s.created_at,
      s.updated_at,
      (
        SELECT COUNT(*)
        FROM session_nodes sn
        WHERE sn.session_id = s.id
          AND sn.pi_entry_type = ${MESSAGE_ENTRY_TYPE}
      ) AS message_count
    FROM sessions s
    WHERE s.archived = ${archived}
    ORDER BY s.updated_at DESC
    LIMIT ${limit ?? -1}
    OFFSET ${offset}
  `
}

export async function listSessionSummaries(limit?: number, offset = 0): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* summaryCountSql(sql, 0, limit ?? null, offset)
      return rows.map(hydrateSessionDetailSummary)
    }),
  )
}

export async function listArchivedSessions(): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* summaryCountSql(sql, 1, null)
      const sessions = rows.map(hydrateSessionDetailSummary)
      if (sessions.length === 0) return sessions
      return attachSessionLineage(
        sessions,
        yield* loadSessionLineageRows(sql, sessionIdsForQuery(sessions)),
      )
    }),
  )
}

export async function listSessionDetails(limit?: number, offset = 0): Promise<SessionDetail[]> {
  const summaries = await listSessionSummaries(limit, offset)
  const sessions = await Promise.all(summaries.map((summary) => getSessionDetail(summary.id)))
  return sessions.filter(isSessionDetail)
}

export async function getSessionDetail(id: SessionId): Promise<SessionDetail | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessionRows = yield* selectSessionRow(sql, id)
      const sessionRow = sessionRows[EMPTY_INDEX]
      if (!sessionRow) {
        return null
      }

      const nodeRows = yield* selectSessionNodeRows(sql, id)
      return hydrateSessionDetail(sessionRow, nodeRows)
    }),
  )
}

export async function getSessionAuthorizationBoundary(id: SessionId) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        readonly execution_ceiling: 'yolo' | 'ask-for-approval'
        readonly grant_ceiling: 'yolo' | 'ask-for-approval' | null
        readonly grant_revoked_at: number | null
        readonly profile_ceiling: 'yolo' | 'ask-for-approval' | null
        readonly profile_revoked_at: number | null
      }>`
        SELECT
          execution.authorization_ceiling AS execution_ceiling,
          grants.authorization_ceiling AS grant_ceiling,
          grants.revoked_at AS grant_revoked_at,
          profiles.authorization_ceiling AS profile_ceiling,
          profiles.revoked_at AS profile_revoked_at
        FROM session_execution_profiles AS execution
        LEFT JOIN derived_child_management_grants AS grants
          ON grants.child_session_id = execution.session_id
        LEFT JOIN session_client_profiles AS profiles
          ON execution.authority_origin_caller_id = ${'profile:'} || profiles.id
        WHERE execution.session_id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    }),
  )
}

function callerSourceSessionId(callerId: string) {
  const prefix = 'session-agent:'
  if (!callerId.startsWith(prefix)) return undefined
  const lastSeparator = callerId.lastIndexOf(':')
  return lastSeparator > prefix.length ? callerId.slice(prefix.length, lastSeparator) : undefined
}

export async function getSessionCallerAuthorizationBoundary(callerId: string) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (callerId.startsWith('profile:')) {
        const profileId = callerId.slice('profile:'.length)
        const rows = yield* sql<{
          readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
          readonly revoked_at: number | null
        }>`
          SELECT authorization_ceiling, revoked_at
          FROM session_client_profiles WHERE id = ${profileId} LIMIT 1
        `
        const row = rows[0]
        return row
          ? { authorizationCeiling: row.authorization_ceiling, revoked: row.revoked_at !== null }
          : { authorizationCeiling: 'ask-for-approval' as const, revoked: true }
      }

      const sourceSessionId = callerSourceSessionId(callerId)
      if (!sourceSessionId) return null
      const rows = yield* sql<{
        readonly execution_ceiling: 'yolo' | 'ask-for-approval'
        readonly grant_ceiling: 'yolo' | 'ask-for-approval' | null
        readonly grant_revoked_at: number | null
        readonly parent_session_id: string | null
        readonly profile_ceiling: 'yolo' | 'ask-for-approval' | null
        readonly profile_revoked_at: number | null
      }>`
        SELECT execution.authorization_ceiling AS execution_ceiling,
          lineage.parent_session_id,
          grants.authorization_ceiling AS grant_ceiling,
          grants.revoked_at AS grant_revoked_at,
          profiles.authorization_ceiling AS profile_ceiling,
          profiles.revoked_at AS profile_revoked_at
        FROM session_execution_profiles AS execution
        LEFT JOIN session_spawn_lineage AS lineage
          ON lineage.child_session_id = execution.session_id
        LEFT JOIN derived_child_management_grants AS grants
          ON grants.child_session_id = execution.session_id
        LEFT JOIN session_client_profiles AS profiles
          ON execution.authority_origin_caller_id = ${'profile:'} || profiles.id
        WHERE execution.session_id = ${sourceSessionId}
        LIMIT 1
      `
      const row = rows[0]
      if (!row) return { authorizationCeiling: 'ask-for-approval' as const, revoked: true }
      const missingWorkerGrant = row.parent_session_id !== null && row.grant_ceiling === null
      const revoked =
        missingWorkerGrant || row.grant_revoked_at !== null || row.profile_revoked_at !== null
      const authorizationCeiling =
        row.execution_ceiling === 'ask-for-approval' ||
        row.grant_ceiling === 'ask-for-approval' ||
        row.profile_ceiling === 'ask-for-approval'
          ? ('ask-for-approval' as const)
          : ('yolo' as const)
      return { authorizationCeiling, revoked }
    }),
  )
}
