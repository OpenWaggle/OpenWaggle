import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import * as Effect from 'effect/Effect'
import type {
  HiveParentWakeCandidate,
  HiveParentWakeQuery,
} from '../ports/session-orchestration-update-repository'

interface WakeCandidateRow {
  readonly latest_run_id: string
  readonly caller_id: string | null
  readonly run_authorization_override: string | null
  readonly pi_session_file: string | null
  readonly trigger_caller_ids: string
}

/** The decoded causes; anything unreadable counts as one no wake may act on. */
function triggerCallerIds(value: string): readonly (string | null)[] {
  const decoded: unknown = parseJsonUnknown(value)
  if (!Array.isArray(decoded)) return []
  const entries: readonly unknown[] = decoded
  return entries.map((entry): string | null =>
    typeof entry === 'string' || entry === null ? entry : '',
  )
}

function runAuthorizationOverride(value: string | null) {
  return AGENT_AUTHORIZATION_MODES.find((mode) => mode === value)
}

/**
 * The parent to wake, read in one statement (`hive-parent-wake.ts`). An update is pending until a
 * model request of the parent includes it, so a pending update is one no Run has acted on. It
 * needs a Run when it arrived after the parent's latest Run started, or when that Run completed
 * without it: a Run the Host did not start for it, which no wake has answered yet. Every wake Run
 * that starts after an update ends that update's claim, so a wake whose Run fails is not retried
 * until another update arrives or someone sends the parent a message.
 */
export function selectHiveParentWakeCandidate(
  sql: SqlClient.SqlClient,
  input: HiveParentWakeQuery,
) {
  return sql<WakeCandidateRow>`
    SELECT * FROM (
      SELECT latest.id AS latest_run_id,
        json_extract(latest.intent_json, '$.callerId') AS caller_id,
        json_extract(latest.intent_json, '$.runAuthorizationOverride')
          AS run_authorization_override,
        sessions.pi_session_file,
        -- The updates the wake would act on, by who caused each one: the wake needs one, and
        -- one whose cause may wake the parent (sqlite-hive-wake-trigger-authority.ts).
        (
          SELECT json_group_array(updates.trigger_caller_id)
          FROM session_orchestration_updates AS updates
          WHERE updates.parent_session_id = sessions.id
            AND updates.status = ${'pending'}
            AND (
              updates.created_at > latest.created_at
              OR (
                latest.status = ${'completed'}
                AND json_extract(latest.intent_json, '$.hiveWake') IS NULL
              )
            )
        ) AS trigger_caller_ids
      FROM sessions
      JOIN session_control_states AS states ON states.session_id = sessions.id
      JOIN session_runs AS latest ON latest.id = (
        SELECT runs.id FROM session_runs AS runs WHERE runs.session_id = sessions.id
        ORDER BY runs.created_at DESC, runs.id DESC LIMIT 1
      )
      WHERE sessions.id = ${input.parentSessionId}
        AND sessions.archived = 0
        AND states.active_run_id IS NULL
        -- A queued Follow-up carries the updates instead, unless the queue waits on capacity
        -- (ADR 0030, amended 2026-11-09): an agent's item deferred there must not keep the
        -- Queen from ever being woken.
        AND (
          NOT EXISTS (
            SELECT 1 FROM session_follow_ups WHERE session_follow_ups.session_id = sessions.id
          )
          OR (
            states.queue_state = ${'paused'} AND states.queue_pause_reason = ${'parent-limit'}
          )
        )
        AND latest.status IN (${'completed'}, ${'failed'})
    )
    WHERE json_array_length(trigger_caller_ids) > 0
    LIMIT 1
  `.pipe(
    Effect.map((rows): HiveParentWakeCandidate | undefined => {
      const row = rows[0]
      if (!row?.caller_id) return undefined
      const override = runAuthorizationOverride(row.run_authorization_override)
      return {
        parentSessionId: input.parentSessionId,
        latestRunId: row.latest_run_id,
        callerId: row.caller_id,
        ...(override ? { runAuthorizationOverride: override } : {}),
        piSessionFile: row.pi_session_file,
        triggerCallerIds: triggerCallerIds(row.trigger_caller_ids),
      }
    }),
  )
}
