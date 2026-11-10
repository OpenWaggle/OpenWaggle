import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type RunInitiatorWalk,
  type RunReference,
  type RunVerdictStep,
  walkRunInitiators,
} from '../application/run-initiator-walk'
import { isAgentsHiveWakeKey } from '../domain/session-control/hive-wake'
import {
  durableSessionRunId,
  isLocalUserCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import { isPersonCaller } from './sqlite-worker-run-admission'

type Origin = 'hive' | 'outside'

const OUTSIDE: RunVerdictStep<Origin> = { verdict: 'outside', followRuns: [] }
const HIVE: RunVerdictStep<Origin> = { verdict: 'hive', followRuns: [] }

interface RunOriginRow {
  readonly caller_id: string | null
  readonly idempotency_key: string | null
  readonly hive_wake: number | null
}

/** The top-level root of the Hive a Session is in: itself when it is not a Worker. */
function hiveRootOf(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.map(
    sql<{ readonly hive_root_session_id: string }>`
      SELECT hive_root_session_id FROM session_spawn_lineage
      WHERE child_session_id = ${sessionId}
      LIMIT 1
    `,
    (rows) => rows[0]?.hive_root_session_id ?? sessionId,
  )
}

function inHive(sql: SqlClient.SqlClient, hiveRoot: string, sessionId: string) {
  if (sessionId === hiveRoot) return Effect.succeed(true)
  return Effect.map(hiveRootOf(sql, sessionId), (root) => root === hiveRoot)
}

/**
 * A caller inside the Hive: the person acting for themselves, or an agent whose Run the walk
 * follows. A client profile, an MCP client, a caller the Host cannot identify, or a local-user
 * Run that is not the person's (a task an agent made, a Hive wake an outside cause marked) is
 * from outside.
 */
function runStep(
  sql: SqlClient.SqlClient,
  row: RunOriginRow | undefined,
): Effect.Effect<RunVerdictStep<Origin>, unknown> {
  const callerId = row?.caller_id
  if (!callerId) return Effect.succeed(OUTSIDE)
  const idempotencyKey = row.idempotency_key ?? undefined
  // A nested Queen's wake that an outside cause led to passes that cause on; any other wake is
  // the Host acting inside the Hive for whoever its caller is.
  if (row.hive_wake && isAgentsHiveWakeKey(idempotencyKey)) return Effect.succeed(OUTSIDE)
  const agent = parseSessionAgentCallerId(callerId)
  if (agent) return Effect.succeed({ verdict: 'hive', followRuns: [agent] })
  if (!isLocalUserCallerId(callerId)) return Effect.succeed(OUTSIDE)
  if (row.hive_wake) return Effect.succeed(HIVE)
  return Effect.map(
    isPersonCaller(sql, { callerId, ...(idempotencyKey ? { idempotencyKey } : {}) }),
    (person) => (person ? HIVE : OUTSIDE),
  )
}

function originWalk(sql: SqlClient.SqlClient, hiveRoot: string): RunInitiatorWalk<Origin, unknown> {
  return {
    step: (run: RunReference) =>
      Effect.gen(function* () {
        if (!(yield* inHive(sql, hiveRoot, run.sessionId))) return OUTSIDE
        const [row] = yield* sql<RunOriginRow>`
          SELECT json_extract(intent_json, '$.callerId') AS caller_id,
            json_extract(intent_json, '$.idempotencyKey') AS idempotency_key,
            json_extract(intent_json, '$.hiveWake') AS hive_wake
          FROM session_runs
          WHERE id = ${durableSessionRunId(run.runId)} AND session_id = ${run.sessionId}
          LIMIT 1
        `
        return yield* runStep(sql, row)
      }),
    combine: (verdicts) => (verdicts.includes('outside') ? 'outside' : 'hive'),
    failClosed: 'outside',
  }
}

/**
 * Whether anything outside the woken parent's Hive (everything under its top-level root) caused
 * the updates a wake would act on: a Session agent from another Hive or Session, a client, or an
 * agent's task, directly or through the Runs that led to the change (an agent elsewhere
 * messaging or stopping one of its Workers, say). The wake is then that outside caller's work,
 * held to the Worker limits and counted, though it acts for the parent's last caller (ADR 0030,
 * amended 2026-11-09). A cause recorded before updates named one is the Host's own. Any other
 * cause the Host cannot follow counts as outside: the safe side for a limit.
 */
export function wakeCausedOutsideHive(
  sql: SqlClient.SqlClient,
  input: {
    readonly parentSessionId: string
    readonly triggerCallerIds: readonly (string | null)[]
  },
) {
  return Effect.gen(function* () {
    const hiveRoot = yield* hiveRootOf(sql, input.parentSessionId)
    for (const triggerCallerId of new Set(input.triggerCallerIds)) {
      if (triggerCallerId === null) continue
      if (isLocalUserCallerId(triggerCallerId)) continue
      const agentRun = parseSessionAgentCallerId(triggerCallerId)
      if (!agentRun) return true
      if ((yield* walkRunInitiators(originWalk(sql, hiveRoot), agentRun)) === 'outside') return true
    }
    return false
  }).pipe(Effect.orElseSucceed(() => true))
}
