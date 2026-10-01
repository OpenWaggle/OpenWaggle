import type * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import type { AttachmentKind, AttachmentOrigin } from '@shared/types/agent'
import {
  FOLLOW_UP_EDIT_CALLER_ID,
  type SessionFollowUpAttachmentDescriptor,
  type SessionFollowUpEditHoldSummary,
} from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import { canEditFollowUp } from '../domain/session-control/follow-up-edit'
import type { SessionControlFollowUpEditHold } from '../domain/session-control/message-aggregate'
import { monotonicNowMs } from '../utils/monotonic-clock'
import { listSessionFollowUpEditHolds } from './sqlite-follow-up-edit-holds'

/** The provenance fields that decide who may edit a queued Follow-up. */
const intentProvenanceSchema = Schema.Struct({
  callerId: Schema.String,
  authorCallerId: Schema.optional(Schema.String),
  attachmentIds: Schema.Array(Schema.String),
})

interface AttachmentRow {
  readonly id: string
  readonly kind: AttachmentKind
  readonly origin: AttachmentOrigin
  readonly name: string
  readonly mime_type: string
  readonly size_bytes: number
}

export interface QueueListEditContext {
  /** The querying caller; only the desktop user may edit. */
  readonly callerId: string | undefined
  readonly desktopUser: boolean
}

function intentProvenance(intentJson: string) {
  return decodeUnknownOrThrow(intentProvenanceSchema, parseJsonUnknown(intentJson))
}

/** The desktop user may edit a Follow-up it queued itself (see `canEditFollowUp`). */
function isEditable(intentJson: string, context: QueueListEditContext) {
  if (!context.desktopUser || context.callerId !== FOLLOW_UP_EDIT_CALLER_ID) return false
  return canEditFollowUp(intentProvenance(intentJson), context.callerId)
}

function holdSummary(
  hold: SessionControlFollowUpEditHold,
  callerId: string | undefined,
  clock: { readonly wall: number; readonly monotonic: number },
): SessionFollowUpEditHoldSummary {
  const holderIsCaller = callerId !== undefined && hold.holderCallerId === callerId
  return {
    // Only the holder learns what it saves, cancels, or re-adopts the edit with.
    ...(holderIsCaller ? { holdId: hold.holdId, baseQueueRevision: hold.baseQueueRevision } : {}),
    holderIsCaller,
    acquiredAt: hold.acquiredAt,
    // The lease runs on the Host's monotonic clock; this is its wall-clock estimate.
    leaseExpiresAt: clock.wall + Math.max(0, hold.expiresAt - clock.monotonic),
  }
}

function attachmentDescriptors(
  sql: SqlClient.SqlClient,
  sessionId: string,
  attachmentIds: readonly string[],
) {
  if (attachmentIds.length === 0) {
    return Effect.succeed(new Map<string, SessionFollowUpAttachmentDescriptor>())
  }
  return sql<AttachmentRow>`
    SELECT id, kind, origin, name, mime_type, size_bytes
    FROM session_prepared_attachments
    WHERE session_id = ${sessionId} AND id IN ${sql.in([...new Set(attachmentIds)])}
  `.pipe(
    Effect.map(
      (rows) =>
        new Map(
          rows.map((row) => [
            row.id,
            {
              id: row.id,
              kind: row.kind,
              origin: row.origin,
              name: row.name,
              mimeType: row.mime_type,
              sizeBytes: row.size_bytes,
            } satisfies SessionFollowUpAttachmentDescriptor,
          ]),
        ),
    ),
  )
}

/**
 * The per-item Follow-up edit fields of a queue-list: whether the caller may edit the item, its
 * live hold, and (with bodies) the descriptors a composer needs to show its attachments again.
 */
export function queueListEditFields(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly includeBodies: boolean
    readonly rows: readonly { readonly id: string; readonly intent_json: string }[]
    readonly context: QueueListEditContext
  },
) {
  return Effect.gen(function* () {
    const clock = { wall: Date.now(), monotonic: monotonicNowMs() }
    const holds = yield* listSessionFollowUpEditHolds(sql, input.sessionId, clock.monotonic)
    const attachmentIdsByItem = new Map(
      input.rows.map((row) => [
        row.id,
        input.includeBodies ? intentProvenance(row.intent_json).attachmentIds : [],
      ]),
    )
    const descriptors = yield* attachmentDescriptors(
      sql,
      input.sessionId,
      [...attachmentIdsByItem.values()].flat(),
    )
    return new Map(
      input.rows.map((row) => {
        const hold = holds.get(row.id)
        return [
          row.id,
          {
            editable: isEditable(row.intent_json, input.context),
            ...(hold ? { editHold: holdSummary(hold, input.context.callerId, clock) } : {}),
            ...(input.includeBodies
              ? {
                  attachments: (attachmentIdsByItem.get(row.id) ?? []).flatMap((id) => {
                    const descriptor = descriptors.get(id)
                    return descriptor ? [descriptor] : []
                  }),
                }
              : {}),
          },
        ] as const
      }),
    )
  })
}
