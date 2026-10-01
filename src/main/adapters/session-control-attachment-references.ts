import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'

interface AttachmentIntentRow {
  readonly intent_json: string
}

const LIVE_RUN_STATUSES = ['starting', 'active', 'stopping'] as const

function attachmentIdsOf(intentJson: string) {
  const intent = parseJsonUnknown(intentJson)
  if (!isRecord(intent) || !('attachmentIds' in intent))
    throw new Error('A retained Session intent has no attachment capability list.')
  const attachmentIds = intent.attachmentIds
  if (!Array.isArray(attachmentIds) || !attachmentIds.every((id) => typeof id === 'string'))
    throw new Error('A retained Session intent has an invalid attachment capability list.')
  return attachmentIds
}

function attachmentIdsOfRows(rows: readonly AttachmentIntentRow[]) {
  return Effect.try({
    try: () => new Set(rows.flatMap((row) => attachmentIdsOf(row.intent_json))),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

/**
 * Attachment capabilities a Session still needs: those of its live Run, its queued Follow-ups,
 * and every steer queued into a live Run. A queued steer keeps its attachments while its Run is
 * live, so a stopped Run can return it to the Follow-up queue intact.
 */
export function referencedSessionAttachmentIds(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<AttachmentIntentRow>`
    SELECT intent_json FROM session_runs WHERE session_id = ${sessionId}
      AND status IN ${sql.in([...LIVE_RUN_STATUSES])} AND intent_json IS NOT NULL
    UNION ALL SELECT intent_json FROM session_follow_ups WHERE session_id = ${sessionId}
    UNION ALL SELECT json_extract(operation.request_json, '$.input') AS intent_json
    FROM session_operations AS operation
    JOIN session_runs AS run
      ON run.id = json_extract(operation.outcome_json, '$.runId')
      AND run.session_id = operation.target_scope
    WHERE operation.target_scope = ${sessionId}
      AND operation.operation = ${'steer'}
      AND operation.status = ${'completed'}
      AND json_extract(operation.outcome_json, '$.effect') = ${'steered-run'}
      AND run.status IN ${sql.in([...LIVE_RUN_STATUSES])}
  `.pipe(Effect.flatMap(attachmentIdsOfRows))
}

/**
 * Release the attachments of a settled Run's steers that nothing references any more: the ones Pi
 * incorporated. A steer the Run returned to the queue keeps them through its Follow-up. Call it in
 * the settlement transaction, after the Run left its live statuses. Only the Run's own steer
 * capabilities are considered, so attachments another command bound but has not stored yet are
 * never touched.
 */
export function releaseDeliveredSteerAttachments(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: string; readonly runId: string },
) {
  return Effect.gen(function* () {
    const steerRows = yield* sql<AttachmentIntentRow>`
      SELECT json_extract(request_json, '$.input') AS intent_json
      FROM session_operations
      WHERE target_scope = ${input.sessionId}
        AND operation = ${'steer'}
        AND status = ${'completed'}
        AND json_extract(outcome_json, '$.effect') = ${'steered-run'}
        AND json_extract(outcome_json, '$.runId') = ${input.runId}
    `
    const steerAttachmentIds = yield* attachmentIdsOfRows(steerRows)
    if (steerAttachmentIds.size === 0) return
    const referenced = yield* referencedSessionAttachmentIds(sql, input.sessionId)
    const released = [...steerAttachmentIds].filter((id) => !referenced.has(id))
    if (released.length === 0) return
    yield* sql`
      DELETE FROM session_prepared_attachments
      WHERE session_id = ${input.sessionId} AND id IN ${sql.in(released)}
    `
  })
}
