/**
 * SQLite reads for Usage statistics. Both return only reduced facts: a time, a workspace kind,
 * whether a Session is a Worker, and authorization modes. No identifier, title or path leaves.
 */
import * as SqlClient from '@effect/sql/SqlClient'
import {
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import * as Effect from 'effect/Effect'

interface TableRow {
  readonly name: string
}

interface OldestSessionRow {
  readonly oldest_session_at: number | null
}

interface OldestMigrationRow {
  readonly oldest_migration_at: string | null
}

function usableTime(time: number) {
  return Number.isFinite(time) && time > 0 ? [time] : []
}

/**
 * When this profile was first used (ms): the earlier of its oldest Session and the first
 * database migration, which ran when the profile's database was created. `null` when neither
 * exists. A missing table is no evidence rather than a failure, so only a read that may succeed
 * later fails.
 */
export const loadUsageStatisticsInstallEvidenceTime = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const tables = new Set(
    (yield* sql<TableRow>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('sessions', '_migrations')
    `).map((row) => row.name),
  )
  const times: number[] = []
  if (tables.has('sessions')) {
    const rows = yield* sql<OldestSessionRow>`
      SELECT MIN(created_at) AS oldest_session_at FROM sessions
    `
    times.push(...usableTime(rows[0]?.oldest_session_at ?? Number.NaN))
  }
  if (tables.has('_migrations')) {
    const rows = yield* sql<OldestMigrationRow>`
      SELECT MIN(applied_at) AS oldest_migration_at FROM _migrations
    `
    const appliedAt = rows[0]?.oldest_migration_at
    times.push(...usableTime(appliedAt ? Date.parse(appliedAt) : Number.NaN))
  }
  return times.length === 0 ? null : Math.min(...times)
})

interface SessionFactsRow {
  readonly workspace_kind: string | null
  readonly parent_session_id: string | null
  readonly authorization_mode_override: string | null
  readonly authorization_ceiling: string | null
}

export interface UsageStatisticsSessionFacts {
  readonly worktree: boolean
  readonly workerSession: boolean
  readonly sessionAuthorizationMode: AgentAuthorizationMode | null
  readonly authorizationCeiling: AgentAuthorizationMode | null
}

function authorizationMode(value: string | null) {
  return value !== null && isAgentAuthorizationMode(value) ? value : null
}

/** Where a Session's Runs execute, whether it is a Worker, and its stored authorization modes. */
export function loadUsageStatisticsSessionFacts(sessionId: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<SessionFactsRow>`
      SELECT
        workspace_resources.kind AS workspace_kind,
        session_spawn_lineage.parent_session_id,
        sessions.authorization_mode_override,
        session_execution_profiles.authorization_ceiling
      FROM sessions
      LEFT JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
      LEFT JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      WHERE sessions.id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    const facts: UsageStatisticsSessionFacts = {
      worktree: row.workspace_kind === 'managed-worktree',
      workerSession: row.parent_session_id !== null,
      sessionAuthorizationMode: authorizationMode(row.authorization_mode_override),
      authorizationCeiling: authorizationMode(row.authorization_ceiling),
    }
    return facts
  })
}
