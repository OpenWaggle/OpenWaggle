import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import {
  decodeLocalSessionProfileCapabilities,
  decodeLocalSessionProfileScope,
} from '@shared/schemas/local-session-profile'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  SESSION_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import type {
  SessionControlFollowUp,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'
import { authorizeSessionTarget } from '../domain/session-control/session-capability-authorization'
import { decodeSessionExecutionProfile } from './session-run-execution-profile'
import { liveSessionAuthorityBlockReason } from './sqlite-session-live-authority'

type AttentionReason = NonNullable<SessionControlFollowUp['attentionReason']>

interface TargetRow {
  readonly session_id: string
  readonly project_path: string | null
  readonly hive_root_session_id: string | null
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
}

interface ProfileRow {
  readonly id: string
  readonly capabilities_json: string
  readonly scope_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
  readonly revoked_at: number | null
}

interface SourceRow {
  readonly project_path: string | null
  readonly profile_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
  readonly authority_origin_caller_id: string
  readonly parent_session_id: string | null
  readonly capabilities_json: string | null
  readonly grant_authorization_ceiling: 'yolo' | 'ask-for-approval' | null
  readonly grant_revoked_at: number | null
}

const REVISION_INCREMENT = 1

function profileId(callerId: string) {
  return callerId.startsWith('profile:') ? callerId.slice('profile:'.length) : undefined
}

function sourceSessionId(callerId: string) {
  const prefix = 'session-agent:'
  if (!callerId.startsWith(prefix)) return undefined
  const lastSeparator = callerId.lastIndexOf(':')
  return lastSeparator > prefix.length ? callerId.slice(prefix.length, lastSeparator) : undefined
}

function decodedCapabilities(value: string | null): readonly SessionCapability[] {
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

function loadProfile(sql: SqlClient.SqlClient, callerId: string) {
  const id = profileId(callerId)
  if (!id) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const rows = yield* sql<ProfileRow>`
      SELECT id, capabilities_json, scope_json, authorization_ceiling, revoked_at
      FROM session_client_profiles
      WHERE id = ${id}
      LIMIT 1
    `
    return rows[0]
  })
}

function profileAuthority(row: ProfileRow): LocalSessionProfileAuthority {
  return {
    profileId: row.id,
    profileName: row.id,
    capabilities: decodeLocalSessionProfileCapabilities(parseJsonUnknown(row.capabilities_json)),
    scope: decodeLocalSessionProfileScope(parseJsonUnknown(row.scope_json)),
    authorizationCeiling: row.authorization_ceiling,
  }
}

function loadTarget(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<TargetRow>`
      SELECT sessions.id AS session_id, sessions.project_path,
        session_spawn_lineage.hive_root_session_id,
        session_execution_profiles.authorization_ceiling
      FROM sessions
      JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      WHERE sessions.id = ${sessionId}
      LIMIT 1
    `
    return rows[0]
  })
}

function targetDescriptor(target: TargetRow) {
  return {
    sessionId: target.session_id,
    ...(target.project_path ? { projectPath: target.project_path } : {}),
    hiveRootSessionId: target.hive_root_session_id ?? target.session_id,
  }
}

function directProfileBlockReason(
  sql: SqlClient.SqlClient,
  callerId: string,
  target: TargetRow,
  requiresYolo: boolean,
) {
  return Effect.gen(function* () {
    const row = yield* loadProfile(sql, callerId)
    if (!row || row.revoked_at !== null) return 'profile_revoked' as const
    const authority = profileAuthority(row)
    if (
      !authority.capabilities.includes('sessions:message') ||
      !authorizeSessionTarget(authority, targetDescriptor(target)).authorized
    ) {
      return 'authority_changed' as const
    }
    if (
      requiresYolo &&
      (authority.authorizationCeiling !== 'yolo' || target.authorization_ceiling !== 'yolo')
    ) {
      return 'authorization_ceiling_changed' as const
    }
    return undefined
  })
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
  originProfile: ProfileRow | undefined,
) {
  if (!requiresYolo) return false
  return (
    target.authorization_ceiling !== 'yolo' ||
    source.authorization_ceiling !== 'yolo' ||
    source.grant_authorization_ceiling === 'ask-for-approval' ||
    originProfile?.authorization_ceiling === 'ask-for-approval'
  )
}

