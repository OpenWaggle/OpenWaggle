import type * as SqlClient from '@effect/sql/SqlClient'
import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import {
  authorizeSessionTarget,
  authorizeSessionTargetForCaller,
} from '../domain/session-control/session-capability-authorization'
import {
  type AttentionReason,
  decodedCapabilities,
  loadProfile,
  profileAuthority,
  profileId,
  type QueuedFollowUpProfileRow,
  sourceSessionId,
  type TargetRow,
  targetDescriptor,
} from './session-follow-up-authority-support'
import { decodeSessionExecutionProfile } from './session-run-execution-profile'

interface SourceRow {
  readonly project_path: string | null
  readonly profile_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
  readonly authority_origin_caller_id: string
  readonly parent_session_id: string | null
  readonly capabilities_json: string | null
  readonly grant_authorization_ceiling: 'yolo' | 'ask-for-approval' | null
  readonly grant_revoked_at: number | null
  readonly target_grant_capabilities_json: string | null
  readonly target_grant_authorization_ceiling: 'yolo' | 'ask-for-approval' | null
  readonly target_grant_revoked_at: number | null
}

function sourceRelationshipBlockReason(
  sql: SqlClient.SqlClient,
  sourceId: string,
  source: SourceRow,
  target: TargetRow,
) {
  if (source.parent_session_id === null) {
    return Effect.succeed<AttentionReason | undefined>(
      !source.project_path || source.project_path !== target.project_path
        ? 'authority_changed'
        : undefined,
    )
  }
  return Effect.gen(function* () {
    const relationship = yield* sql<{ readonly allowed: number }>`
      SELECT CASE WHEN ${target.session_id} = ${sourceId} OR EXISTS (
        SELECT 1 FROM session_spawn_lineage
        WHERE parent_session_id = ${sourceId} AND child_session_id = ${target.session_id}
      ) THEN 1 ELSE 0 END AS allowed
    `
    return relationship[0]?.allowed === 1 ? undefined : ('authority_changed' as const)
  })
}

function sourceCeilingChanged(
  requiresYolo: boolean,
  source: SourceRow,
  target: TargetRow,
  originProfile: QueuedFollowUpProfileRow | undefined,
  targetGrantCeiling: SourceRow['target_grant_authorization_ceiling'],
) {
  if (!requiresYolo) return false
  return (
    target.authorization_ceiling !== 'yolo' ||
    source.authorization_ceiling !== 'yolo' ||
    source.grant_authorization_ceiling === 'ask-for-approval' ||
    targetGrantCeiling === 'ask-for-approval' ||
    originProfile?.authorization_ceiling === 'ask-for-approval'
  )
}

function resolveOriginAuthority(
  sql: SqlClient.SqlClient,
  sourceId: string,
  source: SourceRow,
  target: TargetRow,
  capabilities: readonly SessionCapability[],
) {
  return Effect.gen(function* () {
    const originProfile = yield* loadProfile(sql, source.authority_origin_caller_id)
    const baseRelationshipAuthorized =
      source.parent_session_id === null || target.session_id === sourceId
    if (!profileId(source.authority_origin_caller_id)) {
      return {
        effectiveCapabilities: capabilities,
        originProfile,
        baseScopeAuthorized: baseRelationshipAuthorized,
      }
    }
    if (!originProfile || originProfile.revoked_at !== null) {
      return { blockReason: 'profile_revoked' as const, effectiveCapabilities: capabilities }
    }
    const originAuthority = profileAuthority(originProfile)
    const effectiveCapabilities = capabilities.filter((capability) =>
      originAuthority.capabilities.includes(capability),
    )
    return {
      effectiveCapabilities,
      originProfile,
      baseScopeAuthorized:
        baseRelationshipAuthorized &&
        authorizeSessionTarget(originAuthority, targetDescriptor(target)).authorized,
    }
  })
}

