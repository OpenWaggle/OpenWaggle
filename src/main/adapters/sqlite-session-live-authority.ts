import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  assertSessionAuthoritySnapshot,
  decodeSessionAuthoritySnapshot,
} from '../session-host/session-authority-snapshot'

function profileId(callerId: string) {
  return callerId.startsWith('profile:') ? callerId.slice('profile:'.length) : undefined
}

function sourceSessionId(callerId: string) {
  const prefix = 'session-agent:'
  if (!callerId.startsWith(prefix)) return undefined
  const lastSeparator = callerId.lastIndexOf(':')
  return lastSeparator > prefix.length ? callerId.slice(prefix.length, lastSeparator) : undefined
}

function profileRevoked(sql: SqlClient.SqlClient, id: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly revoked_at: number | null }>`
      SELECT revoked_at FROM session_client_profiles WHERE id = ${id} LIMIT 1
    `
    return !rows[0] || rows[0].revoked_at !== null
  })
}

export function loadSessionAuthoritySnapshot(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly authority_scope_snapshot_json: string | null }>`
      SELECT authority_scope_snapshot_json
      FROM session_execution_profiles
      WHERE session_id = ${sessionId}
      LIMIT 1
    `
    return decodeSessionAuthoritySnapshot(rows[0]?.authority_scope_snapshot_json)
  })
}

function sessionAuthorityChanged(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const snapshot = yield* loadSessionAuthoritySnapshot(sql, sessionId)
    if (!snapshot) return false
    return yield* Effect.tryPromise({
      try: async () => {
        await assertSessionAuthoritySnapshot(snapshot)
        return false
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.catchAll(() => Effect.succeed(true)))
  })
}

/** Revalidates revocable caller ancestry at the durable admission/execution boundary. */
export function liveSessionAuthorityBlockReason(
  sql: SqlClient.SqlClient,
  callerId: string,
  targetSessionId?: string,
) {
  const targetChanged = targetSessionId
    ? sessionAuthorityChanged(sql, targetSessionId)
    : Effect.succeed(false)
  const directProfileId = profileId(callerId)
  if (directProfileId) {
    return Effect.all([profileRevoked(sql, directProfileId), targetChanged]).pipe(
      Effect.map(([revoked, changed]) =>
        revoked
          ? ('profile_revoked' as const)
          : changed
            ? ('authority_changed' as const)
            : undefined,
      ),
    )
  }
  const sourceId = sourceSessionId(callerId)
  if (!sourceId) {
    return targetChanged.pipe(
      Effect.map((changed) => (changed ? ('authority_changed' as const) : undefined)),
    )
  }
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly authority_origin_caller_id: string
      readonly parent_session_id: string | null
      readonly grant_id: string | null
      readonly grant_revoked_at: number | null
    }>`
      SELECT session_execution_profiles.authority_origin_caller_id,
        session_spawn_lineage.parent_session_id,
        derived_child_management_grants.id AS grant_id,
        derived_child_management_grants.revoked_at AS grant_revoked_at
      FROM session_execution_profiles
      LEFT JOIN session_spawn_lineage
        ON session_spawn_lineage.child_session_id = session_execution_profiles.session_id
      LEFT JOIN derived_child_management_grants
        ON derived_child_management_grants.child_session_id = session_execution_profiles.session_id
      WHERE session_execution_profiles.session_id = ${sourceId}
      LIMIT 1
    `
    const source = rows[0]
    if (!source) return 'profile_revoked' as const
    if ((yield* sessionAuthorityChanged(sql, sourceId)) || (yield* targetChanged)) {
      return 'authority_changed' as const
    }
    if (
      source.parent_session_id !== null &&
      (!source.grant_id || source.grant_revoked_at !== null)
    ) {
      return 'profile_revoked' as const
    }
    const originProfileId = profileId(source.authority_origin_caller_id)
    if (originProfileId && (yield* profileRevoked(sql, originProfileId))) {
      return 'profile_revoked' as const
    }
    return undefined
  })
}
