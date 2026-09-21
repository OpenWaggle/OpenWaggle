import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  SessionControlFollowUp,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'
import { authorizeSessionTargetForCaller } from '../domain/session-control/session-capability-authorization'
import {
  decodedCapabilities,
  loadProfile,
  loadTarget,
  profileAuthority,
  profileId,
  sourceSessionId,
  type TargetRow,
  targetDescriptor,
} from './session-follow-up-authority-support'
import { applyFollowUpAuthorizationState } from './session-follow-up-authorization-state'
import { sessionAgentBlockReason } from './session-follow-up-session-agent-authorization'
import { liveSessionAuthorityBlockReason } from './sqlite-session-live-authority'

interface DerivedAuthorityRow {
  readonly capabilities_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
}

function loadDerivedAuthority(sql: SqlClient.SqlClient, callerId: string, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<DerivedAuthorityRow>`
      SELECT capabilities_json, authorization_ceiling
      FROM derived_child_management_grants
      WHERE source_caller_id = ${callerId}
        AND child_session_id = ${sessionId}
        AND revoked_at IS NULL
      LIMIT 1
    `
    return rows[0]
  })
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
    const derived = yield* loadDerivedAuthority(sql, callerId, target.session_id)
    const authorization = authorizeSessionTargetForCaller(
      {
        callerId,
        profileAuthority: authority,
        baseProfileScope: authority.scope,
        ...(derived
          ? {
              derivedSessionAuthorities: [
                {
                  sessionId: target.session_id,
                  capabilities: decodedCapabilities(derived.capabilities_json),
                  authorizationCeiling: derived.authorization_ceiling,
                },
              ],
            }
          : {}),
      },
      targetDescriptor(target),
      ['sessions:message'],
    )
    if (!authorization.authorized) return 'authority_changed' as const
    const derivedCeiling =
      'derived' in authorization ? authorization.derived.authorizationCeiling : null
    if (
      requiresYolo &&
      (authority.authorizationCeiling !== 'yolo' ||
        target.authorization_ceiling !== 'yolo' ||
        derivedCeiling === 'ask-for-approval')
    ) {
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
    return applyFollowUpAuthorizationState(state, reason)
  })
}
