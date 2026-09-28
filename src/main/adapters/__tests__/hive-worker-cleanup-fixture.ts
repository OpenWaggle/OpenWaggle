import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SqliteHiveWorkerCleanupRepositoryLive } from '../sqlite-hive-worker-cleanup-repository'
import { SqliteSessionDelegationRepositoryLive } from '../sqlite-session-delegation-repository'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

export const QUEEN_CALLER_ID = 'session-agent:queen:run-queen'

type DelegationState =
  | 'working'
  | 'waiting'
  | 'needs_attention'
  | 'ready_for_review'
  | 'revision_requested'
  | 'accepted'
  | 'cancelled'

/** Real SQLite Session Host store with Session Control, organization, delegation, and cleanup. */
export function makeHiveWorkerCleanupTestLayer(databasePath: string) {
  const base = makeSessionControlTestLayer(databasePath)
  const pinnedSchema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`CREATE TABLE pinned_sessions (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        pinned_at INTEGER NOT NULL,
        sort_key TEXT NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE session_branches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        is_main INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      )`)
    }),
  )
  return Layer.mergeAll(
    base,
    pinnedSchema.pipe(Layer.provide(base)),
    SqliteHiveWorkerCleanupRepositoryLive.pipe(Layer.provide(base)),
    SqliteSessionDelegationRepositoryLive.pipe(Layer.provide(base)),
  )
}

/**
 * Seeds a Queen with one agent-spawned Worker whose Delegation reached `state` and whose Run
 * has settled. `workerId` lets a test add several Workers under the same Queen.
 */
export function seedHiveWorker(
  sql: SqlClient.SqlClient,
  input: {
    readonly workerId?: string
    readonly parentId?: string
    readonly state?: DelegationState
    readonly spawnCallerId?: string
    readonly seedParent?: boolean
  } = {},
) {
  const workerId = input.workerId ?? 'worker'
  const parentId = input.parentId ?? 'queen'
  const parentRunId = `run-${parentId}`
  const delegationId = `delegation-${workerId}`
  return Effect.gen(function* () {
    if (input.seedParent ?? true) {
      yield* sql`INSERT INTO sessions (id, project_path, title) VALUES (${parentId}, ${'/project'}, ${parentId})`
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (${parentRunId}, ${parentId}, ${'completed'}, ${null}, ${1000}, ${1000})
      `
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
        ) VALUES (${parentId}, ${1}, ${null}, ${'running'}, ${0}, ${1000})
      `
    }
    yield* sql`INSERT INTO sessions (id, project_path, title) VALUES (${workerId}, ${'/project'}, ${workerId})`
    yield* sql`
      INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
      VALUES (${`run-${workerId}`}, ${workerId}, ${'completed'}, ${null}, ${1000}, ${1000})
    `
    yield* sql`
      INSERT INTO session_control_states (
        session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
      ) VALUES (${workerId}, ${2}, ${null}, ${'running'}, ${0}, ${1000})
    `
    yield* sql`
      INSERT INTO session_branches (id, session_id, name, is_main, created_at, updated_at)
      VALUES (${`branch-${workerId}-main`}, ${workerId}, ${'main'}, ${1}, ${1000}, ${1000})
    `
    yield* sql`
      INSERT INTO session_spawn_lineage (
        child_session_id, parent_session_id, parent_run_id, hive_root_session_id, depth, created_at
      ) VALUES (${workerId}, ${parentId}, ${parentRunId}, ${parentId}, ${1}, ${1000})
    `
    yield* sql`
      INSERT INTO delegation_contracts (
        id, parent_session_id, child_session_id, state,
        current_specification_revision, created_at, updated_at
      ) VALUES (
        ${delegationId}, ${parentId}, ${workerId}, ${input.state ?? 'accepted'}, ${1}, ${1000}, ${2000}
      )
    `
    yield* sql`
      INSERT INTO delegation_specifications (
        delegation_id, revision, specification_json, authored_by, created_at
      ) VALUES (${delegationId}, ${1}, ${'{"objective":"Review the tests"}'}, ${parentId}, ${1000})
    `
    yield* sql`
      INSERT INTO delegation_submissions (
        delegation_id, revision, specification_revision, summary, submitted_by,
        source_run_id, provenance, created_at
      ) VALUES (
        ${delegationId}, ${1}, ${1}, ${'Tests reviewed.'}, ${'session-host'},
        ${`run-${workerId}`}, ${'host-captured'}, ${1500}
      )
    `
    yield* sql`
      INSERT INTO session_operations (
        caller_id, operation, target_scope, idempotency_key, request_json,
        status, outcome_json, created_at, updated_at
      ) VALUES (
        ${input.spawnCallerId ?? `session-agent:${parentId}:${parentRunId}`}, ${'spawn'},
        ${`parent:${parentId}`}, ${`spawn-${workerId}`}, ${'{}'}, ${'completed'},
        ${JSON.stringify({ operation: 'spawn', effect: 'spawned-worker', sessionId: workerId })},
        ${1000}, ${1000}
      )
    `
    yield* sql`
      INSERT INTO session_operations (
        caller_id, operation, target_scope, idempotency_key, request_json,
        status, outcome_json, created_at, updated_at
      ) VALUES (
        ${`session-agent:${parentId}:${parentRunId}`}, ${'follow-up'},
        ${workerId}, ${`queen-follow-up-${workerId}`}, ${'{}'}, ${'completed'},
        ${'{"operation":"follow-up","effect":"queued-follow-up"}'}, ${1100}, ${1100}
      )
    `
  })
}

/** Records one journaled mutation against `sessionId` exactly as Session Control does. */
export function recordOperation(
  sql: SqlClient.SqlClient,
  input: { readonly callerId: string; readonly operation: string; readonly sessionId: string },
) {
  return sql`
    INSERT INTO session_operations (
      caller_id, operation, target_scope, idempotency_key, request_json,
      status, outcome_json, created_at, updated_at
    ) VALUES (
      ${input.callerId}, ${input.operation}, ${input.sessionId},
      ${`${input.operation}-${input.callerId}`}, ${'{}'}, ${'completed'}, ${'{}'}, ${3000}, ${3000}
    )
  `
}
