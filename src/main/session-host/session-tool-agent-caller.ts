import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import {
  decodeLocalSessionProfileCapabilities,
  decodeLocalSessionProfileScope,
} from '@shared/schemas/local-session-profile'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  SESSION_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { decodeSessionExecutionProfile } from '../adapters/session-run-execution-profile'
import {
  assertSessionAuthoritySnapshot,
  decodeSessionAuthoritySnapshot,
} from './session-authority-snapshot'
import { loadScopedSessionAgentTargets } from './session-tool-agent-scope'

interface AuthorityRow {
  readonly project_path: string | null
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
  readonly profile_json: string
  readonly authority_origin_caller_id: string
  readonly authority_scope_snapshot_json: string | null
  readonly origin_profile_revoked_at: number | null
  readonly origin_profile_id: string | null
  readonly origin_profile_capabilities_json: string | null
  readonly origin_profile_scope_json: string | null
  readonly origin_profile_authorization_ceiling: 'yolo' | 'ask-for-approval' | null
  readonly parent_session_id: string | null
  readonly capabilities_json: string | null
  readonly derived_grant_id: string | null
  readonly derived_grant_revoked_at: number | null
}

interface DerivedAuthorityRow {
  readonly child_session_id: string
  readonly capabilities_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
}

function decodeCapabilities(value: string | null): readonly SessionCapability[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter(
          (candidate): candidate is SessionCapability =>
            typeof candidate === 'string' &&
            SESSION_CAPABILITIES.some((capability) => capability === candidate),
        )
      : []
  } catch {
    return []
  }
}

function assertLiveAuthority(row: AuthorityRow | undefined, sessionId: string) {
  if (!row) throw new Error(`Sessions tool source Session was not found: ${sessionId}`)
  const expectsOriginProfile = row.authority_origin_caller_id.startsWith('profile:')
  if ((expectsOriginProfile && !row.origin_profile_id) || row.origin_profile_revoked_at !== null) {
    throw new Error('The CLI client profile that originated this Session authority was revoked.')
  }
  if (
    row.parent_session_id !== null &&
    (!row.derived_grant_id || row.derived_grant_revoked_at !== null)
  ) {
    throw new Error('The Worker Session management grant was revoked.')
  }
  return row
}

function effectiveCapabilities(row: AuthorityRow) {
  const worker = row.parent_session_id !== null
  const executionProfile = decodeSessionExecutionProfile(row.profile_json)
  const granted = worker
    ? decodeCapabilities(row.capabilities_json)
    : [...DEFAULT_SESSION_AGENT_CAPABILITIES]
  const constrained = executionProfile.sessionCapabilities
    ? granted.filter((capability) => executionProfile.sessionCapabilities?.includes(capability))
    : granted
  const originCapabilities = row.origin_profile_capabilities_json
    ? decodeLocalSessionProfileCapabilities(parseJsonUnknown(row.origin_profile_capabilities_json))
    : undefined
  return {
    capabilities: originCapabilities
      ? constrained.filter((capability) => originCapabilities.includes(capability))
      : constrained,
    originCapabilities,
  }
}

function originAuthority(
  row: AuthorityRow,
  originCapabilities: readonly SessionCapability[] | undefined,
) {
  if (!row.origin_profile_scope_json) return undefined
  const scope = decodeLocalSessionProfileScope(parseJsonUnknown(row.origin_profile_scope_json))
  return {
    authority: {
      profileId: row.origin_profile_id ?? 'origin',
      profileName: row.origin_profile_id ?? 'origin',
      capabilities: originCapabilities ?? [],
      scope,
      authorizationCeiling: row.origin_profile_authorization_ceiling ?? 'ask-for-approval',
    },
    scope,
  }
}

function loadDerivedAuthorities(
  sql: SqlClient.SqlClient,
  row: AuthorityRow,
  parentSessionId: string,
) {
  return sql<DerivedAuthorityRow>`
    SELECT grants.child_session_id, grants.capabilities_json, grants.authorization_ceiling
    FROM session_spawn_lineage AS lineage
    JOIN derived_child_management_grants AS grants
      ON grants.child_session_id = lineage.child_session_id
    WHERE lineage.parent_session_id = ${parentSessionId}
      AND grants.source_caller_id = ${row.authority_origin_caller_id}
      AND grants.revoked_at IS NULL
    ORDER BY grants.child_session_id
  `
}

function effectiveAuthorizationCeiling(row: AuthorityRow) {
  return row.authorization_ceiling === 'ask-for-approval' ||
    row.origin_profile_authorization_ceiling === 'ask-for-approval'
    ? ('ask-for-approval' as const)
    : ('yolo' as const)
}

function sharedProjectScopePath(
  row: AuthorityRow,
  origins: readonly NonNullable<ReturnType<typeof originAuthority>>[],
) {
  if (row.parent_session_id !== null || row.project_path === null) return undefined
  const shared = origins.every(
    (candidate) =>
      candidate.scope.all === true ||
      candidate.scope.projectPaths?.includes(row.project_path ?? '') === true,
  )
  return shared ? row.project_path : undefined
}

