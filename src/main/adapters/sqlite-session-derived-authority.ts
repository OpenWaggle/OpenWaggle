import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { SessionAuthorizationTargetRepositoryError } from '../errors'
import { authorizedSessionScope } from './sqlite-session-query-support'

function decodeCapabilities(value: string): readonly SessionCapability[] {
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

export function listLiveScopedDerivedAuthorities(
  sql: SqlClient.SqlClient,
  callerId: string,
  originScope: LocalSessionProfileScope,
) {
  const allowed = authorizedSessionScope({
    profileId: 'derived-authority-origin',
    profileName: 'derived-authority-origin',
    capabilities: [],
    scope: originScope,
    authorizationCeiling: 'ask-for-approval',
  })
  return sql<{
    readonly child_session_id: string
    readonly capabilities_json: string
    readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
  }>`
    SELECT grants.child_session_id, grants.capabilities_json,
      grants.authorization_ceiling
    FROM derived_child_management_grants AS grants
    JOIN sessions AS parent ON parent.id = grants.parent_session_id
    LEFT JOIN session_spawn_lineage AS parent_lineage
      ON parent_lineage.child_session_id = parent.id
    WHERE grants.source_caller_id = ${callerId} AND grants.revoked_at IS NULL
      AND (
        ${allowed.all} = 1
        OR parent.project_path IN ${sql.in(allowed.projectPaths)}
        OR parent.id IN ${sql.in(allowed.sessionIds)}
        OR COALESCE(parent_lineage.hive_root_session_id, parent.id)
          IN ${sql.in(allowed.hiveRootSessionIds)}
      )
    ORDER BY grants.child_session_id
  `.pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        sessionId: row.child_session_id,
        capabilities: decodeCapabilities(row.capabilities_json),
        authorizationCeiling: row.authorization_ceiling,
      })),
    ),
    Effect.mapError(
      (cause) =>
        new SessionAuthorizationTargetRepositoryError({
          operation: 'list-derived-authorities',
          cause,
        }),
    ),
  )
}
