import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import {
  decodeLocalSessionProfileCapabilities,
  decodeLocalSessionProfileManagementEnvelope,
  decodeLocalSessionProfileScope,
} from '@shared/schemas/local-session-profile'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { LocalSessionProfileManagementOutcome } from '@shared/types/local-session-profile-management'
import { LocalSessionProfileRepositoryError } from '../errors'
import type { LocalSessionProfileRepositoryShape } from '../ports/local-session-profile-repository'

export interface ProfileRow {
  readonly id: string
  readonly name: string
  readonly credential_verifier: string
  readonly capabilities_json: string
  readonly scope_json: string
  readonly authorization_ceiling: string
  readonly management_envelope_json: string | null
  readonly revoked_at: number | null
  readonly last_authenticated_at: number | null
  readonly created_at: number
  readonly updated_at: number
}

export type ExecuteManagementInput = Parameters<
  LocalSessionProfileRepositoryShape['executeManagement']
>[0]

export function profileRepositoryError(operation: string, cause: unknown) {
  return new LocalSessionProfileRepositoryError({ operation, cause })
}

export function decodeProfile(row: ProfileRow) {
  if (!isAgentAuthorizationMode(row.authorization_ceiling)) {
    throw new Error('Stored profile has an invalid Authorization ceiling.')
  }
  return {
    id: row.id,
    name: row.name,
    credentialVerifier: row.credential_verifier,
    capabilities: decodeLocalSessionProfileCapabilities(parseJsonUnknown(row.capabilities_json)),
    scope: decodeLocalSessionProfileScope(parseJsonUnknown(row.scope_json)),
    authorizationCeiling: row.authorization_ceiling,
    ...(row.management_envelope_json
      ? {
          managementEnvelope: decodeLocalSessionProfileManagementEnvelope(
            parseJsonUnknown(row.management_envelope_json),
          ),
        }
      : {}),
    revokedAt: row.revoked_at,
    lastAuthenticatedAt: row.last_authenticated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function profileSummary(row: ProfileRow) {
  const profile = decodeProfile(row)
  return {
    id: profile.id,
    name: profile.name,
    capabilities: profile.capabilities,
    scope: profile.scope,
    authorizationCeiling: profile.authorizationCeiling,
    ...(profile.managementEnvelope ? { managementEnvelope: profile.managementEnvelope } : {}),
    revokedAt: profile.revokedAt,
    lastAuthenticatedAt: profile.lastAuthenticatedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

export function selectProfiles(sql: SqlClient.SqlClient, name?: string) {
  return name
    ? sql<ProfileRow>`SELECT * FROM session_client_profiles WHERE name = ${name} LIMIT 1`
    : sql<ProfileRow>`
        SELECT * FROM session_client_profiles ORDER BY name COLLATE NOCASE, id
      `
}

export function rejectedProfileOutcome(
  operation: LocalSessionProfileManagementOutcome['operation'],
  code: string,
  profileName?: string,
): LocalSessionProfileManagementOutcome {
  return {
    operation,
    effect: 'rejected',
    code,
    ...(profileName ? { profileName } : {}),
  }
}

export function auditProfileChange(
  sql: SqlClient.SqlClient,
  input: {
    readonly profileId: string
    readonly action: 'created' | 'updated' | 'rotated' | 'revoked'
    readonly actorCallerId: string
    readonly now: number
  },
) {
  return sql`
    INSERT INTO session_client_profile_audit (
      profile_id, action, actor_caller_id, detail_json, created_at
    ) VALUES (
      ${input.profileId}, ${input.action}, ${input.actorCallerId}, ${'{}'}, ${input.now}
    )
  `
}
