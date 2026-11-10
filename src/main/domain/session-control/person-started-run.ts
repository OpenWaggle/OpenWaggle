import { isAgentScheduledRunKey } from '../scheduled-tasks/scheduled-task-run-key'
import { isLocalUserCallerId } from './root-session-project-reach'

/** Who a starting Run acts for, as its intent and the request that starts it record it. */
export interface StartingRunCaller {
  readonly callerId: string
  /** The request's key: the firing of an agent's Scheduled task work is known by it. */
  readonly idempotencyKey?: string
  /** A Host-authored Hive wake: the Host acts, even when it acts for the person. */
  readonly hiveWake?: true
  /** The person's own queue action (Resume, Withdraw, an edit) delivers this Run. */
  readonly personActed?: true
}

/**
 * Whether the person started this Run: from the app, the CLI or another local-user client, or by
 * a queue action of their own. The Host never refuses such a Run for capacity, so a busy Hive can
 * never stop the person working in any Session (ADR 0030, amended 2026-11-09). A Hive wake is the
 * Host acting, and a Scheduled task firing an agent's work runs as its owner but is the agent's:
 * neither is the person's.
 */
export function isPersonStartedRun(caller: StartingRunCaller) {
  if (caller.personActed) return true
  if (caller.hiveWake || isAgentScheduledRunKey(caller.idempotencyKey)) return false
  return isLocalUserCallerId(caller.callerId)
}

/**
 * Whether a starting Run is an agent's work by its intent: started by an agent, a client profile
 * or an agent's Scheduled task, wherever it runs. Such a Run counts toward Active Workers even in
 * a Session the person made, so agents cannot fan out over the person's Sessions uncounted (ADR
 * 0030, amended 2026-11-10). A Hive wake is the Host's and is judged by the Session it wakes, and
 * the person's own queue action delivering an agent's Follow-up does not change whose work it is.
 */
export function isAgentWorkRun(intent: Omit<StartingRunCaller, 'personActed'>) {
  if (intent.hiveWake) return false
  return !isPersonStartedRun({
    callerId: intent.callerId,
    ...(intent.idempotencyKey === undefined ? {} : { idempotencyKey: intent.idempotencyKey }),
  })
}
