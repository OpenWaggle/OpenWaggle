import type * as SqlClient from '@effect/sql/SqlClient'
import {
  DELEGATION_REVISION_KEY_PREFIX,
  DELEGATION_REVISION_OPERATIONS,
} from '../domain/session-control/delegation-revision-follow-up'

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
      WHERE sendback.target_scope =
          ${'delegation:'} || contracts.id || ${':actor:'} || contracts.parent_session_id
        AND sendback.operation IN ${sql.in([...DELEGATION_REVISION_OPERATIONS])}
        AND sendback.status = ${'completed'}
        AND json_extract(sendback.outcome_json, '$.delegationState') = ${'revision_requested'}
        AND (
          sendback.operation IN ${sql.in(['delegation-request-revision', 'delegation-reopen'])}
          OR json_extract(sendback.outcome_json, '$.revisionRequest') IS NOT NULL
        )
        AND sendback.created_at > COALESCE(
          (SELECT runs.created_at FROM session_runs AS runs WHERE runs.id = ${runId}), 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM session_operations AS revision
          WHERE revision.target_scope = contracts.child_session_id
            AND revision.operation = ${'follow-up'}
            AND revision.caller_id = sendback.caller_id
            AND revision.idempotency_key =
              ${DELEGATION_REVISION_KEY_PREFIX} || sendback.operation || ${':'}
                || sendback.idempotency_key
        )
    )
  )`
}
