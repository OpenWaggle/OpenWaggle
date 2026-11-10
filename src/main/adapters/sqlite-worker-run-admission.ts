import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import {
  isScheduledTaskRunKey,
  scheduledTaskRunWork,
} from '../domain/scheduled-tasks/scheduled-task-run-key'
import {
  isLocalUserCallerId,
  LOCAL_USER_CALLER_IDS,
  LOCAL_USER_CALLER_PREFIX,
} from '../domain/session-control/root-session-project-reach'
import { SETTINGS_KEY_SESSION_HOST_RUN_CEILING } from '../store/settings/keys'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

/** Why the Host would not start an agent's Run now. Both are retryable. */
export type WorkerRunAdmissionRefusal =
  | 'parent_concurrency_limit_reached'
  | 'host_run_ceiling_reached'

/** Who a Run acts for, as its intent records it, or who sent the request that starts it. */
export interface RunCaller {
  readonly callerId: string
  /** The request's key. A Scheduled task's firing is known by it (`scheduledTaskRunKey`). */
  readonly idempotencyKey?: string
  /** A Host-authored Hive wake: the Host acts, for the caller of the parent's latest Run. */
  readonly hiveWake?: true
}

/**
 * Whether the person acts: from the app, the CLI or another local-user client. A Scheduled task
 * that an agent or a client profile created fires as its owner but is its creator's work, so it
 * is not the person. A Hive wake is the Host acting, never a request from the person; whether its
 * Run is the person's work is `isPersonRun`'s call.
 */
export function isPersonCaller(sql: SqlClient.SqlClient, caller: RunCaller) {
  if (caller.hiveWake || !isLocalUserCallerId(caller.callerId)) return Effect.succeed(false)
  const { idempotencyKey } = caller
  if (!isScheduledTaskRunKey(idempotencyKey)) return Effect.succeed(true)
  const work = scheduledTaskRunWork(idempotencyKey)
  if (work) return Effect.succeed(work === 'person')
  // A firing from before keys were marked: its task says, while it still exists.
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly creator_kind: string }>`
      SELECT tasks.creator_kind
      FROM scheduled_task_runs AS task_runs
      JOIN scheduled_tasks AS tasks ON tasks.id = task_runs.task_id
      WHERE task_runs.idempotency_key = ${idempotencyKey}
      LIMIT 1
    `
    return rows[0] === undefined || rows[0].creator_kind === 'local-user'
  })
}

/**
 * Whether a Run acts for the person, so the Worker limits never refuse it: a Run that acts for
 * the person (`isPersonCaller`), even in a Worker, or the Host waking a top-level Queen for the
 * person. A nested Queen's wake is the Host acting in a Worker, which is agents' work. Anything an
 * agent, a client profile or an agent's task starts is agents' work wherever it runs (ADR 0030,
 * amended 2026-11-09).
 */
export function isPersonRun(
  sql: SqlClient.SqlClient,
  caller: RunCaller,
  session: { readonly sessionId: string; readonly inWorker: boolean },
) {
  if (!caller.hiveWake) return isPersonCaller(sql, caller)
  if (session.inWorker || !isLocalUserCallerId(caller.callerId)) return Effect.succeed(false)
  // A wake acts for the caller of the Run it continues and carries a key of its own, so whose
  // work it is comes from that Run: an agent's Scheduled task fires as its local-user owner.
  return Effect.gen(function* () {
    const continued = yield* latestRunCallerBeforeWakes(sql, session.sessionId)
    // A wake continues some Run; with none to read, it is held to the agents' rule.
    return continued ? yield* isPersonCaller(sql, continued) : false
  })
}

/**
 * The caller of the Session's latest Run that was not a Hive wake, by its stored intent: the Run
 * a wake continues. The `(session_id, updated_at, id)` index walks back only past the wakes.
 */
function latestRunCallerBeforeWakes(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly caller_id: string | null
      readonly idempotency_key: string | null
    }>`
      SELECT
        CASE WHEN json_valid(intent_json)
          THEN json_extract(intent_json, '$.callerId') END AS caller_id,
        CASE WHEN json_valid(intent_json)
          THEN json_extract(intent_json, '$.idempotencyKey') END AS idempotency_key
      FROM session_runs
      WHERE session_id = ${sessionId}
        AND NOT (json_valid(intent_json) AND json_extract(intent_json, '$.hiveWake') IS NOT NULL)
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `
    const continued = rows[0]
    if (typeof continued?.caller_id !== 'string') return undefined
    return typeof continued.idempotency_key === 'string'
      ? { callerId: continued.caller_id, idempotencyKey: continued.idempotency_key }
      : { callerId: continued.caller_id }
  })
}

/**
 * Whether a Follow-up the person queued waits in `items`. A queue delivers in order, so the head
 * an agent queued starts anyway: holding it back would hold back the person's message behind it.
 */
export function holdsPersonFollowUp(
  sql: SqlClient.SqlClient,
  items: readonly { readonly deliveryState: string; readonly intent: RunCaller }[],
) {
  return Effect.gen(function* () {
    for (const item of items) {
      if (item.deliveryState === 'pending' && (yield* isPersonCaller(sql, item.intent))) return true
    }
    return false
  })
}

