import path from 'node:path'
import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import {
  decodeLocalSessionProfileCapabilities,
  decodeLocalSessionProfileScope,
} from '@shared/schemas/local-session-profile'
import * as Effect from 'effect/Effect'
import { liveSessionAuthorityBlockReason } from '../adapters/sqlite-session-live-authority'
import {
  authorizeSessionCapabilities,
  authorizeSessionTarget,
  requiredSessionControlCapabilities,
} from '../domain/session-control/session-capability-authorization'
import type { SessionExportOperationRecord } from '../ports/session-export-operation-repository'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'

interface ExportAuthorityRow {
  readonly id: string
  readonly capabilities_json: string
  readonly scope_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
  readonly session_id: string
  readonly project_path: string | null
  readonly hive_root_session_id: string | null
  readonly working_path: string | null
}

function requiresLiveAuthority(callerId: string) {
  return (
    callerId.startsWith('profile:') ||
    callerId.startsWith('session-agent:') ||
    callerId.startsWith('transient-mcp:')
  )
}

function loadExportAuthorityRow(sql: SqlClient.SqlClient, operation: SessionExportOperationRecord) {
  const profileId = operation.callerId.slice('profile:'.length)
  return sql<ExportAuthorityRow>`
    SELECT profiles.id, profiles.capabilities_json, profiles.scope_json,
      profiles.authorization_ceiling, sessions.id AS session_id, sessions.project_path,
      lineage.hive_root_session_id, workspace_resources.working_path
    FROM session_client_profiles AS profiles
    JOIN sessions ON sessions.id = ${operation.sessionId}
    LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
    LEFT JOIN session_workspace_bindings AS bindings ON bindings.session_id = sessions.id
    LEFT JOIN workspace_resources ON workspace_resources.id = bindings.workspace_id
    WHERE profiles.id = ${profileId} AND profiles.revoked_at IS NULL
    LIMIT 1
  `
}

function decodeExportAuthority(row: ExportAuthorityRow) {
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
  readonly row: ExportAuthorityRow
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
  row: ExportAuthorityRow,
  authority: ReturnType<typeof decodeExportAuthority>,
) {
  const capabilitiesAuthorized = authorizeSessionCapabilities(
    authority,
    exportRequiredCapabilities(operation),
  ).authorized
  const targetAuthorized = authorizeSessionTarget(authority, {
    sessionId: row.session_id,
    ...(row.project_path ? { projectPath: row.project_path } : {}),
    hiveRootSessionId: row.hive_root_session_id ?? row.session_id,
  }).authorized
  if (!capabilitiesAuthorized || !targetAuthorized) {
    throw new Error('Export profile authority changed.')
  }
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
    if (!operation.callerId.startsWith('profile:')) return expectedWorkspacePath
    const row = (yield* loadExportAuthorityRow(sql, operation))[0]
    if (!row) return yield* Effect.fail(new Error('Export profile was revoked.'))
    const authority = decodeExportAuthority(row)
    const exportRoots = authority.scope.exportRoots ?? []
    if (!operation.destinationRoot || exportRoots.length === 0) {
      return yield* Effect.fail(new Error('Export filesystem authority was removed.'))
    }
    const currentWorkspacePath = yield* Effect.tryPromise({
      try: () => validateFilesystemAuthority({ operation, row, exportRoots }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    yield* Effect.try({
      try: () => assertProfileAuthority(operation, row, authority),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    if (currentWorkspacePath !== expectedWorkspacePath) {
      return yield* Effect.fail(new Error('Export resource source workspace changed.'))
    }
    return expectedWorkspacePath
  })
}