function resolveOriginAuthority(
  sql: SqlClient.SqlClient,
  source: SourceRow,
  target: TargetRow,
  capabilities: readonly SessionCapability[],
) {
  return Effect.gen(function* () {
    const originProfile = yield* loadProfile(sql, source.authority_origin_caller_id)
    if (!profileId(source.authority_origin_caller_id)) {
      return { effectiveCapabilities: capabilities, originProfile }
    }
    if (!originProfile || originProfile.revoked_at !== null) {
      return { blockReason: 'profile_revoked' as const, effectiveCapabilities: capabilities }
    }
    const originAuthority = profileAuthority(originProfile)
    const effectiveCapabilities = capabilities.filter((capability) =>
      originAuthority.capabilities.includes(capability),
    )
    return authorizeSessionTarget(originAuthority, targetDescriptor(target)).authorized
      ? { effectiveCapabilities, originProfile }
      : { blockReason: 'authority_changed' as const, effectiveCapabilities, originProfile }
  })
}

function sessionAgentBlockReason(
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
        derived_child_management_grants.revoked_at AS grant_revoked_at
      FROM sessions
      JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN derived_child_management_grants
        ON derived_child_management_grants.child_session_id = sessions.id
      WHERE sessions.id = ${sourceId}
      LIMIT 1
    `
    const source = rows[0]
    if (!source) return 'profile_revoked' as const
    const worker = source.parent_session_id !== null
    if (worker && (source.capabilities_json === null || source.grant_revoked_at !== null)) {
      return 'profile_revoked' as const
    }
    const profile = decodeSessionExecutionProfile(source.profile_json)
    const granted = worker
      ? decodedCapabilities(source.capabilities_json)
      : DEFAULT_SESSION_AGENT_CAPABILITIES
    const profileCapabilities = profile.sessionCapabilities
      ? granted.filter((capability) => profile.sessionCapabilities?.includes(capability))
      : granted
    const origin = yield* resolveOriginAuthority(sql, source, target, profileCapabilities)
    if (origin.blockReason) return origin.blockReason
    if (!origin.effectiveCapabilities.includes('sessions:message')) {
      return 'authority_changed' as const
    }
    const relationshipBlock = yield* sourceRelationshipBlockReason(sql, sourceId, source, target)
    if (relationshipBlock) return relationshipBlock
    if (sourceCeilingChanged(requiresYolo, source, target, origin.originProfile)) {
      return 'authorization_ceiling_changed' as const
    }
    return undefined
  })
}

function blockReason(
  sql: SqlClient.SqlClient,
  sessionId: string,
  followUp: SessionControlFollowUp,
) {
  return Effect.gen(function* () {
    const liveAuthorityBlock = yield* liveSessionAuthorityBlockReason(
      sql,
      followUp.intent.callerId,
      sessionId,
    )
    if (liveAuthorityBlock) return liveAuthorityBlock
    const target = yield* loadTarget(sql, sessionId)
    if (!target) return 'authority_changed' as const
    const fromProfile = profileId(followUp.intent.callerId) !== undefined
    const fromSessionAgent = sourceSessionId(followUp.intent.callerId) !== undefined
    const requiresYolo = followUp.intent.runAuthorizationOverride === 'yolo'
    if (fromProfile) {
      return yield* directProfileBlockReason(sql, followUp.intent.callerId, target, requiresYolo)
    }
    if (fromSessionAgent) {
      return yield* sessionAgentBlockReason(sql, followUp.intent.callerId, target, requiresYolo)
    }
    return requiresYolo && target.authorization_ceiling !== 'yolo'
      ? ('authorization_ceiling_changed' as const)
      : undefined
  })
}

export function applyCurrentFollowUpAuthorization(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
) {
  const followUp = state.followUpQueue.items[0]
  if (!followUp) return Effect.succeed(state)
  return Effect.gen(function* () {
    const reason = yield* blockReason(sql, state.sessionId, followUp)
    if (!reason) {
      if (followUp.deliveryState === 'pending') return state
      const { attentionReason: _attentionReason, ...restored } = followUp
      return {
        ...state,
        revision: state.revision + REVISION_INCREMENT,
        followUpQueue: {
          ...state.followUpQueue,
          revision: state.followUpQueue.revision + REVISION_INCREMENT,
          items: [
            { ...restored, deliveryState: 'pending' as const },
            ...state.followUpQueue.items.slice(1),
          ],
        },
      }
    }
    const alreadyBlocked =
      followUp.deliveryState === 'needs_attention' && followUp.attentionReason === reason
    if (alreadyBlocked && state.followUpQueue.state === 'paused') return state
    return {
      ...state,
      revision: state.revision + REVISION_INCREMENT,
      followUpQueue: {
        ...state.followUpQueue,
        state: 'paused' as const,
        revision: state.followUpQueue.revision + REVISION_INCREMENT,
        items: [
          alreadyBlocked
            ? followUp
            : { ...followUp, deliveryState: 'needs_attention' as const, attentionReason: reason },
          ...state.followUpQueue.items.slice(1),
        ],
      },
    }
  })
}
