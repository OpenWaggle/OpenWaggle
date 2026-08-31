import path from 'node:path'
import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import {
  decodeLocalSessionProfileCapabilities,
  decodeLocalSessionProfileScope,
} from '@shared/schemas/local-session-profile'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { liveSessionAuthorityBlockReason } from '../adapters/sqlite-session-live-authority'
import { requiredSessionControlCapabilities } from '../domain/session-control/session-capability-authorization'
import type { SessionExportOperationRecord } from '../ports/session-export-operation-repository'
import { resolveSessionToolAgentCaller } from '../session-host/session-tool-agent-caller'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'
import { authorizeTargetForCaller } from './local-session-derived-authority'

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

function requiresLiveAuthority(callerId: string) {
  return (
    callerId.startsWith('profile:') ||
    callerId.startsWith('session-agent:') ||
    callerId.startsWith('transient-mcp:')
  )
}

function loadExportTarget(sql: SqlClient.SqlClient, operation: SessionExportOperationRecord) {
  return sql<ExportTargetRow>`
    SELECT sessions.id AS session_id, sessions.project_path,
      lineage.hive_root_session_id, workspace_resources.working_path
    FROM sessions
    LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
    LEFT JOIN session_workspace_bindings AS bindings ON bindings.session_id = sessions.id
    LEFT JOIN workspace_resources ON workspace_resources.id = bindings.workspace_id
    WHERE sessions.id = ${operation.sessionId}
    LIMIT 1
  `
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

async function validateFilesystemAuthority(input: {
  readonly operation: SessionExportOperationRecord
  readonly row: ExportTargetRow
  readonly exportRoots: readonly string[]
}) {
  const canonicalRoots = await assertCanonicalDirectoryRoots(
    input.exportRoots,
    'Profile export root',
  )
  const [destinationRoot] = await assertCanonicalDirectoryRoots(
    [input.operation.destinationRoot ?? ''],
    'Export destination root',
  )
  const isAuthorizedRoot = (candidate: string) =>
    canonicalRoots.some((root) => {
      const relative = path.relative(root, candidate)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    })
  if (!isAuthorizedRoot(destinationRoot ?? '')) {
    throw new Error('Export destination root is no longer authorized.')
  }
  if (input.operation.resources.length === 0) return undefined
  const sourceRoot = input.row.working_path ?? input.row.project_path
  if (!sourceRoot) throw new Error('Export resource source root is unavailable.')
  const [canonicalSourceRoot] = await assertCanonicalDirectoryRoots(
    [sourceRoot],
    'Export resource source root',
  )
  if (!canonicalSourceRoot || !isAuthorizedRoot(canonicalSourceRoot)) {
    throw new Error('Export resource source root is no longer authorized.')
  }
  return canonicalSourceRoot
}

function exportRequiredCapabilities(operation: SessionExportOperationRecord) {
  return requiredSessionControlCapabilities({
    operation: 'export-create',
    sessionId: operation.sessionId,
    format: operation.format,
    destinationPath: operation.destinationPath,
    branchScope: operation.branchScope,
    ...(operation.branchId ? { branchId: operation.branchId } : {}),
    ...(operation.overwriteExisting ? { overwriteExisting: true } : {}),
    ...(operation.includeQueueBodies ? { includeQueueBodies: true } : {}),
    ...(operation.resources.length > 0 ? { resources: operation.resources } : {}),
  })
}

function assertProfileAuthority(
  operation: SessionExportOperationRecord,
  row: ExportTargetRow,
  caller: LocalSessionCallerIdentity,
) {
  const required = exportRequiredCapabilities(operation)
  const targetAuthorized = authorizeTargetForCaller(
    caller,
    {
      sessionId: row.session_id,
      ...(row.project_path ? { projectPath: row.project_path } : {}),
      hiveRootSessionId: row.hive_root_session_id ?? row.session_id,
    },
    required,
  ).authorized
  if (!targetAuthorized) {
    throw new Error('Export profile authority changed.')
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

export function resolveExportOriginProfileId(
  sql: SqlClient.SqlClient,
  operation: SessionExportOperationRecord,
) {
  if (operation.callerId.startsWith('profile:')) {
    return Effect.succeed(operation.callerId.slice('profile:'.length))
  }
  const source = parseSessionAgentCaller(operation.callerId)
  if (!source) return Effect.succeed<string | undefined>(undefined)
  return sql<{ readonly authority_origin_caller_id: string }>`
    SELECT authority_origin_caller_id
    FROM session_execution_profiles
    WHERE session_id = ${source.sessionId}
    LIMIT 1
  `.pipe(
    Effect.map((rows) => {
      const callerId = rows[0]?.authority_origin_caller_id
      return callerId?.startsWith('profile:') ? callerId.slice('profile:'.length) : undefined
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
    if (!workingDirectory) {
      return yield* Effect.fail(new Error('Export Session-agent workspace is unavailable.'))
    }
    return yield* resolveSessionToolAgentCaller(sql, { ...source, workingDirectory })
  })
}

export function ensureLiveExportAuthority(
  sql: SqlClient.SqlClient,
  operation: SessionExportOperationRecord,
) {
  return Effect.gen(function* () {
    const expectedWorkspacePath =
      operation.resources.length > 0 ? operation.resourceSourceRoot : undefined
    if (operation.resources.length > 0 && !expectedWorkspacePath) {
      return yield* Effect.fail(new Error('Export resource source authority is unavailable.'))
    }
    if (!requiresLiveAuthority(operation.callerId)) return expectedWorkspacePath
    const reason = yield* liveSessionAuthorityBlockReason(
      sql,
      operation.callerId,
      operation.sessionId,
    )
    if (reason) {
      return yield* Effect.fail(new Error(`Export authority is no longer valid: ${reason}.`))
    }
    if (operation.callerId.startsWith('transient-mcp:')) return expectedWorkspacePath
    const row = (yield* loadExportTarget(sql, operation))[0]
    if (!row) return yield* Effect.fail(new Error('Export target Session was removed.'))
    const caller = operation.callerId.startsWith('profile:')
      ? yield* loadNamedProfileCaller(sql, operation.callerId)
      : yield* loadSessionAgentCaller(sql, operation.callerId)
    const exportRoots = caller.profileAuthority?.scope.exportRoots ?? []
    if (!operation.destinationRoot || exportRoots.length === 0) {
      return yield* Effect.fail(new Error('Export filesystem authority was removed.'))
    }
    const currentWorkspacePath = yield* Effect.tryPromise({
      try: () => validateFilesystemAuthority({ operation, row, exportRoots }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    yield* Effect.try({
      try: () => assertProfileAuthority(operation, row, caller),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    if (currentWorkspacePath !== expectedWorkspacePath) {
      return yield* Effect.fail(new Error('Export resource source workspace changed.'))
    }
    return expectedWorkspacePath
  })
}
