import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import {
  decodeLocalSessionProfileCapabilities,
  decodeLocalSessionProfileScope,
} from '@shared/schemas/local-session-profile'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  SessionExportLiveAuthority,
  type SessionExportLiveAuthorityShape,
} from '../ports/session-export-live-authority'
import { resolveSessionToolAgentCaller } from '../session-host/session-tool-agent-caller'
import { liveSessionAuthorityBlockReason } from './sqlite-session-live-authority'

interface ExportProfileRow {
  readonly id: string
  readonly capabilities_json: string
  readonly scope_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
}

interface ExportTargetRow {
  readonly session_id: string
  readonly project_path: string | null
  readonly hive_root_session_id: string | null
  readonly working_path: string | null
}

interface DerivedExportAuthorityRow {
  readonly child_session_id: string
  readonly capabilities_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
}

function asError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}

function normalizeAuthorityError<A>(effect: Effect.Effect<A, unknown>) {
  return effect.pipe(Effect.mapError(asError))
}

function loadExportTarget(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<ExportTargetRow>`
    SELECT sessions.id AS session_id, sessions.project_path,
      lineage.hive_root_session_id, workspace_resources.working_path
    FROM sessions
    LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
    LEFT JOIN session_workspace_bindings AS bindings ON bindings.session_id = sessions.id
    LEFT JOIN workspace_resources ON workspace_resources.id = bindings.workspace_id
    WHERE sessions.id = ${sessionId}
    LIMIT 1
  `.pipe(
    Effect.map((rows) => {
      const row = rows[0]
      return row
        ? {
            sessionId: row.session_id,
            ...(row.project_path ? { projectPath: row.project_path } : {}),
            hiveRootSessionId: row.hive_root_session_id ?? row.session_id,
            ...(row.working_path ? { workingPath: row.working_path } : {}),
          }
        : undefined
    }),
  )
}

function decodeExportAuthority(row: ExportProfileRow) {
  return {
    profileId: row.id,
    profileName: row.id,
    capabilities: decodeLocalSessionProfileCapabilities(parseJsonUnknown(row.capabilities_json)),
    scope: decodeLocalSessionProfileScope(parseJsonUnknown(row.scope_json)),
    authorizationCeiling: row.authorization_ceiling,
  }
}

function loadNamedProfileCaller(sql: SqlClient.SqlClient, callerId: string) {
  const profileId = callerId.slice('profile:'.length)
  return Effect.gen(function* () {
    const profiles = yield* sql<ExportProfileRow>`
      SELECT id, capabilities_json, scope_json, authorization_ceiling
      FROM session_client_profiles
      WHERE id = ${profileId} AND revoked_at IS NULL
      LIMIT 1
    `
    const profile = profiles[0]
    if (!profile) return yield* Effect.fail(new Error('Export profile was revoked.'))
    const authority = decodeExportAuthority(profile)
    const derived = yield* sql<DerivedExportAuthorityRow>`
      SELECT child_session_id, capabilities_json, authorization_ceiling
      FROM derived_child_management_grants
      WHERE source_caller_id = ${callerId} AND revoked_at IS NULL
    `
    return {
      callerId,
      baseProfileScope: authority.scope,
      profileAuthority: authority,
      derivedSessionAuthorities: derived.map((row) => ({
        sessionId: row.child_session_id,
        capabilities: decodeLocalSessionProfileCapabilities(
          parseJsonUnknown(row.capabilities_json),
        ),
        authorizationCeiling: row.authorization_ceiling,
      })),
    } satisfies LocalSessionCallerIdentity
  })
}

function parseSessionAgentCaller(callerId: string) {
  const prefix = 'session-agent:'
  const lastSeparator = callerId.lastIndexOf(':')
  if (!callerId.startsWith(prefix) || lastSeparator <= prefix.length) return undefined
  return {
    sessionId: callerId.slice(prefix.length, lastSeparator),
    runId: callerId.slice(lastSeparator + 1),
  }
}

function resolveOriginProfileId(sql: SqlClient.SqlClient, callerId: string) {
  if (callerId.startsWith('profile:')) {
    return Effect.succeed(callerId.slice('profile:'.length))
  }
  const source = parseSessionAgentCaller(callerId)
  if (!source) return Effect.succeed<string | undefined>(undefined)
  return sql<{ readonly authority_origin_caller_id: string }>`
    SELECT authority_origin_caller_id
    FROM session_execution_profiles
    WHERE session_id = ${source.sessionId}
    LIMIT 1
  `.pipe(
    Effect.map((rows) => {
      const originCallerId = rows[0]?.authority_origin_caller_id
      return originCallerId?.startsWith('profile:')
        ? originCallerId.slice('profile:'.length)
        : undefined
    }),
  )
}

function loadSessionAgentCaller(sql: SqlClient.SqlClient, callerId: string) {
  const source = parseSessionAgentCaller(callerId)
  if (!source) return Effect.fail(new Error('Export Session-agent caller identity is invalid.'))
  return Effect.gen(function* () {
    const workspaces = yield* sql<{ readonly working_path: string | null }>`
      SELECT COALESCE(workspace_resources.working_path, sessions.project_path) AS working_path
      FROM sessions
      LEFT JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
      LEFT JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
      WHERE sessions.id = ${source.sessionId}
      LIMIT 1
    `
    const workingDirectory = workspaces[0]?.working_path
    if (typeof workingDirectory !== 'string' || workingDirectory.length === 0) {
      return yield* Effect.fail(new Error('Export Session-agent workspace is unavailable.'))
    }
    return yield* resolveSessionToolAgentCaller(sql, { ...source, workingDirectory })
  })
}

function loadExportCaller(
  sql: SqlClient.SqlClient,
  callerId: string,
): Effect.Effect<LocalSessionCallerIdentity, unknown> {
  return callerId.startsWith('profile:')
    ? loadNamedProfileCaller(sql, callerId)
    : loadSessionAgentCaller(sql, callerId)
}

function makeAuthority(sql: SqlClient.SqlClient): SessionExportLiveAuthorityShape {
  return {
    liveAuthorityBlockReason: (callerId, targetSessionId) =>
      normalizeAuthorityError(liveSessionAuthorityBlockReason(sql, callerId, targetSessionId)),
    loadTarget: (sessionId) => normalizeAuthorityError(loadExportTarget(sql, sessionId)),
    loadCaller: (callerId) => normalizeAuthorityError(loadExportCaller(sql, callerId)),
    resolveOriginProfileId: (callerId) =>
      normalizeAuthorityError(resolveOriginProfileId(sql, callerId)),
  }
}

export const SqliteSessionExportLiveAuthorityLive = Layer.effect(
  SessionExportLiveAuthority,
  Effect.map(SqlClient.SqlClient, makeAuthority),
)
