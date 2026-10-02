import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { SessionRunAvailability } from '../domain/session-control/message-submission'
import { canChangeSessionSettings } from '../domain/session-control/run-start-settings'
import { SessionControlRepositoryError } from '../errors'
import {
  type SessionSettingChange,
  SessionSettingsRepository,
} from '../ports/session-settings-repository'

/** The Session's Run state; any Run the Session Control state points at holds the Session. */
function runState(status: string | null): SessionRunAvailability['state'] {
  if (status === null) return 'idle'
  return status === 'starting' || status === 'stopping' ? status : 'active'
}

/**
 * Sets one profile field in the same transaction that checks the Session has no active Run, so a
 * Run admitted concurrently either sees the old setting or refuses the change.
 */
function setProfileField(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  path: '$.modelId' | '$.thinkingLevel',
  value: string,
) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const runs = yield* sql<{ readonly status: string | null }>`
          SELECT session_runs.status
          FROM session_control_states
          JOIN session_runs ON session_runs.id = session_control_states.active_run_id
          WHERE session_control_states.session_id = ${sessionId}
          LIMIT 1
        `
        const status = runs[0]?.status ?? null
        if (!canChangeSessionSettings({ state: runState(status) })) {
          return { changed: false, code: 'session_run_active' } satisfies SessionSettingChange
        }
        const rows = yield* sql<{ readonly session_id: string }>`
          UPDATE session_execution_profiles
          SET profile_json = json_set(profile_json, ${path}, ${value}),
              updated_at = ${Date.now()}
          WHERE session_id = ${sessionId} AND json_valid(profile_json)
          RETURNING session_id
        `
        return rows.length > 0
          ? ({ changed: true } satisfies SessionSettingChange)
          : ({ changed: false, code: 'session_profile_not_found' } satisfies SessionSettingChange)
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) => new SessionControlRepositoryError({ operation: 'set-session-setting', cause }),
      ),
    )
}

function applyRunStartThinkingLevel(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: SessionId; readonly runId: string; readonly thinkingLevel: string },
) {
  return sql<{ readonly session_id: string }>`
    UPDATE session_execution_profiles
    SET profile_json = json_set(profile_json, '$.thinkingLevel', ${input.thinkingLevel}),
        updated_at = ${Date.now()}
    WHERE session_id = ${input.sessionId}
      AND json_valid(profile_json)
      AND EXISTS (
        SELECT 1 FROM session_control_states
        WHERE session_control_states.session_id = ${input.sessionId}
          AND session_control_states.active_run_id = ${input.runId}
      )
    RETURNING session_id
  `.pipe(
    Effect.map((rows) => rows.length > 0),
    Effect.mapError(
      (cause) =>
        new SessionControlRepositoryError({ operation: 'apply-run-start-thinking-level', cause }),
    ),
  )
}

export const SqliteSessionSettingsRepositoryLive = Layer.effect(
  SessionSettingsRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionSettingsRepository.of({
      setModel: (sessionId, model) => setProfileField(sql, sessionId, '$.modelId', model),
      setThinkingLevel: (sessionId, thinkingLevel) =>
        setProfileField(sql, sessionId, '$.thinkingLevel', thinkingLevel),
      applyRunStartThinkingLevel: (input) => applyRunStartThinkingLevel(sql, input),
    })
  }),
)