function isWorkerSession(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.map(
    sql<{ readonly found: number }>`
      SELECT 1 AS found FROM session_spawn_lineage WHERE child_session_id = ${sessionId} LIMIT 1
    `,
    (rows) => rows.length > 0,
  )
}

/**
 * Whether a root Session's active Run row is agents' work, or soon will be: an agent's claimed
 * `replace` holds that Session's slot from its claim, before the Run it starts is written.
 */
function isAgentsWorkRow(sql: SqlClient.SqlClient, row: ActiveRunRow) {
  return Effect.gen(function* () {
    if (row.agents_replacing === 1) return true
    // A Run whose intent names no caller is from before intents did, and was the person's.
    if (typeof row.caller_id !== 'string') return false
    const caller: RunCaller = {
      callerId: row.caller_id,
      ...(typeof row.idempotency_key === 'string' ? { idempotencyKey: row.idempotency_key } : {}),
      ...(row.hive_wake ? { hiveWake: true as const } : {}),
    }
    return !(yield* isPersonRun(sql, caller, { sessionId: row.session_id, inWorker: false }))
  })
}

interface ActiveRunRow {
  readonly session_id: string
  /** An agent's `replace` is claimed and will start its Run here (the person's ids, in SQL). */
  readonly agents_replacing: number
  readonly caller_id: string | null
  readonly idempotency_key: string | null
  readonly hive_wake: number | null
  readonly in_worker: number
}

/**
 * Active Runs of agents' work across the Host: what the Active Workers ceiling counts. Every
 * Worker's active Run counts, as a Worker is agents' work even when the person messages it; in
 * any other Session a Run counts unless it acts for the person. So the person's own Sessions
 * never use a slot. `exceptSessionId` leaves out the Session being admitted.
 */
export function countActiveWorkerRuns(sql: SqlClient.SqlClient, exceptSessionId?: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<ActiveRunRow>`
      SELECT
        states.session_id AS session_id,
        CASE WHEN json_valid(runs.intent_json)
          THEN json_extract(runs.intent_json, '$.callerId') END AS caller_id,
        CASE WHEN json_valid(runs.intent_json)
          THEN json_extract(runs.intent_json, '$.idempotencyKey') END AS idempotency_key,
        CASE WHEN json_valid(runs.intent_json)
          THEN json_extract(runs.intent_json, '$.hiveWake') END AS hive_wake,
        EXISTS (
          SELECT 1 FROM session_spawn_lineage AS lineage
          WHERE lineage.child_session_id = states.session_id
        ) AS in_worker,
        EXISTS (
          SELECT 1 FROM session_operations AS operations
          WHERE operations.target_scope = states.session_id
            AND operations.operation = 'replace'
            AND operations.status = 'pending'
            AND NOT (
              operations.caller_id IN ${sql.in(LOCAL_USER_CALLER_IDS)}
              OR operations.caller_id LIKE ${`${LOCAL_USER_CALLER_PREFIX}%`}
            )
        ) AS agents_replacing
      FROM session_control_states AS states
      LEFT JOIN session_runs AS runs ON runs.id = states.active_run_id
      WHERE states.active_run_id IS NOT NULL AND states.session_id <> ${exceptSessionId ?? ''}
    `
    let count = 0
    for (const row of rows) {
      if (row.in_worker === 1 || (yield* isAgentsWorkRow(sql, row))) count += 1
    }
    return count
  })
}

/**
 * The capacity rule for a Run about to start in `sessionId`, which acts for `runCaller` and is
 * started by a request from `requestCaller`. It is always admitted when the person sent that
 * request (a message, or a queue action such as Resume) or when the Run is the person's work
 * (`isPersonRun`). Otherwise it is agents' work: a Worker's waits for its parent's Worker limit,
 * and any waits for the Active Workers ceiling, wherever it runs.
 */
export function workerRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly runCaller: RunCaller
    readonly requestCaller?: RunCaller
    readonly hostRunCeiling: number
  },
): Effect.Effect<WorkerRunAdmissionRefusal | undefined, unknown> {
  return Effect.gen(function* () {
    if (input.requestCaller && (yield* isPersonCaller(sql, input.requestCaller))) return undefined
    const inWorker = yield* isWorkerSession(sql, input.sessionId)
    const session = { sessionId: input.sessionId, inWorker }
    if (yield* isPersonRun(sql, input.runCaller, session)) return undefined
    if (inWorker && !(yield* directWorkerRunAdmission(sql, input.sessionId)).admitted) {
      return 'parent_concurrency_limit_reached' as const
    }
    const activeWorkerRuns = yield* countActiveWorkerRuns(sql, input.sessionId)
    return activeWorkerRuns >= input.hostRunCeiling
      ? ('host_run_ceiling_reached' as const)
      : undefined
  })
}

/**
 * The Active Workers ceiling as the app settings store it. Settlement reads it here because no
 * command carries it: the next Run starts when the last one ends.
 */
export function storedHostRunCeiling(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly value_json: string }>`
      SELECT value_json FROM settings_store
      WHERE key = ${SETTINGS_KEY_SESSION_HOST_RUN_CEILING}
      LIMIT 1
    `
    const value = rows[0] ? parseJsonUnknown(rows[0].value_json) : undefined
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? value
      : DEFAULT_SETTINGS.sessionHostRunCeiling
  })
}