function loadAuthorityRow(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<AuthorityRow>`
    SELECT
      sessions.project_path,
      session_execution_profiles.authorization_ceiling,
      session_execution_profiles.profile_json,
      session_execution_profiles.authority_origin_caller_id,
      session_execution_profiles.authority_scope_snapshot_json,
      session_client_profiles.id AS origin_profile_id,
      session_client_profiles.capabilities_json AS origin_profile_capabilities_json,
      session_client_profiles.scope_json AS origin_profile_scope_json,
      session_client_profiles.authorization_ceiling AS origin_profile_authorization_ceiling,
      session_client_profiles.revoked_at AS origin_profile_revoked_at,
      session_spawn_lineage.parent_session_id,
      derived_child_management_grants.id AS derived_grant_id,
      derived_child_management_grants.capabilities_json,
      derived_child_management_grants.revoked_at AS derived_grant_revoked_at
    FROM sessions
    JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
    LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
    LEFT JOIN derived_child_management_grants
      ON derived_child_management_grants.child_session_id = sessions.id
    LEFT JOIN session_client_profiles
      ON session_execution_profiles.authority_origin_caller_id =
        ${'profile:'} || session_client_profiles.id
    WHERE sessions.id = ${sessionId}
    LIMIT 1
  `
}

export function resolveSessionToolAgentCaller(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: string; readonly runId: string; readonly workingDirectory: string },
) {
  return Effect.gen(function* () {
    const rows = yield* loadAuthorityRow(sql, input.sessionId)
    const row = assertLiveAuthority(rows[0], input.sessionId)
    const authoritySnapshot = decodeSessionAuthoritySnapshot(row.authority_scope_snapshot_json)
    if (authoritySnapshot) {
      yield* Effect.tryPromise({
        try: async () => {
          await assertSessionAuthoritySnapshot(authoritySnapshot)
          if (input.workingDirectory !== authoritySnapshot.workingPath) {
            throw new Error('Session working directory differs from its authority snapshot.')
          }
        },
        catch: (cause) => new Error('Session authority changed after it was granted.', { cause }),
      })
    }
    const effective = effectiveCapabilities(row)
    const origin = originAuthority(row, effective.originCapabilities)
    const snapshotOrigin = authoritySnapshot
      ? {
          authority: {
            profileId: row.origin_profile_id ?? 'restricted-origin',
            profileName: row.origin_profile_id ?? 'restricted-origin',
            capabilities: effective.originCapabilities ?? effective.capabilities,
            scope: authoritySnapshot.scope,
            authorizationCeiling:
              row.origin_profile_authorization_ceiling ?? row.authorization_ceiling,
          },
          scope: authoritySnapshot.scope,
        }
      : undefined
    const origins = [origin, snapshotOrigin].filter(
      (candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined,
    )
    const sharedProjectPath = sharedProjectScopePath(row, origins)
    const sharesProjectScope = sharedProjectPath !== undefined
    const scopedTargets = sharesProjectScope
      ? []
      : yield* loadScopedSessionAgentTargets(sql, {
          sessionId: input.sessionId,
          projectPath: row.project_path,
          isWorker: row.parent_session_id !== null,
          origin,
          snapshotOrigin,
        })
    const sourceAuthorized =
      sharesProjectScope || scopedTargets.some((target) => target.session_id === input.sessionId)
    const visibleTargets = sourceAuthorized ? scopedTargets : []
    const derived = sourceAuthorized ? yield* loadDerivedAuthorities(sql, row, input.sessionId) : []
    const filesystemRoot = authoritySnapshot?.workingPath ?? input.workingDirectory
    const baseSessionIds = visibleTargets
      .filter((target) => row.parent_session_id === null || target.session_id === input.sessionId)
      .map((target) => target.session_id)
    const baseScope = sharesProjectScope
      ? {
          projectPaths: [sharedProjectPath],
          exportRoots: [filesystemRoot],
          attachmentRoots: [filesystemRoot],
        }
      : {
          sessionIds: baseSessionIds,
          exportRoots: [filesystemRoot],
          attachmentRoots: [filesystemRoot],
        }
    const ceiling = effectiveAuthorizationCeiling(row)
    return {
      callerId: `session-agent:${input.sessionId}:${input.runId}`,
      workingDirectory: input.workingDirectory,
      ...(origins.length > 0
        ? {
            baseProfileScope: baseScope,
          }
        : {}),
      derivedSessionAuthorities: derived.map((authority) => ({
        sessionId: authority.child_session_id,
        capabilities: decodeCapabilities(authority.capabilities_json).filter((capability) =>
          effective.capabilities.includes(capability),
        ),
        authorizationCeiling:
          ceiling === 'ask-for-approval' || authority.authorization_ceiling === 'ask-for-approval'
            ? ('ask-for-approval' as const)
            : ('yolo' as const),
      })),
      profileAuthority: {
        profileId: `session-agent:${input.sessionId}`,
        profileName: `session-agent:${input.sessionId}`,
        capabilities: effective.capabilities,
        scope: baseScope,
        authorizationCeiling: ceiling,
      },
    } satisfies LocalSessionCallerIdentity
  })
}
