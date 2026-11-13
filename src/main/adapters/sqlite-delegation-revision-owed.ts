import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  DELEGATION_REVISION_KEY_PREFIX,
  DELEGATION_REVISION_OPERATIONS,
} from '../domain/session-control/delegation-revision-follow-up'
import {
  durableSessionRunId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import type { DelegationContractRow } from './sqlite-session-delegation-support'

/**
 * SQL (a 0/1 value) for whether the Worker of the `contracts` row is owed a revision request
 * that was not queued yet when the Run `runId` settles (#454). The parent's command that sent the
 * Worker back to work commits first, and its Follow-up is queued afterwards as its own command, so
 * a Run that started before that command and settles in between must not have its reply, which
 * never saw the feedback, taken as the revision.
 *
 * Owed means: the Delegation is `revision_requested`; a completed command of its parent that sent
 * the Worker back (a revision request or reopen, or a task change whose outcome carries a
 * `revisionRequest`) is newer than the settling Run; and no Follow-up with that command's
 * revision key (`delegationRevisionKey`) was recorded on the Worker. Once it was, the queued
 * Follow-up holds the settlement back itself, or it was delivered into this Run (promoted), or it
 * was refused; in each case settlement goes on as usual. A Run that started after the command,
 * such as a retry after a failed revision Run, is never held back.
 */
export function revisionFollowUpOwedSql(sql: SqlClient.SqlClient, runId: string) {
  return sql`(
    contracts.state = ${'revision_requested'}
    AND EXISTS (
      SELECT 1 FROM session_operations AS sendback
      WHERE ${sendBackOfContract(sql)}
        -- A Run with no row (not one the Host started) is never held back.
        AND sendback.created_at > (
          SELECT runs.created_at FROM session_runs AS runs WHERE runs.id = ${runId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM session_operations AS revision
          WHERE revision.target_scope = contracts.child_session_id
            AND revision.operation = ${'follow-up'}
            AND revision.caller_id = sendback.caller_id
            AND revision.idempotency_key = ${revisionKey(sql)}
        )
    )
  )`
}

/**
 * `revisionFollowUpOwedSql`, or a revision request of the parent is still queued on the Worker,
 * whenever the Run `runId` started: a queued request has not reached the active Run (a promoted
 * one leaves the queue), so that Run has not seen the feedback either. What keeps the Run from
 * submitting its result as the revision itself. The queued request is matched by its author,
 * which a `queue-adopt` keeps as `authorCallerId`.
 */
export function revisionPendingForRunSql(sql: SqlClient.SqlClient, runId: string) {
  return sql`(
    ${revisionFollowUpOwedSql(sql, runId)}
    OR (
      contracts.state = ${'revision_requested'}
      AND EXISTS (SELECT 1 FROM session_runs AS runs WHERE runs.id = ${runId})
      AND EXISTS (
        SELECT 1 FROM session_operations AS sendback
        JOIN session_follow_ups AS queued ON queued.session_id = contracts.child_session_id
        WHERE ${sendBackOfContract(sql)}
          AND COALESCE(
            json_extract(queued.intent_json, '$.authorCallerId'),
            json_extract(queued.intent_json, '$.callerId')
          ) = sendback.caller_id
          AND json_extract(queued.intent_json, '$.idempotencyKey') = ${revisionKey(sql)}
      )
    )
  )`
}

/** `sendback` is a completed command of the parent that sent the Worker back to work. */
function sendBackOfContract(sql: SqlClient.SqlClient) {
  return sql`sendback.target_scope =
      ${'delegation:'} || contracts.id || ${':actor:'} || contracts.parent_session_id
    AND sendback.operation IN ${sql.in([...DELEGATION_REVISION_OPERATIONS])}
    AND sendback.status = ${'completed'}
    AND json_extract(sendback.outcome_json, '$.delegationState') = ${'revision_requested'}
    AND (
      sendback.operation IN ${sql.in(['delegation-request-revision', 'delegation-reopen'])}
      OR json_extract(sendback.outcome_json, '$.revisionRequest') IS NOT NULL
    )`
}

/** The idempotency key of `sendback`'s revision Follow-up (`delegationRevisionKey`). */
function revisionKey(sql: SqlClient.SqlClient) {
  return sql`${DELEGATION_REVISION_KEY_PREFIX} || sendback.operation || ${':'}
    || sendback.idempotency_key`
}

/**
 * Whether the Worker's agent submits from a Run that started before its parent sent it back to
 * work, while the revision request waits for the Worker's next Run (#454). That Run never saw the
 * feedback, and taking its result would leave the revising Run unable to submit, so the result
 * waits for the revising Run, as settlement does for a reply (`revisionPendingForRunSql`). A
 * requested Waggle's agent (`waggle-of-<runId>`) acts in its classic Run, so that Run is checked.
 */
export function revisionPendingForSubmittingRun(
  sql: SqlClient.SqlClient,
  callerId: string,
  contract: DelegationContractRow,
) {
  const agent = parseSessionAgentCallerId(callerId)
  if (contract.state !== 'revision_requested' || agent?.sessionId !== contract.child_session_id) {
    return Effect.succeed(false)
  }
  return sql<{ readonly pending: number }>`
    SELECT ${revisionPendingForRunSql(sql, durableSessionRunId(agent.runId))} AS pending
    FROM delegation_contracts AS contracts WHERE contracts.id = ${contract.id}
  `.pipe(Effect.map((rows) => rows[0]?.pending === 1))
}
