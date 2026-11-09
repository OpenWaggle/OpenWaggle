import type * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SCHEDULED_TASK_MIGRATION } from '../../services/scheduled-task-migration'

/** A caller that is not the person: an MCP client holding a transient authority. */
export const AGENT_CALLER = 'transient-mcp:digest-agent'

export function messageRequest(sessionId: string, key: string) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${key}`,
    idempotencyKey: `idempotency-${key}`,
    command: {
      operation: 'message',
      sessionId,
      input: { text: 'Keep going.', attachmentIds: [] },
    },
  } as const
}

/** Sessions with an active Run each; `parentSessionId` makes them Workers of that parent. */
export function seedActiveSessions(
  sql: SqlClient.SqlClient,
  ids: readonly string[],
  parentSessionId?: string,
) {
  return Effect.gen(function* () {
    for (const [index, id] of ids.entries()) {
      yield* sql`INSERT INTO sessions (id, project_path) VALUES (${id}, ${'/project'})`
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (${`run-${id}`}, ${id}, ${'active'}, ${null}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
        ) VALUES (${id}, ${1}, ${`run-${id}`}, ${'running'}, ${0}, ${1})
      `
      if (parentSessionId) {
        yield* sql`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, parent_run_id,
            hive_root_session_id, depth, created_at
          ) VALUES (
            ${id}, ${parentSessionId}, ${`run-${parentSessionId}`}, ${parentSessionId}, ${1},
            ${index + 1}
          )
        `
      }
    }
  })
}

/** A Queen with an active Run, and `workers` active Workers under it. */
export function seedHive(sql: SqlClient.SqlClient, workers: number) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS settings_store (
      key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`)
    yield* sql`
      INSERT INTO settings_store (key, value_json, updated_at)
      VALUES (${'sessionHostParentConcurrencyLimit'}, ${'100'}, ${1})
    `
    yield* seedActiveSessions(sql, ['queen'])
    yield* seedActiveSessions(
      sql,
      Array.from({ length: workers }, (_, index) => `worker-${index}`),
      'queen',
    )
  })
}

/** Makes `session-target` an idle Worker of the Queen. */
export function makeTargetAWorker(sql: SqlClient.SqlClient) {
  return sql`
    INSERT INTO session_spawn_lineage (
      child_session_id, parent_session_id, parent_run_id, hive_root_session_id, depth, created_at
    ) VALUES (${'session-target'}, ${'queen'}, ${'run-queen'}, ${'queen'}, ${1}, ${100})
  `
}

export function targetRunCount(sql: SqlClient.SqlClient) {
  return Effect.map(
    sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM session_runs WHERE session_id = ${'session-target'}
    `,
    (rows) => rows[0]?.count ?? 0,
  )
}

/** A finished earlier Run in `session-target` that `callerId` started. */
export function seedFirstRun(sql: SqlClient.SqlClient, callerId: string) {
  const intent = { text: 'First.', attachmentIds: [], callerId, acceptedAt: 1, idempotencyKey: 'k' }
  return sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (
      ${'run-first'}, ${'session-target'}, ${'completed'}, ${JSON.stringify(intent)}, ${1}, ${1}
    )
  `
}

/** A Scheduled task that `creatorKind` created, firing now with request key `key`. */
export function seedScheduledFiring(
  sql: SqlClient.SqlClient,
  key: string,
  creatorKind: 'local-user' | 'profile' | 'session-agent',
  targetSessionId = 'session-target',
) {
  const taskId = `task-${key}`
  return Effect.gen(function* () {
    for (const statement of SCHEDULED_TASK_MIGRATION.statements) yield* sql.unsafe(statement)
    yield* sql`
      INSERT INTO scheduled_tasks (
        id, owner_key, creator_caller_id, creator_kind, creator_label, kind, name, prompt,
        enabled, schedule_json, time_zone, anchor_at, target_session_id, target_json,
        notification_policy, created_at, updated_at
      ) VALUES (
        ${taskId}, ${'local-user'}, ${'local-user'}, ${creatorKind}, ${'creator'}, ${'heartbeat'},
        ${'Heartbeat'}, ${'Check in.'}, ${1}, ${'{}'}, ${'UTC'}, ${1}, ${targetSessionId},
        ${'{}'}, ${'every-run'}, ${1}, ${1}
      )
    `
    yield* sql`
      INSERT INTO scheduled_task_runs (
        id, task_id, task_name, trigger, nominal_at, fired_at, status, idempotency_key, caller_id
      ) VALUES (
        ${`run-${key}`}, ${taskId}, ${'Heartbeat'}, ${'schedule'}, ${1}, ${1}, ${'dispatching'},
        ${key}, ${'local-user'}
      )
    `
  })
}

/** Sets the Active Workers ceiling the app settings store, as settlement reads it. */
export function storeHostRunCeiling(sql: SqlClient.SqlClient, ceiling: number) {
  return sql`
    INSERT INTO settings_store (key, value_json, updated_at)
    VALUES (${'sessionHostRunCeiling'}, ${String(ceiling)}, ${1})
    ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json
  `
}
