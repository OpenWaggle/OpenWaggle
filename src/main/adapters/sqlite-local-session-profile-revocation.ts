import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

interface RunRow {
  readonly session_id: string
  readonly run_id: string
}

function revokeDerivedAuthority(sql: SqlClient.SqlClient, callerId: string, now: number) {
  return sql`
    UPDATE derived_child_management_grants
    SET revoked_at = COALESCE(revoked_at, ${now})
    WHERE source_caller_id = ${callerId}
  `
}

function markFollowUpsForAttention(sql: SqlClient.SqlClient, callerId: string, now: number) {
  return sql`
    WITH RECURSIVE authority_sessions(session_id) AS (
      SELECT session_id FROM session_execution_profiles
      WHERE authority_origin_caller_id = ${callerId}
      UNION
      SELECT DISTINCT child_session_id FROM derived_child_management_grants
      WHERE source_caller_id = ${callerId}
      UNION
      SELECT lineage.child_session_id
      FROM session_spawn_lineage AS lineage
      JOIN authority_sessions AS affected ON affected.session_id = lineage.parent_session_id
    )
    UPDATE session_follow_ups SET
      delivery_state = ${'needs_attention'}, attention_reason = ${'profile_revoked'},
      updated_at = ${now}
    WHERE session_id IN (SELECT session_id FROM authority_sessions)
      OR json_extract(intent_json, '$.callerId') = ${callerId}
  `
}

function affectedActiveRuns(sql: SqlClient.SqlClient, callerId: string) {
  return sql<RunRow>`
    WITH RECURSIVE authority_sessions(session_id) AS (
      SELECT session_id FROM session_execution_profiles
      WHERE authority_origin_caller_id = ${callerId}
      UNION
      SELECT DISTINCT child_session_id FROM derived_child_management_grants
      WHERE source_caller_id = ${callerId}
      UNION
      SELECT lineage.child_session_id
      FROM session_spawn_lineage AS lineage
      JOIN authority_sessions AS affected ON affected.session_id = lineage.parent_session_id
    ), profile_run_descendants(session_id) AS (
      SELECT lineage.child_session_id
      FROM session_spawn_lineage AS lineage
      JOIN session_runs AS parent_run ON parent_run.id = lineage.parent_run_id
      WHERE json_extract(parent_run.intent_json, '$.callerId') = ${callerId}
      UNION
      SELECT lineage.child_session_id
      FROM session_spawn_lineage AS lineage
      JOIN profile_run_descendants AS affected ON affected.session_id = lineage.parent_session_id
    ), directly_active_sessions(session_id) AS (
      SELECT states.session_id
      FROM session_control_states AS states
      JOIN session_runs AS active_run ON active_run.id = states.active_run_id
      WHERE json_extract(active_run.intent_json, '$.callerId') = ${callerId}
    ), affected_sessions(session_id) AS (
      SELECT session_id FROM authority_sessions
      UNION SELECT session_id FROM profile_run_descendants
      UNION SELECT session_id FROM directly_active_sessions
    )
    SELECT states.session_id, states.active_run_id AS run_id
    FROM affected_sessions
    JOIN session_control_states AS states ON states.session_id = affected_sessions.session_id
    WHERE states.active_run_id IS NOT NULL
    ORDER BY states.session_id
  `
}

function interruptRuns(sql: SqlClient.SqlClient, runs: readonly RunRow[], now: number) {
  return Effect.forEach(runs, (run) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE session_runs SET status = ${'interrupted'}, updated_at = ${now}
        WHERE id = ${run.run_id}
      `
      yield* sql`
        UPDATE session_control_states SET
          active_run_id = ${null}, queue_state = ${'paused'},
          queue_revision = queue_revision + 1, state_revision = state_revision + 1,
          updated_at = ${now}
        WHERE session_id = ${run.session_id}
      `
    }),
  )
}

function pauseAffectedQueues(sql: SqlClient.SqlClient, callerId: string, now: number) {
  return sql`
    WITH RECURSIVE authority_sessions(session_id) AS (
      SELECT session_id FROM session_execution_profiles
      WHERE authority_origin_caller_id = ${callerId}
      UNION
      SELECT DISTINCT child_session_id FROM derived_child_management_grants
      WHERE source_caller_id = ${callerId}
      UNION
      SELECT lineage.child_session_id
      FROM session_spawn_lineage AS lineage
      JOIN authority_sessions AS affected ON affected.session_id = lineage.parent_session_id
    ), profile_run_descendants(session_id) AS (
      SELECT lineage.child_session_id
      FROM session_spawn_lineage AS lineage
      JOIN session_runs AS parent_run ON parent_run.id = lineage.parent_run_id
      WHERE json_extract(parent_run.intent_json, '$.callerId') = ${callerId}
      UNION
      SELECT lineage.child_session_id
      FROM session_spawn_lineage AS lineage
      JOIN profile_run_descendants AS affected ON affected.session_id = lineage.parent_session_id
    ), directly_active_sessions(session_id) AS (
      SELECT states.session_id
      FROM session_control_states AS states
      JOIN session_runs AS active_run ON active_run.id = states.active_run_id
      WHERE json_extract(active_run.intent_json, '$.callerId') = ${callerId}
    ), affected_sessions(session_id) AS (
      SELECT session_id FROM authority_sessions
      UNION SELECT session_id FROM profile_run_descendants
      UNION SELECT session_id FROM directly_active_sessions
    )
    UPDATE session_control_states SET
      queue_state = ${'paused'}, queue_revision = queue_revision + 1,
      state_revision = state_revision + 1, updated_at = ${now}
    WHERE session_id IN (SELECT session_id FROM affected_sessions)
      AND active_run_id IS NULL
      AND (
        queue_state <> ${'paused'}
        OR EXISTS (
          SELECT 1 FROM session_follow_ups
          WHERE session_follow_ups.session_id = session_control_states.session_id
            AND session_follow_ups.attention_reason = ${'profile_revoked'}
        )
      )
  `
}

export function revokeAffectedRuns(sql: SqlClient.SqlClient, profileId: string, now: number) {
  const callerId = `profile:${profileId}`
  return Effect.gen(function* () {
    yield* revokeDerivedAuthority(sql, callerId, now)
    yield* markFollowUpsForAttention(sql, callerId, now)
    const runs = yield* affectedActiveRuns(sql, callerId)
    yield* interruptRuns(sql, runs, now)
    yield* pauseAffectedQueues(sql, callerId, now)
    return runs.map((run) => ({ sessionId: run.session_id, runId: run.run_id }))
  })
}