function resolveSourceCapabilities(source: SourceRow) {
  const worker = source.parent_session_id !== null
  if (worker && (source.capabilities_json === null || source.grant_revoked_at !== null)) {
    return { blockReason: 'profile_revoked' as const }
  }
  const profile = decodeSessionExecutionProfile(source.profile_json)
  const granted = worker
    ? decodedCapabilities(source.capabilities_json)
    : DEFAULT_SESSION_AGENT_CAPABILITIES
  return {
    capabilities: profile.sessionCapabilities
      ? granted.filter((capability) => profile.sessionCapabilities?.includes(capability))
      : granted,
  }
}

export function sessionAgentBlockReason(
  sql: SqlClient.SqlClient,
  callerId: string,
  target: TargetRow,
  requiresYolo: boolean,
) {
  const sourceId = sourceSessionId(callerId)
  if (!sourceId) return Effect.succeed<AttentionReason | undefined>(undefined)
  return Effect.gen(function* () {
    const rows = yield* sql<SourceRow>`
      SELECT sessions.project_path, session_execution_profiles.profile_json,
        session_execution_profiles.authorization_ceiling,
        session_execution_profiles.authority_origin_caller_id,
        session_spawn_lineage.parent_session_id,
        derived_child_management_grants.capabilities_json,
        derived_child_management_grants.authorization_ceiling AS grant_authorization_ceiling,
        derived_child_management_grants.revoked_at AS grant_revoked_at,
        target_grant.capabilities_json AS target_grant_capabilities_json,
        target_grant.authorization_ceiling AS target_grant_authorization_ceiling,
        target_grant.revoked_at AS target_grant_revoked_at
      FROM sessions
      JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN derived_child_management_grants
        ON derived_child_management_grants.child_session_id = sessions.id
      LEFT JOIN derived_child_management_grants AS target_grant
        ON target_grant.child_session_id = ${target.session_id}
        AND target_grant.source_caller_id = session_execution_profiles.authority_origin_caller_id
      WHERE sessions.id = ${sourceId}
      LIMIT 1
    `
    const source = rows[0]
    if (!source) return 'profile_revoked' as const
    const sourceCapabilities = resolveSourceCapabilities(source)
    if (sourceCapabilities.blockReason) return sourceCapabilities.blockReason
    const origin = yield* resolveOriginAuthority(
      sql,
      sourceId,
      source,
      target,
      sourceCapabilities.capabilities,
    )
    if (origin.blockReason) return origin.blockReason
    const relationshipBlock = yield* sourceRelationshipBlockReason(sql, sourceId, source, target)
    if (relationshipBlock) return relationshipBlock
    const derivedCapabilities =
      source.target_grant_revoked_at === null
        ? decodedCapabilities(source.target_grant_capabilities_json).filter((capability) =>
            origin.effectiveCapabilities.includes(capability),
          )
        : []
    const authorization = authorizeSessionTargetForCaller(
      {
        callerId,
        profileAuthority: {
          profileId: sourceId,
          profileName: sourceId,
          capabilities: origin.effectiveCapabilities,
          scope: origin.baseScopeAuthorized
            ? { sessionIds: [target.session_id] }
            : { sessionIds: [] },
          authorizationCeiling: source.authorization_ceiling,
        },
        baseProfileScope: origin.baseScopeAuthorized
          ? { sessionIds: [target.session_id] }
          : { sessionIds: [] },
        ...(derivedCapabilities.length > 0
          ? {
              derivedSessionAuthorities: [
                {
                  sessionId: target.session_id,
                  capabilities: derivedCapabilities,
                  authorizationCeiling:
                    source.target_grant_authorization_ceiling ?? 'ask-for-approval',
                },
              ],
            }
          : {}),
      },
      targetDescriptor(target),
      ['sessions:message'],
    )
    if (!authorization.authorized) return 'authority_changed' as const
    if (
      sourceCeilingChanged(
        requiresYolo,
        source,
        target,
        origin.originProfile,
        'derived' in authorization ? authorization.derived.authorizationCeiling : null,
      )
    ) {
      return 'authorization_ceiling_changed' as const
    }
    return undefined
  })
}
