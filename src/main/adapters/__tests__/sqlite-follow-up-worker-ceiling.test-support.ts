import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION } from './sqlite-follow-up-edit-hold.test-support'

/** A caller that is not the person: an MCP client holding a transient authority. */
export const AGENT = 'transient-mcp:digest-agent'

/** Fills a Run ceiling of one with a root Session's Run, which no longer counts. */
export const busyRoot = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-busy'}, ${'/project'})`
  yield* sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${'run-busy'}, ${'session-busy'}, ${'active'}, ${null}, ${1}, ${1})
  `
  yield* sql`
    INSERT INTO session_control_states (
      session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
    ) VALUES (${'session-busy'}, ${1}, ${'run-busy'}, ${'running'}, ${0}, ${1})
  `
})

/**
 * Makes the target a Worker of the busy root and gives it an active sibling, so a Worker ceiling
 * of one is full, and has an agent author every queued Follow-up but `mine`.
 */
export const busyWorkerHive = Effect.gen(function* () {
  yield* busyRoot
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS settings_store (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`)
  yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'worker-busy'}, ${'/project'})`
  yield* sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${'run-worker-busy'}, ${'worker-busy'}, ${'active'}, ${null}, ${1}, ${1})
  `
  yield* sql`
    INSERT INTO session_control_states (
      session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
    ) VALUES (${'worker-busy'}, ${1}, ${'run-worker-busy'}, ${'running'}, ${0}, ${1})
  `
  yield* sql`
    INSERT INTO session_spawn_lineage (
      child_session_id, parent_session_id, parent_run_id, hive_root_session_id, depth, created_at
    ) VALUES
      (${'worker-busy'}, ${'session-busy'}, ${'run-busy'}, ${'session-busy'}, ${1}, ${1}),
      (${SESSION}, ${'session-busy'}, ${'run-busy'}, ${'session-busy'}, ${1}, ${2})
  `
  yield* sql`
    UPDATE session_follow_ups
    SET intent_json = json_set(intent_json, '$.callerId', ${AGENT})
    WHERE session_id = ${SESSION} AND id <> ${'mine'}
  `
})
