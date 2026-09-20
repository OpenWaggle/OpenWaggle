import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import {
  decodeLocalSessionProfileCapabilities,
  decodeLocalSessionProfileScope,
} from '@shared/schemas/local-session-profile'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import type { SessionControlFollowUp } from '../domain/session-control/message-aggregate'

export type AttentionReason = NonNullable<SessionControlFollowUp['attentionReason']>

export interface TargetRow {
  readonly session_id: string
  readonly project_path: string | null
  readonly hive_root_session_id: string | null
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
}

export interface QueuedFollowUpProfileRow {
  readonly id: string
  readonly capabilities_json: string
  readonly scope_json: string
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
  readonly revoked_at: number | null
}

export function profileId(callerId: string) {
  return callerId.startsWith('profile:') ? callerId.slice('profile:'.length) : undefined
}

export function sourceSessionId(callerId: string) {
  const prefix = 'session-agent:'
  if (!callerId.startsWith(prefix)) return undefined
  const lastSeparator = callerId.lastIndexOf(':')
  return lastSeparator > prefix.length ? callerId.slice(prefix.length, lastSeparator) : undefined
}

export function decodedCapabilities(value: string | null): readonly SessionCapability[] {
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

export function loadProfile(sql: SqlClient.SqlClient, callerId: string) {
  const id = profileId(callerId)
  if (!id) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const rows = yield* sql<QueuedFollowUpProfileRow>`
      SELECT id, capabilities_json, scope_json, authorization_ceiling, revoked_at
      FROM session_client_profiles
      WHERE id = ${id}
      LIMIT 1
    `
    return rows[0]
  })
}

export function profileAuthority(row: QueuedFollowUpProfileRow): LocalSessionProfileAuthority {
  return {
    profileId: row.id,
    profileName: row.id,
    capabilities: decodeLocalSessionProfileCapabilities(parseJsonUnknown(row.capabilities_json)),
    scope: decodeLocalSessionProfileScope(parseJsonUnknown(row.scope_json)),
    authorizationCeiling: row.authorization_ceiling,
  }
}

export function loadTarget(sql: SqlClient.SqlClient, sessionId: string) {
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

export function targetDescriptor(target: TargetRow) {
  return {
    sessionId: target.session_id,
    ...(target.project_path ? { projectPath: target.project_path } : {}),
    hiveRootSessionId: target.hive_root_session_id ?? target.session_id,
  }
}
