import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import type { HiveAttentionCause } from '@shared/types/hive-next-actor'
import * as Effect from 'effect/Effect'
import type { SessionControlDelegationAttentionCleared } from '../ports/session-control-run-lifecycle-repository'

/** Who authored a transition the Session Host made on its own (ADR 0059). */
export const SESSION_HOST_TRANSITION_AUTHOR = 'session-host'

/** A Delegation whose `needs_attention` the Host cleared; its parent and Worker views refresh. */
export type DelegationAttentionCleared = SessionControlDelegationAttentionCleared

interface AttentionContractRow {
  readonly id: string
  readonly parent_session_id: string
  readonly child_session_id: string
  readonly state: string
  readonly attention_cause: HiveAttentionCause | null
}

/** The operations through which a parent delivers something to its Worker, in words (ADR 0059). */
const PARENT_DELIVERIES: ReadonlyMap<string, string> = new Map([
  ['follow-up', 'a Follow-up'],
  ['message', 'a message'],
  ['steer', 'steering'],
  ['promote', 'a promoted Follow-up'],
  ['replace', 'a replacement message'],
])

function loadAttentionContract(sql: SqlClient.SqlClient, workerSessionId: string) {
  return sql<AttentionContractRow>`
    SELECT id, parent_session_id, child_session_id, state, attention_cause
    FROM delegation_contracts WHERE child_session_id = ${workerSessionId} LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
}

function clearAttention(
  sql: SqlClient.SqlClient,
  input: {
    readonly contract: AttentionContractRow
    readonly state: DelegationAttentionCleared['state']
    readonly reason: string
    readonly actorSessionId: string
    readonly authoredBy: string
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO delegation_state_transitions (
        delegation_id, from_state, to_state, reason, actor_session_id, authored_by, created_at
      ) VALUES (
        ${input.contract.id}, ${'needs_attention'}, ${input.state}, ${input.reason},
        ${input.actorSessionId}, ${input.authoredBy}, ${input.now}
      )
    `
    yield* sql`
      UPDATE delegation_contracts
      SET state = ${input.state}, attention_cause = NULL, updated_at = ${input.now}
      WHERE id = ${input.contract.id} AND state = ${'needs_attention'}
    `
    return {
      delegationId: input.contract.id,
      parentSessionId: SessionId(input.contract.parent_session_id),
      workerSessionId: SessionId(input.contract.child_session_id),
      state: input.state,
    } satisfies DelegationAttentionCleared
  })
}

/**
 * The Host sets `needs_attention` for a failed or interrupted Worker Run, and records it: the cause
 * and a transition row, so the failure stays in the Delegation's history after it clears.
 */
export function markRunFailedAttention(
  sql: SqlClient.SqlClient,
  input: {
    readonly delegationId: string
    readonly workerSessionId: string
    readonly fromState: string
    readonly summary: string
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO delegation_state_transitions (
        delegation_id, from_state, to_state, reason, actor_session_id, authored_by, created_at
      ) VALUES (
        ${input.delegationId}, ${input.fromState}, ${'needs_attention'}, ${input.summary},
        ${input.workerSessionId}, ${SESSION_HOST_TRANSITION_AUTHOR}, ${input.now}
      )
    `
    yield* sql`
      UPDATE delegation_contracts
      SET state = ${'needs_attention'}, attention_cause = ${'run_failed'}, updated_at = ${input.now}
      WHERE id = ${input.delegationId}
    `
  })
}

/**
 * A new Run started on the Worker, from any source: the failed Run no longer needs anyone
 * (ADR 0059). The Delegation goes back to `revision_requested` when the Run failed while the
 * Worker was revising, and to `working` otherwise. A Worker's own request for help stays.
 */
export function clearRunFailedAttention(
  sql: SqlClient.SqlClient,
  input: { readonly workerSessionId: string; readonly runId: string; readonly now: number },
) {
  return Effect.gen(function* () {
    const contract = yield* loadAttentionContract(sql, input.workerSessionId)
    if (contract?.state !== 'needs_attention') return undefined
    // A row from before migration 74 always has a cause; null still reads as a failed Run.
    if (contract.attention_cause === 'worker_request') return undefined
    const failures = yield* sql<{ readonly from_state: string }>`
      SELECT from_state FROM delegation_state_transitions
      WHERE delegation_id = ${contract.id} AND to_state = ${'needs_attention'}
        AND authored_by = ${SESSION_HOST_TRANSITION_AUTHOR}
      ORDER BY id DESC LIMIT 1
    `
    const state =
      failures[0]?.from_state === 'revision_requested' ? 'revision_requested' : 'working'
    return yield* clearAttention(sql, {
      contract,
      state,
      reason: `Run ${input.runId} started, so the failed Run no longer needs attention.`,
      actorSessionId: contract.child_session_id,
      authoredBy: SESSION_HOST_TRANSITION_AUTHOR,
      now: input.now,
    })
  })
}

/** The Session whose agent made a request, for a `session-agent:<session>:<run>` caller. */
function agentSessionOf(callerId: string) {
  const prefix = 'session-agent:'
  if (!callerId.startsWith(prefix)) return undefined
  const sessionId = callerId.slice(prefix.length).split(':')[0]
  return sessionId === undefined || sessionId.length === 0 ? undefined : sessionId
}

/**
 * The parent's agent delivered something to the Worker that asked it for help: a Follow-up, a
 * message, steering, a promotion or a replacement. The request is answered, so the Worker works
 * again (ADR 0059). A revision request moves the state itself; a failed Run waits for a new Run.
 */
export function clearWorkerRequestOnParentDelivery(
  sql: SqlClient.SqlClient,
  input: {
    readonly workerSessionId: string
    readonly callerId: string
    readonly operation: string
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    const delivery = PARENT_DELIVERIES.get(input.operation)
    if (delivery === undefined) return undefined
    const callerSessionId = agentSessionOf(input.callerId)
    if (callerSessionId === undefined) return undefined
    const contract = yield* loadAttentionContract(sql, input.workerSessionId)
    if (contract?.parent_session_id !== callerSessionId) return undefined
    if (contract.state !== 'needs_attention' || contract.attention_cause !== 'worker_request') {
      return undefined
    }
    return yield* clearAttention(sql, {
      contract,
      state: 'working',
      reason: `The parent answered with ${delivery}.`,
      actorSessionId: callerSessionId,
      authoredBy: input.callerId,
      now: input.now,
    })
  })
}
