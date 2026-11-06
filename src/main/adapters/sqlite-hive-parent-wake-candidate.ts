import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  HiveParentWakeCandidate,
  HiveParentWakeQuery,
} from '../ports/session-orchestration-update-repository'

interface WakeCandidateRow {
  readonly caller_id: string | null
  readonly pi_session_file: string | null
}

/**
 * The parent to wake, read in one statement (`hive-parent-wake.ts`). An update needs a Run when
 * it is still pending and arrived after the parent's latest Run started (that Run could not have
 * loaded it), or when the Run that just settled received it only after its last turn ended. Every
 * Run that starts after an update, a wake included, ends that update's claim, so a wake whose Run
 * fails is not retried until another update arrives or someone sends the parent a message.
 */
export function selectHiveParentWakeCandidate(
  sql: SqlClient.SqlClient,
  input: HiveParentWakeQuery,
) {
  const settledRunId = input.settledRun?.runId ?? null
  const settledAt = input.settledRun?.terminalEventAt ?? null
  return sql<WakeCandidateRow>`
    SELECT json_extract(latest.intent_json, '$.callerId') AS caller_id, sessions.pi_session_file
    FROM sessions
    JOIN session_control_states AS states ON states.session_id = sessions.id
    JOIN session_runs AS latest ON latest.id = (
      SELECT runs.id FROM session_runs AS runs WHERE runs.session_id = sessions.id
      ORDER BY runs.created_at DESC, runs.id DESC LIMIT 1
    )
    WHERE sessions.id = ${input.parentSessionId}
      AND sessions.archived = 0
      AND states.active_run_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM session_follow_ups WHERE session_follow_ups.session_id = sessions.id
      )
      AND latest.status IN (${'completed'}, ${'failed'})
      AND EXISTS (
        SELECT 1 FROM session_orchestration_updates AS updates
        WHERE updates.parent_session_id = sessions.id
          AND (
            (updates.status = ${'pending'} AND updates.created_at > latest.created_at)
            OR (
              latest.id = ${settledRunId}
              AND updates.delivered_run_id = latest.id
              AND updates.created_at >= ${settledAt}
            )
          )
      )
    LIMIT 1
  `.pipe(
    Effect.map((rows): HiveParentWakeCandidate | undefined => {
      const row = rows[0]
      if (!row?.caller_id) return undefined
      return {
        parentSessionId: input.parentSessionId,
        callerId: row.caller_id,
        piSessionFile: row.pi_session_file,
      }
    }),
  )
}
