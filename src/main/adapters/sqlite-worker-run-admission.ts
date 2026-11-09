import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { isLocalUserCallerId } from '../domain/session-control/root-session-project-reach'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

/** Why the Host would not start a Worker's Run now. Both are retryable. */
export type WorkerRunAdmissionRefusal =
  | 'parent_concurrency_limit_reached'
  | 'host_run_ceiling_reached'

/** Who a starting Run acts for, as its intent records it. */
export interface StartingRunCaller {
  readonly callerId: string
  /** A Host-authored Hive wake: the Host acts, even when it acts for the person. */
  readonly hiveWake?: true
}

/**
 * Whether the person started this Run: from the app, the CLI or another local-user client. The
 * Host never refuses such a Run for capacity, so a busy Hive can never stop the person working in
 * any Session (ADR 0030, amended). A Hive wake is the Host acting, so it is not one.
 */
export function isPersonStartedRun(caller: StartingRunCaller) {
  return caller.hiveWake !== true && isLocalUserCallerId(caller.callerId)
}

/**
 * Active Worker Runs across the Host: Runs of Sessions some parent spawned. The person's own
 * Sessions never count. `exceptSessionId` leaves out the Session whose Run is being admitted.
 */
export function countActiveWorkerRuns(sql: SqlClient.SqlClient, exceptSessionId?: string) {
  return Effect.gen(function* () {
    const rows = exceptSessionId
      ? yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count
          FROM session_control_states AS states
          JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = states.session_id
          WHERE states.active_run_id IS NOT NULL AND states.session_id <> ${exceptSessionId}
        `
      : yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count
          FROM session_control_states AS states
          JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = states.session_id
          WHERE states.active_run_id IS NOT NULL
        `
    return rows[0]?.count ?? 0
  })
}

/**
 * The capacity rule for a Run about to start in `sessionId`. Only an agent- or Host-started Run
 * of a Worker Session is limited: by its parent's Worker limit, then by the Host's Worker ceiling.
 * A root Session's Run, and any Run the person starts, is always admitted.
 */
export function workerRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly caller: StartingRunCaller
    readonly hostRunCeiling: number
  },
): Effect.Effect<WorkerRunAdmissionRefusal | undefined, unknown> {
  if (isPersonStartedRun(input.caller)) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const parentAdmission = yield* directWorkerRunAdmission(sql, input.sessionId)
    // No parent: a root Session, which no capacity limit applies to.
    if (!('parentSessionId' in parentAdmission)) return undefined
    if (!parentAdmission.admitted) return 'parent_concurrency_limit_reached' as const
    const activeWorkerRuns = yield* countActiveWorkerRuns(sql, input.sessionId)
    return activeWorkerRuns >= input.hostRunCeiling
      ? ('host_run_ceiling_reached' as const)
      : undefined
  })
}
