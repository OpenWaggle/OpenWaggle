import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX, MESSAGE_ENTRY_TYPE } from './constants'
import { hydrateWaggleConfig, parseJsonValue } from './json'
import {
  getActivePathRows,
  hydrateSessionMessages,
  logSessionHydrationFailure,
} from './message-hydration'
import type { SessionNodeRow, SessionRow, SessionSummaryRow } from './types'

function hydrateSessionSummary(row: SessionSummaryRow) {
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
      id,
      pi_session_id,
      pi_session_file,
      project_path,
      title,
      archived,
      waggle_config_json,
      created_at,
      updated_at,
      last_active_node_id,
      last_active_branch_id
    FROM sessions
    WHERE id = ${id}
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

function summaryCountSql(sql: SqlClient.SqlClient, archived: number, limit: number | null) {
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
  `
}

export async function listSessionSummaries(limit?: number): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* summaryCountSql(sql, 0, limit ?? null)
      return rows.map(hydrateSessionSummary)
    }),
  )
}

export async function listArchivedSessions(): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* summaryCountSql(sql, 1, null)
      return rows.map(hydrateSessionSummary)
    }),
  )
}

export async function listSessionDetails(limit?: number): Promise<SessionDetail[]> {
  const summaries = await listSessionSummaries(limit)
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
