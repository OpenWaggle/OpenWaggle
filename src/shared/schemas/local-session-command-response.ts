import { Schema } from '@shared/schema'
import { desktopServiceResponseSchema } from './desktop-service'
import { hostUiV1ResultSchema } from './host-ui-protocol'
import { localHostResponseSchema } from './local-host'
import { localSessionProfileManagementResponseSchema } from './local-session-profile-management'
import { localUpdateResponseSchema } from './local-update'
import { scheduledTasksResponseSchema } from './scheduled-task-records'
import { sessionControlMutationResponseSchema } from './session-control'
import { sessionHostEventCursorSchema } from './session-host-event-cursor'
import { sessionLifecycleResponseSchema } from './session-lifecycle'
import { preparedAttachmentSchema } from './validation'
import type { ContextCompactionResult } from '@shared/types/context-usage'
import { SESSION_WAGGLE_CONTRACT_VERSION } from '@shared/types/local-session-waggle'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  type SessionQueryOutcome,
} from '@shared/types/session-query'

/**
 * Responses the Local Session client receives, one schema per command contract, and
 * `localSessionCommandResultSchema`, the result union `LocalSessionCommandResult` is inferred from.
 */

const LOCAL_UI_EFFECTS = [
  'pinned',
  'unpinned',
  'pin-moved',
  'interrupted-run-dismissed',
  'tree-navigated',
  'branch-renamed',
  'branch-archived',
  'branch-restored',
  'tree-ui-state-updated',
  'session-deleted',
  'follow-up-edit-hold-renewed',
  'follow-up-edit-hold-lost',
] as const

export const localAttachmentsResponseSchema = Schema.Struct({
  requestId: Schema.String,
  attachments: Schema.Array(preparedAttachmentSchema),
})

export const localUiResponseSchema = Schema.Struct({
  requestId: Schema.String,
  effect: Schema.Literal(...LOCAL_UI_EFFECTS),
  sessionId: Schema.String,
  navigation: Schema.optionalWith(
    Schema.Struct({
      editorText: Schema.optionalWith(Schema.String, { exact: true }),
      cancelled: Schema.Boolean,
    }),
    { exact: true },
  ),
  /** For a renewed Follow-up edit hold: its new expiry (Host clock). */
  leaseExpiresAt: Schema.optionalWith(Schema.Number, { exact: true }),
})

const sessionQueryOutcomeHeaderSchema = Schema.Struct({ operation: Schema.String })

/**
 * The query outcome union is the Host's own read model; the client checks that it names an
 * operation and keeps the rest as the Host wrote it.
 */
const sessionQueryOutcomeSchema = Schema.declare(
  (value: unknown): value is SessionQueryOutcome =>
    Schema.is(sessionQueryOutcomeHeaderSchema)(value),
  { identifier: 'SessionQueryOutcome' },
)

export const sessionQueryResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_QUERY_CONTRACT_VERSION),
  requestId: Schema.String,
  eventCursor: Schema.optionalWith(sessionHostEventCursorSchema, { exact: true }),
  outcome: sessionQueryOutcomeSchema,
})

/** A Waggle send's report; a Waggle send is never `queued`. */
export const waggleSendReportSchema = Schema.Struct({
  outcome: Schema.Literal('delivered', 'refused', 'cancelled'),
  message: Schema.optionalWith(Schema.String, { exact: true }),
  code: Schema.optionalWith(Schema.String, { exact: true }),
  /** The Run a `delivered` send started, when the Host reported it. */
  runId: Schema.optionalWith(Schema.String, { exact: true }),
})

export const sessionWaggleResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_WAGGLE_CONTRACT_VERSION),
  requestId: Schema.String,
  idempotencyKey: Schema.String,
  replayed: Schema.Boolean,
  report: waggleSendReportSchema,
})

export const sessionWaggleCancellationResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_WAGGLE_CONTRACT_VERSION),
  requestId: Schema.String,
  sessionId: Schema.String,
  cancelled: Schema.Boolean,
})

const contextCompactionResultSchema: Schema.Schema<ContextCompactionResult> = Schema.Struct({
  summary: Schema.String,
  firstKeptEntryId: Schema.String,
  tokensBefore: Schema.Number,
})

export const localCompactionResponseSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: Schema.String,
  result: contextCompactionResultSchema,
})

export const localCompactionCancellationResponseSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: Schema.String,
  cancelled: Schema.Boolean,
})

/** A command frame's payload: which contract answered, and its still-undecoded response. */
export const localSessionCommandResponsePayloadSchema = Schema.Struct({
  contract: Schema.String,
  response: Schema.Unknown,
})

function commandResult<const Contract extends string, Response extends Schema.Schema.AnyNoContext>(
  contract: Contract,
  response: Response,
) {
  return Schema.Struct({ contract: Schema.Literal(contract), response })
}

/** Every contract's result: which contract answered, and its decoded response. */
export const localSessionCommandResultSchema = Schema.Union(
  commandResult('desktop-service-v1', desktopServiceResponseSchema),
  commandResult('local-attachments-v1', localAttachmentsResponseSchema),
  commandResult('local-ui-v1', localUiResponseSchema),
  commandResult('local-access-v1', localSessionProfileManagementResponseSchema),
  commandResult('session-control-v2', sessionControlMutationResponseSchema),
  commandResult('session-lifecycle-v2', sessionLifecycleResponseSchema),
  commandResult('session-query-v2', sessionQueryResponseSchema),
  commandResult('host-ui-v1', hostUiV1ResultSchema),
  commandResult('local-update-v1', localUpdateResponseSchema),
  commandResult('local-host-v1', localHostResponseSchema),
  commandResult('local-compaction-v1', localCompactionResponseSchema),
  commandResult('local-compaction-cancel-v1', localCompactionCancellationResponseSchema),
  commandResult('session-waggle-v1', sessionWaggleResponseSchema),
  commandResult('session-waggle-cancel-v1', sessionWaggleCancellationResponseSchema),
  commandResult('scheduled-tasks-v1', scheduledTasksResponseSchema),
)
